import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  composeSelection,
  maskToRowIndices,
  type RowMask,
  type SelectionClause,
  type SelectionSource,
} from '@holo/core'
import { SAMPLE_CATEGORIES, createSampleTable } from '@holo/data'
import type { EffectLevel } from '@holo/holo-fx'
import { DistributionView, PointCloudView, TableView } from '@holo/views'

/**
 * 작업 공간 — 세 뷰를 선택 코디네이터 하나로 묶는 곳.
 *
 * 뷰끼리는 서로를 부르지 않는다. 각자 조건을 발행하고 여기서 AND로 합친 결과만 받는다.
 * 3D 점 뷰는 합친 선택을 그대로 받아 강조하고, 표와 분포 그래프는 자기 조건을 뺀
 * 나머지를 받아 걸러 낸다(설계 문서 5장).
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

export function Workspace() {
  const table = useMemo(() => createSampleTable(12_000), [])

  const [lassoRows, setLassoRows] = useState<RowMask | null>(null)
  const [pickedRow, setPickedRow] = useState<RowMask | null>(null)
  const [categories, setCategories] = useState<readonly number[]>([])
  const [range, setRange] = useState<{ min: number; max: number } | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [lasso, setLasso] = useState(false)
  const [effect, setEffect] = useState<EffectLevel>('normal')

  const clauses = useMemo(() => {
    const map = new Map<SelectionSource, SelectionClause>()
    if (lassoRows !== null) map.set(POINTS, { kind: 'rows', rows: lassoRows })
    if (pickedRow !== null) map.set(TABLE, { kind: 'rows', rows: pickedRow })
    if (categories.length > 0) {
      map.set(BARS, { kind: 'category', column: 'category', values: categories })
    }
    if (range !== null) {
      map.set(HISTOGRAM, { kind: 'range', column: 'sentiment', min: range.min, max: range.max })
    }
    return map
  }, [lassoRows, pickedRow, categories, range])

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

  const clearAll = useCallback(() => {
    setLassoRows(null)
    setPickedRow(null)
    setCategories([])
    setRange(null)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') clearAll()
      if (event.key === 'l' || event.key === 'L') setLasso((on) => !on)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearAll])

  const hoveredText = hovered === null ? null : table.textOf(hovered)
  const hasSelection = clauses.size > 0

  return (
    <main className="holo-workspace">
      <header className="holo-header">
        <h1>홀로그램 데이터 뷰어</h1>
        <p className="holo-caption">
          샘플 문의 {rowCount.toLocaleString('ko-KR')}건 · 선택{' '}
          {everything.count.toLocaleString('ko-KR')}건
        </p>
        <div className="holo-controls">
          <button
            type="button"
            className={'holo-chip' + (lasso ? ' is-on' : '')}
            onClick={() => setLasso((on) => !on)}
          >
            올가미 {lasso ? '켜짐' : '꺼짐'}
          </button>
          {EFFECT_LABELS.map(({ level, label }) => (
            <button
              type="button"
              key={level}
              className={'holo-chip' + (effect === level ? ' is-on' : '')}
              onClick={() => setEffect(level)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="holo-chip" onClick={clearAll} disabled={!hasSelection}>
            선택 해제
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
            onLasso={(rows) => setLassoRows(rows)}
          />
          <p className="holo-readout">
            {hoveredText === null ? (
              <span className="holo-caption">
                점 위에 올리면 원문이 보인다. 올가미를 켜고 끌면 영역을 고른다.
              </span>
            ) : (
              <>
                <span
                  className="holo-tag"
                  style={{ color: `var(--holo-cat-${table.category[hovered ?? 0] ?? 0})` }}
                >
                  {SAMPLE_CATEGORIES[table.category[hovered ?? 0] ?? 0] ?? '기타'}
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
            onCategories={setCategories}
            onRange={setRange}
          />
        </aside>
      </div>

      <section className="holo-bottom">
        <TableView
          table={table}
          rows={tableRows}
          visibleCount={forTable.count}
          hovered={hovered}
          onHover={setHovered}
          onPick={(rows) => setPickedRow(rows)}
        />
      </section>
    </main>
  )
}
