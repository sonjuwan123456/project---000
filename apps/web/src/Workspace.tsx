import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import {
  applyCommand,
  canUndo,
  composeSelection,
  createWorkspaceState,
  maskToRowIndices,
  type Command,
  type RowMask,
  type SelectionClause,
  type SelectionClauses,
  type SelectionSource,
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
 * 남길 것이 조건뿐이기 때문이다.
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
  }, [state, hasSelection, lasso, effect, clearAll, toggleLasso, setEffectLevel])

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
          />
          <p className="holo-readout">
            {hoveredText === null ? (
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

      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
    </main>
  )
}
