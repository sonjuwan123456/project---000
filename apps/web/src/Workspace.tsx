import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  applyCommand,
  canUndo,
  composeSelection,
  createWorkspaceState,
  fromWorkspaceFile,
  maskToRowIndices,
  parseWorkspaceFile,
  toWorkspaceFile,
  type Command,
  type RowMask,
  type SelectionClause,
  type SelectionClauses,
  type SelectionSource,
  type StoredCamera,
  type WorkspaceState,
} from '@holo/core'
import {
  UnsupportedFileError,
  anchorsOf,
  loadDelimitedText,
  sampleCsv,
  startPca,
  startTableRead,
  toViewModel,
  vectorToReduce,
  type LoadedTable,
  type PcaResult,
  type TableJob,
  type ViewModel,
} from '@holo/data'
import type { EffectLevel } from '@holo/holo-fx'
import {
  ActivityLog,
  CommandPalette,
  DistributionView,
  FileDropZone,
  PointCloudView,
  TableView,
  type PaletteCommand,
} from '@holo/views'
import { clearWorkspace, loadWorkspace, saveWorkspace } from './workspaceStore'

/**
 * 작업 공간 — 세 뷰를 선택 코디네이터 하나로 묶는 곳.
 *
 * 뷰끼리는 서로를 부르지 않는다. 각자 조건을 발행하고 여기서 AND로 합친 결과만 받는다.
 * 3D 점 뷰는 합친 선택을 그대로 받아 강조하고, 표와 분포 그래프는 자기 조건을 뺀
 * 나머지를 받아 걸러 낸다(설계 문서 5장).
 *
 * 선택을 바꾸는 길은 명령 하나뿐이다. 그래서 되돌리기와 활동 기록이 뷰마다 따로
 * 필요하지 않고, 팔레트는 같은 명령을 이름으로 꺼내 쓴다.
 *
 * 조건만 상태로 들고 있고 행 비트 배열은 매번 다시 만든다. 작업 공간을 저장할 때
 * 남길 것이 조건뿐이기 때문이다. 저장은 조건이 바뀔 때마다 알아서 하고, 새로 고치면
 * 그 조건으로 다시 계산한 화면이 나온다.
 */

const SAMPLE_ASSET = 'sample-고객문의'

/** 개발용 샘플도 로더를 거쳐 들어온다. 샘플만 다른 길이면 로더가 깨져도 모른다. */
function sampleLoadedTable(): LoadedTable {
  return loadDelimitedText(sampleCsv(12_000), { assetId: SAMPLE_ASSET })
}

const POINTS: SelectionSource = 'points'
const TABLE: SelectionSource = 'table'
const BARS: SelectionSource = 'charts:category'
const HISTOGRAM: SelectionSource = 'charts:sentiment'

const EFFECT_LABELS: ReadonlyArray<{ level: EffectLevel; label: string }> = [
  { level: 'high', label: '높게' },
  { level: 'normal', label: '보통' },
  { level: 'performance', label: '가볍게' },
]

const count = (value: number) => value.toLocaleString('ko-KR')

/** 저장된 문자열을 효과 단계로 되돌린다. 모르는 값은 기본값으로 둔다. */
function toEffectLevel(value: string): EffectLevel {
  return EFFECT_LABELS.some(({ level }) => level === value) ? (value as EffectLevel) : 'normal'
}

function fileStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** useReducer는 인자 개수가 정확히 둘인 함수만 받는다. applyCommand의 시각 인자를 덮어 둔다. */
const reduce = (state: WorkspaceState, command: Command): WorkspaceState =>
  applyCommand(state, command)

/** 조건 하나를 넣거나, 인자가 null이면 뺀다. */
function withClause(source: SelectionSource, clause: SelectionClause | null) {
  return (clauses: SelectionClauses): SelectionClauses => {
    const next = new Map(clauses)
    if (clause === null) next.delete(source)
    else next.set(source, clause)
    return next
  }
}

function categoriesOf(clauses: SelectionClauses): readonly number[] {
  const clause = clauses.get(BARS)
  return clause?.kind === 'category' ? clause.values : []
}

function rangeOf(clauses: SelectionClauses): { min: number; max: number } | null {
  const clause = clauses.get(HISTOGRAM)
  return clause?.kind === 'range' ? { min: clause.min, max: clause.max } : null
}

function pickedOf(clauses: SelectionClauses): number | null {
  const clause = clauses.get(TABLE)
  if (clause?.kind !== 'rows') return null
  const row = clause.rows.indexOf(1)
  return row === -1 ? null : row
}

/** 임베딩을 줄이는 계산이 어디까지 갔는지. 표 이름을 달아 지난 표의 결과를 걸러 낸다. */
type Reduction =
  | { kind: 'idle' }
  | { kind: 'running'; assetId: string }
  | { kind: 'done'; assetId: string; result: PcaResult }
  | { kind: 'failed'; assetId: string }

export function Workspace() {
  const [source, setSource] = useState<{ table: LoadedTable; label: string }>(() => ({
    table: sampleLoadedTable(),
    label: '고객문의 샘플',
  }))
  /*
   * 임베딩을 줄이는 계산은 워커로 보낸다. 2만 행 384차원이면 0.5초가 넘어서,
   * 주 스레드에서 돌리면 파일을 연 순간 화면이 굳는다. 결과가 오기 전까지는
   * 좌표 없는 뷰 모델을 쓴다 — 표와 분포 그래프는 그동안에도 만질 수 있다.
   *
   * 결과에 표 이름을 같이 달아 둔다. 표를 갈아 끼우는 사이에 지난 계산이 돌아와
   * 다른 표의 좌표를 그리면 안 된다.
   */
  const [reduction, setReduction] = useState<Reduction>({ kind: 'idle' })

  useEffect(() => {
    const vector = vectorToReduce(source.table)
    const { assetId } = source.table
    if (vector === null) {
      setReduction({ kind: 'idle' })
      return
    }
    setReduction({ kind: 'running', assetId })
    const job = startPca(vector)
    let alive = true
    void job.result
      .then((result) => {
        if (alive) setReduction({ kind: 'done', assetId, result })
      })
      .catch(() => {
        // 실패하면 좌표 없이 둔다. 뷰 모델이 "만들지 못했다"고 말해 준다.
        if (alive) setReduction({ kind: 'failed', assetId })
      })
    return () => {
      alive = false
      job.cancel()
    }
  }, [source.table])

  const model: ViewModel = useMemo(() => {
    const current = reduction.kind !== 'idle' && reduction.assetId === source.table.assetId
    return toViewModel(source.table, source.label, {
      reduced: current && reduction.kind === 'done' ? reduction.result : null,
      // 계산이 도는 중일 때만 기다린다. 실패했으면 이유를 보여 줘야 한다.
      awaitingReduction: !current || reduction.kind === 'running',
    })
  }, [source.table, source.label, reduction])
  const [state, run] = useReducer(reduce, undefined, () =>
    createWorkspaceState('작업 공간 열기 · 고객문의 샘플'),
  )

  const [hovered, setHovered] = useState<number | null>(null)
  const [lasso, setLasso] = useState(false)
  const [effect, setEffect] = useState<EffectLevel>('normal')
  const [palette, setPalette] = useState(false)
  const [camera, setCamera] = useState<StoredCamera | null>(null)
  /** 저장된 작업 공간을 읽어 보기 전에는 아무것도 그리지 않는다. */
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const tablePicker = useRef<HTMLInputElement>(null)

  const { clauses } = state
  const columns = model.lookup
  const rowCount = model.rowCount

  // 뷰마다 빼는 조건이 달라서 네 번 합친다. 만 행 규모에서는 한 프레임 안에 끝난다.
  const everything = useMemo(
    () => composeSelection(rowCount, clauses, columns),
    [rowCount, clauses, columns],
  )
  const forTable = useMemo(
    () => composeSelection(rowCount, clauses, columns, { exclude: TABLE }),
    [rowCount, clauses, columns],
  )
  const forBars = useMemo(
    () => composeSelection(rowCount, clauses, columns, { exclude: BARS }),
    [rowCount, clauses, columns],
  )
  const forHistogram = useMemo(
    () => composeSelection(rowCount, clauses, columns, { exclude: HISTOGRAM }),
    [rowCount, clauses, columns],
  )

  const tableRows = useMemo(() => maskToRowIndices(forTable), [forTable])

  // 군집 라벨 자리. 표가 바뀔 때만 다시 센다.
  const anchors = useMemo(
    () =>
      model.position === null || model.category === null
        ? []
        : anchorsOf(model.position, model.category),
    [model],
  )

  const selectedCodes = categoriesOf(clauses)
  /** 조건은 원본 코드로 적혀 있고 그래프는 자리 번호로 그린다. 자리마다 대표 코드로 맞춰 본다. */
  const categorySlots = useMemo(() => {
    const role = model.category
    if (role === null || selectedCodes.length === 0) return []
    return role.codesOfSlot
      .map((codes, slot) => (codes.some((code) => selectedCodes.includes(code)) ? slot : -1))
      .filter((slot) => slot >= 0)
  }, [model, selectedCodes])
  const range = rangeOf(clauses)
  const picked = pickedOf(clauses)
  const hasSelection = clauses.size > 0

  /*
   * 저장된 작업 공간을 한 번만 읽어 본다. 이것이 끝나기 전에 저장하면 빈 상태로 덮어쓴다.
   * 표를 갈아 끼울 때 다시 읽으면, 방금 비운 선택 위에 이전 표의 선택이 되살아난다.
   */
  const loadedOnce = useRef(false)
  useEffect(() => {
    if (loadedOnce.current) return
    loadedOnce.current = true
    let alive = true
    void loadWorkspace().then((file) => {
      if (!alive) return
      // 비어 있는 파일을 되살렸다고 알리면, 지운 사람에게 없던 일을 말하는 것이 된다.
      if (file !== null && (file.clauses.length > 0 || file.camera !== null)) {
        const restored = fromWorkspaceFile(file, rowCount)
        setEffect(toEffectLevel(restored.effect))
        setCamera(restored.camera)
        run({
          kind: 'select',
          label:
            restored.dropped.length === 0
              ? '저장된 작업 공간 되살리기'
              : `저장된 작업 공간 되살리기 · 고정 선택 ${restored.dropped.length}개는 표가 달라 버림`,
          next: () => restored.clauses,
        })
      }
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  // 조건이 바뀔 때마다 저장한다. 남기는 것은 조건과 카메라뿐이다.
  useEffect(() => {
    if (!ready) return
    // 남길 것이 없으면 빈 파일을 쓰지 않고 지운다. 그래야 "비우기"가 정말 비운 것이 된다.
    if (clauses.size === 0 && camera === null) {
      void clearWorkspace()
      return
    }
    void saveWorkspace(toWorkspaceFile({ clauses, rowCount, camera, effect }, new Date()))
  }, [ready, clauses, rowCount, camera, effect])

  // 안내 문구는 잠깐만 보여 준다. 남은 기록은 활동 기록에 있다.
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const exportWorkspace = useCallback(() => {
    const file = toWorkspaceFile({ clauses, rowCount, camera, effect }, new Date())
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `holo-workspace-${fileStamp(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)
    run({ kind: 'note', label: '작업 공간 내보내기' })
  }, [clauses, rowCount, camera, effect])

  const importWorkspace = useCallback(
    async (blob: File) => {
      let value: unknown
      try {
        value = JSON.parse(await blob.text())
      } catch {
        setNotice('JSON으로 읽히지 않는 파일이다.')
        run({ kind: 'note', label: '불러오기 실패 · JSON이 아니다' })
        return
      }
      const parsed = parseWorkspaceFile(value)
      if (!parsed.ok) {
        setNotice(parsed.reason)
        run({ kind: 'note', label: `불러오기 실패 · ${parsed.reason}` })
        return
      }
      const restored = fromWorkspaceFile(parsed.file, rowCount)
      setEffect(toEffectLevel(restored.effect))
      setCamera(restored.camera)
      if (restored.dropped.length > 0) {
        setNotice(`표가 달라서 고정 선택 ${restored.dropped.length}개는 가져오지 못했다.`)
      }
      run({
        kind: 'select',
        label: `작업 공간 불러오기 · ${blob.name}`,
        next: () => restored.clauses,
      })
    },
    [rowCount],
  )

  const forgetWorkspace = useCallback(() => {
    void clearWorkspace()
    setCamera(null)
    run({ kind: 'select', label: '저장한 작업 공간 비우기', next: () => new Map() })
  }, [])

  /**
   * 표를 갈아 끼울 때는 조건과 카메라를 같이 비운다. 이전 표의 올가미 선택이
   * 그대로 남으면 남의 행 번호를 가리키고, 카메라는 좌표 범위가 달라 엉뚱한 곳을 본다.
   */
  const openTable = useCallback((table: LoadedTable, label: string) => {
    setSource({ table, label })
    setCamera(null)
    setHovered(null)
    run({ kind: 'select', label: `자산 열기 · ${label}`, next: () => new Map() })
  }, [])

  const openSample = useCallback(() => {
    openTable(sampleLoadedTable(), '고객문의 샘플')
  }, [openTable])

  /*
   * 파일 읽기도 워커에서 돈다. 5만 행짜리 파일이면 읽기·파싱·종류 판별에 수 초가
   * 걸리고, 본 스레드에서 돌리면 그동안 화면이 통째로 굳는다.
   *
   * 읽는 동안에는 이전 표가 그대로 보인다. 화면을 비워 두면 잘못 떨어뜨렸을 때
   * 돌아갈 자리가 없어진다.
   */
  const reading = useRef<TableJob | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const openFile = useCallback(
    async (blob: File) => {
      reading.current?.cancel()
      const job = startTableRead(blob)
      reading.current = job
      setNotice(null)
      setBusy(blob.name)
      try {
        const table = await job.result
        if (reading.current !== job) return
        openTable(table, blob.name)
      } catch (error) {
        if (reading.current !== job) return
        const message =
          error instanceof UnsupportedFileError
            ? error.message
            : `'${blob.name}'을(를) 읽지 못했다.`
        setNotice(message)
        run({ kind: 'note', label: `파일 열기 실패 · ${blob.name}` })
      } finally {
        if (reading.current === job) {
          reading.current = null
          setBusy(null)
        }
      }
    },
    [openTable],
  )

  // 화면을 떠날 때 읽던 것을 멈춘다. 워커가 남아 계속 돌면 안 된다.
  useEffect(() => () => reading.current?.cancel(), [])

  const clearAll = useCallback(() => {
    if (clauses.size === 0) return
    run({ kind: 'select', label: '선택 해제', next: () => new Map() })
  }, [clauses.size])

  const setEffectLevel = useCallback((level: EffectLevel, label: string) => {
    setEffect(level)
    run({ kind: 'note', label: `효과 강도 · ${label}` })
  }, [])

  const toggleLasso = useCallback(() => {
    setLasso((on) => {
      run({ kind: 'note', label: `올가미 ${on ? '끔' : '켬'}` })
      return !on
    })
  }, [])

  function onLasso(rows: RowMask | null, picked: number) {
    if (rows === null) {
      if (clauses.has(POINTS)) {
        run({ kind: 'select', label: '올가미 해제', next: withClause(POINTS, null) })
      }
      return
    }
    run({
      kind: 'select',
      label: `올가미 선택 · ${count(picked)}개 점`,
      next: withClause(POINTS, { kind: 'rows', rows }),
    })
  }

  function onPickRow(row: number) {
    if (picked === row) {
      run({ kind: 'select', label: '행 선택 해제', next: withClause(TABLE, null) })
      return
    }
    const rows = new Uint8Array(rowCount)
    rows[row] = 1
    run({
      kind: 'select',
      label: `행 선택 · ${model.rowLabel(row)}`,
      next: withClause(TABLE, { kind: 'rows', rows }),
    })
  }

  /**
   * 분포 그래프는 자리 번호로 말하고 조건은 원본 코드로 적는다.
   * "기타" 자리 하나가 값 여러 개를 덮기 때문에 그 사이를 여기서 편다.
   */
  function onCategories(slots: readonly number[]) {
    const role = model.category
    if (role === undefined || role === null) return
    const added = slots.filter((slot) => !categorySlots.includes(slot))
    const changed = added[0] ?? categorySlots.find((slot) => !slots.includes(slot)) ?? 0
    const name = role.names[changed] ?? ''
    const codes = slots.flatMap((slot) => role.codesOfSlot[slot] ?? [])
    run({
      kind: 'select',
      label:
        slots.length === 0
          ? `${role.column} 해제`
          : `${role.column} ${added.length > 0 ? '선택' : '해제'} · ${name}`,
      next: withClause(
        BARS,
        slots.length === 0 ? null : { kind: 'category', column: role.column, values: codes },
      ),
    })
  }

  function onRange(next: { min: number; max: number } | null) {
    if (next === null) {
      if (clauses.has(HISTOGRAM)) {
        run({ kind: 'select', label: '구간 해제', next: withClause(HISTOGRAM, null) })
      }
      return
    }
    const measure = model.measure
    if (measure === null) return
    run({
      kind: 'select',
      label: `${measure.column} 구간 · ${next.min.toFixed(2)} ~ ${next.max.toFixed(2)}`,
      next: withClause(HISTOGRAM, {
        kind: 'range',
        column: measure.column,
        min: next.min,
        max: next.max,
      }),
    })
  }

  const commands = useMemo<readonly PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { group: '선택', label: '선택 해제', disabled: !hasSelection, run: clearAll },
      {
        group: '편집',
        label: '되돌리기',
        disabled: !canUndo(state),
        run: () => run({ kind: 'undo' } satisfies Command),
      },
      {
        group: '뷰',
        label: `올가미 선택 ${lasso ? '끄기' : '켜기'}`,
        run: toggleLasso,
      },
    ]
    for (const { level, label } of EFFECT_LABELS) {
      list.push({
        group: '효과',
        label: `효과 강도 · ${label}`,
        disabled: effect === level,
        run: () => setEffectLevel(level, label),
      })
    }
    list.push(
      { group: '작업 공간', label: '작업 공간 내보내기', run: exportWorkspace },
      { group: '작업 공간', label: '작업 공간 불러오기', run: () => picker.current?.click() },
      { group: '작업 공간', label: '저장한 작업 공간 비우기', run: forgetWorkspace },
    )
    list.push({ group: '자산', label: '파일 열기', run: () => tablePicker.current?.click() })
    if (model.assetId !== SAMPLE_ASSET) {
      list.push({ group: '자산', label: '샘플로 돌아가기', run: openSample })
    }
    const role = model.category
    if (role !== null) {
      role.names.forEach((name, slot) => {
        list.push({
          group: '선택',
          label: `${role.column}만 보기 · ${name}`,
          run: () =>
            run({
              kind: 'select',
              label: `${role.column}만 보기 · ${name}`,
              next: withClause(BARS, {
                kind: 'category',
                column: role.column,
                values: [...(role.codesOfSlot[slot] ?? [])],
              }),
            }),
        })
      })
    }
    return list
  }, [
    state,
    hasSelection,
    lasso,
    effect,
    model,
    clearAll,
    toggleLasso,
    setEffectLevel,
    exportWorkspace,
    forgetWorkspace,
    openSample,
  ])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
        return
      }
      // 팔레트가 열려 있으면 팔레트가 키를 맡는다. 입력란에 글자를 치는 중일 수도 있다.
      if (palette) return
      if (event.key === 'Escape') clearAll()
      if (event.key === 'l' || event.key === 'L') toggleLasso()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette, clearAll, toggleLasso])

  const pointColorOf = useCallback(
    (row: number) => {
      const role = model.category
      return role === null ? 0 : role.colorOfSlot(role.slotOf(row))
    },
    [model],
  )

  const hoveredText = hovered === null ? null : model.rowLabel(hovered)
  const hoveredSlot =
    hovered === null || model.category === null ? -1 : model.category.slotOf(hovered)
  const hoveredColor = model.category === null ? 0 : model.category.colorOfSlot(hoveredSlot)
  const hoveredName = hoveredSlot < 0 ? '' : (model.category?.names[hoveredSlot] ?? '')

  return (
    <main className="holo-workspace">
      <header className="holo-header">
        <h1>홀로그램 데이터 뷰어</h1>
        <p className="holo-caption">
          {model.label} · {count(rowCount)}행 · 선택 {count(everything.count)}건
        </p>
        <div className="holo-controls">
          <button
            type="button"
            className={'holo-chip' + (lasso ? ' is-on' : '')}
            onClick={toggleLasso}
          >
            올가미 {lasso ? '켜짐' : '꺼짐'}
          </button>
          {EFFECT_LABELS.map(({ level, label }) => (
            <button
              type="button"
              key={level}
              className={'holo-chip' + (effect === level ? ' is-on' : '')}
              onClick={() => setEffectLevel(level, label)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="holo-chip"
            onClick={() => run({ kind: 'undo' })}
            disabled={!canUndo(state)}
          >
            되돌리기
          </button>
          <button type="button" className="holo-chip" onClick={clearAll} disabled={!hasSelection}>
            선택 해제
          </button>
          <button type="button" className="holo-chip" onClick={() => setPalette(true)}>
            명령 Ctrl+K
          </button>
        </div>
      </header>

      <div className="holo-main">
        <div className="holo-stage-slot">
          {model.position === null ? (
            <div className="holo-stage-empty">
              <p>{model.positionMissing}</p>
              <p className="holo-caption">
                {model.positionPending
                  ? '계산은 화면 밖에서 돕니다. 그동안에도 표와 분포 그래프는 만질 수 있습니다.'
                  : '표와 분포 그래프는 그대로 쓸 수 있습니다.'}
              </p>
            </div>
          ) : (
            <PointCloudView
              rowCount={rowCount}
              positions={model.position}
              anchors={anchors}
              colorOf={pointColorOf}
              selected={everything.mask}
              effect={effect}
              lasso={lasso}
              onHover={setHovered}
              onLasso={onLasso}
              camera={camera}
              onCameraRest={setCamera}
            />
          )}
          <p className="holo-readout">
            {busy !== null ? (
              <span className="holo-caption">{busy}을(를) 읽고 있습니다…</span>
            ) : notice !== null ? (
              <span className="holo-notice">{notice}</span>
            ) : hoveredText === null ? (
              <span className="holo-caption">
                {model.position?.derivedFrom ??
                  '점 위에 올리면 원문이 보인다. 올가미를 켜고 끌면 영역을 고른다.'}
              </span>
            ) : (
              <>
                {hoveredName === '' ? null : (
                  <span className="holo-tag" style={{ color: `var(--holo-cat-${hoveredColor})` }}>
                    {hoveredName}
                  </span>
                )}
                {hoveredText}
              </>
            )}
          </p>
        </div>

        <aside className="holo-side">
          <FileDropZone compact onLoaded={(next, name) => openTable(next, name)} />
          <DistributionView
            rowCount={rowCount}
            category={model.category}
            measure={model.measure}
            visibleForCategories={forBars.mask}
            visibleForMeasure={forHistogram.mask}
            categories={categorySlots}
            range={range}
            onCategories={onCategories}
            onRange={onRange}
          />
          <ActivityLog entries={state.log} />
        </aside>
      </div>

      <section className="holo-bottom">
        <TableView
          columns={model.columns}
          rows={tableRows}
          visibleCount={forTable.count}
          hovered={hovered}
          onHover={setHovered}
          picked={picked}
          onPick={onPickRow}
        />
      </section>

      <input
        ref={tablePicker}
        type="file"
        accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson"
        hidden
        onChange={(event) => {
          const blob = event.target.files?.[0]
          event.target.value = ''
          if (blob) void openFile(blob)
        }}
      />

      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const blob = event.target.files?.[0]
          // 같은 파일을 두 번 고를 수 있어야 한다. 값을 비우지 않으면 change가 오지 않는다.
          event.target.value = ''
          if (blob) void importWorkspace(blob)
        }}
      />

      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
    </main>
  )
}
