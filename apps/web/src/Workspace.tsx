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
import { SAMPLE_CATEGORIES, createSampleTable } from '@holo/data'
import type { EffectLevel } from '@holo/holo-fx'
import {
  ActivityLog,
  CommandPalette,
  DistributionView,
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

export function Workspace() {
  const table = useMemo(() => createSampleTable(12_000), [])
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

  const { clauses } = state
  const columns = table.columns
  const rowCount = table.rowCount

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

  const categories = categoriesOf(clauses)
  const range = rangeOf(clauses)
  const picked = pickedOf(clauses)
  const hasSelection = clauses.size > 0

  // 저장된 작업 공간을 한 번 읽어 본다. 이것이 끝나기 전에 저장하면 빈 상태로 덮어쓴다.
  useEffect(() => {
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
  }, [rowCount])

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
      label: `행 선택 · ${table.textOf(row)}`,
      next: withClause(TABLE, { kind: 'rows', rows }),
    })
  }

  function onCategories(values: readonly number[]) {
    const added = values.filter((value) => !categories.includes(value))
    const name = SAMPLE_CATEGORIES[added[0] ?? categories.find((v) => !values.includes(v)) ?? 0]
    run({
      kind: 'select',
      label:
        values.length === 0 ? '범주 해제' : `범주 ${added.length > 0 ? '선택' : '해제'} · ${name}`,
      next: withClause(
        BARS,
        values.length === 0 ? null : { kind: 'category', column: 'category', values },
      ),
    })
  }

  function onRange(next: { min: number; max: number } | null) {
    if (next === null) {
      if (clauses.has(HISTOGRAM)) {
        run({ kind: 'select', label: '감성 구간 해제', next: withClause(HISTOGRAM, null) })
      }
      return
    }
    run({
      kind: 'select',
      label: `감성 구간 · ${next.min.toFixed(2)} ~ ${next.max.toFixed(2)}`,
      next: withClause(HISTOGRAM, {
        kind: 'range',
        column: 'sentiment',
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
    SAMPLE_CATEGORIES.forEach((name, index) => {
      list.push({
        group: '선택',
        label: `범주만 보기 · ${name}`,
        run: () =>
          run({
            kind: 'select',
            label: `범주만 보기 · ${name}`,
            next: withClause(BARS, { kind: 'category', column: 'category', values: [index] }),
          }),
      })
    })
    return list
  }, [
    state,
    hasSelection,
    lasso,
    effect,
    clearAll,
    toggleLasso,
    setEffectLevel,
    exportWorkspace,
    forgetWorkspace,
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

  const hoveredText = hovered === null ? null : table.textOf(hovered)
  const hoveredCategory = hovered === null ? 0 : (table.category[hovered] ?? 0)

  return (
    <main className="holo-workspace">
      <header className="holo-header">
        <h1>홀로그램 데이터 뷰어</h1>
        <p className="holo-caption">
          샘플 문의 {count(rowCount)}건 · 선택 {count(everything.count)}건
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
          <PointCloudView
            table={table}
            selected={everything.mask}
            effect={effect}
            lasso={lasso}
            onHover={setHovered}
            onLasso={onLasso}
            camera={camera}
            onCameraRest={setCamera}
          />
          <p className="holo-readout">
            {notice !== null ? (
              <span className="holo-notice">{notice}</span>
            ) : hoveredText === null ? (
              <span className="holo-caption">
                점 위에 올리면 원문이 보인다. 올가미를 켜고 끌면 영역을 고른다.
              </span>
            ) : (
              <>
                <span className="holo-tag" style={{ color: `var(--holo-cat-${hoveredCategory})` }}>
                  {SAMPLE_CATEGORIES[hoveredCategory] ?? '기타'}
                </span>
                {hoveredText}
              </>
            )}
          </p>
        </div>

        <aside className="holo-side">
          <DistributionView
            table={table}
            visibleForCategories={forBars.mask}
            visibleForSentiment={forHistogram.mask}
            categories={categories}
            range={range}
            onCategories={onCategories}
            onRange={onRange}
          />
          <ActivityLog entries={state.log} />
        </aside>
      </div>

      <section className="holo-bottom">
        <TableView
          table={table}
          rows={tableRows}
          visibleCount={forTable.count}
          hovered={hovered}
          onHover={setHovered}
          picked={picked}
          onPick={onPickRow}
        />
      </section>

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
