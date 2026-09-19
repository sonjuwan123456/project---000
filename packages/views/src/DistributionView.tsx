import { useMemo, useRef, useState } from 'react'
import type { CategoryRole, MeasureRole } from '@holo/data'

/**
 * 분포 그래프 — 표와 같은 "필터" 반응 뷰.
 *
 * 범주 막대는 눌러서 값을 고르고, 감성 히스토그램은 끌어서 구간을 고른다.
 * 둘은 조건을 따로 발행하는 별개의 뷰다. 그래야 범주 막대가 감성 구간을 반영해
 * 높이를 바꾸면서도, 자기가 고른 막대 때문에 나머지 막대가 사라지지는 않는다
 * (설계 문서 5장: 각 뷰는 자기 조건을 뺀 나머지만 적용받는다).
 *
 * 막대 높이는 보이는 행만 세서 정한다. 만 행을 세는 것은 한 프레임 안에 끝난다.
 */
export type DistributionViewProps = {
  rowCount: number
  /** 막대에 쓸 범주 컬럼. 없으면 막대를 그리지 않는다. */
  category: CategoryRole | null
  /** 히스토그램에 쓸 숫자 컬럼. 없으면 그리지 않는다. */
  measure: MeasureRole | null
  /** 범주 조건을 뺀 선택. 막대 높이는 이것으로 센다. null이면 전체. */
  visibleForCategories: Uint8Array | null
  /** 숫자 조건을 뺀 선택. 히스토그램 높이는 이것으로 센다. null이면 전체. */
  visibleForMeasure: Uint8Array | null
  /** 지금 고른 범주 자리들. 빈 배열이면 조건 없음. */
  categories: readonly number[]
  /** 지금 고른 숫자 구간. null이면 조건 없음. */
  range: { min: number; max: number } | null
  onCategories: (values: readonly number[]) => void
  onRange: (range: { min: number; max: number } | null) => void
}

const BINS = 28

function countBy(
  rowCount: number,
  visible: Uint8Array | null,
  bucketOf: (row: number) => number,
  buckets: number,
): Uint32Array {
  const counts = new Uint32Array(buckets)
  for (let row = 0; row < rowCount; row += 1) {
    if (visible !== null && visible[row] !== 1) continue
    const bucket = bucketOf(row)
    if (bucket >= 0 && bucket < buckets) counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  return counts
}

function maxOf(counts: Uint32Array): number {
  let max = 1
  for (const value of counts) if (value > max) max = value
  return max
}

function binOf(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return -1
  const width = max - min
  const ratio = width === 0 ? 0 : (value - min) / width
  return Math.min(BINS - 1, Math.max(0, Math.floor(ratio * BINS)))
}

/** 눈금 글자. 값의 크기에 따라 자릿수를 줄인다. */
function tick(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return value.toLocaleString('ko-KR')
  return value.toLocaleString('ko-KR', { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 })
}

export function DistributionView(props: DistributionViewProps) {
  const { rowCount, category, measure, visibleForCategories, visibleForMeasure } = props
  const { categories, range, onCategories, onRange } = props

  const categoryCounts = useMemo(
    () =>
      category === null
        ? new Uint32Array(0)
        : countBy(
            rowCount,
            visibleForCategories,
            (row) => category.slotOf(row),
            category.names.length,
          ),
    [rowCount, category, visibleForCategories],
  )
  const measureCounts = useMemo(
    () =>
      measure === null
        ? new Uint32Array(0)
        : countBy(
            rowCount,
            visibleForMeasure,
            (row) => binOf(measure.values[row] ?? Number.NaN, measure.min, measure.max),
            BINS,
          ),
    [rowCount, measure, visibleForMeasure],
  )

  const categoryMax = maxOf(categoryCounts)
  const measureMax = maxOf(measureCounts)

  const brush = useRef<{ from: number } | null>(null)
  const [dragging, setDragging] = useState<{ min: number; max: number } | null>(null)

  function ratioAt(event: React.PointerEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  }
  function toValue(ratio: number): number {
    if (measure === null) return 0
    return measure.min + ratio * (measure.max - measure.min)
  }

  function toggleCategory(value: number) {
    const next = categories.includes(value)
      ? categories.filter((item) => item !== value)
      : [...categories, value]
    onCategories(next)
  }

  const shown = dragging ?? range

  return (
    <div className="holo-charts">
      {category === null ? null : (
        <section className="holo-chart">
          <h3>{category.column}</h3>
          <div className="holo-bars">
            {category.names.map((name, index) => {
              const count = categoryCounts[index] ?? 0
              const on = categories.length === 0 || categories.includes(index)
              return (
                <button
                  type="button"
                  key={name}
                  className={'holo-bar' + (on ? '' : ' is-off')}
                  onClick={() => toggleCategory(index)}
                  aria-pressed={categories.includes(index)}
                >
                  <span className="holo-bar-name">{name}</span>
                  <span className="holo-bar-track">
                    <span
                      className="holo-bar-fill"
                      style={{
                        width: `${(count / categoryMax) * 100}%`,
                        background: `var(--holo-cat-${category.colorOfSlot(index)})`,
                      }}
                    />
                  </span>
                  <span className="holo-bar-count">{count.toLocaleString('ko-KR')}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {measure === null ? null : (
        <section className="holo-chart">
          <h3>
            {measure.column}
            {range === null ? null : (
              <button type="button" className="holo-chip" onClick={() => onRange(null)}>
                구간 해제
              </button>
            )}
          </h3>
          <div
            className="holo-histogram"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              const at = toValue(ratioAt(event))
              brush.current = { from: at }
              setDragging({ min: at, max: at })
            }}
            onPointerMove={(event) => {
              const from = brush.current
              if (!from) return
              const at = toValue(ratioAt(event))
              setDragging({ min: Math.min(from.from, at), max: Math.max(from.from, at) })
            }}
            onPointerUp={() => {
              const picked = dragging
              brush.current = null
              setDragging(null)
              // 끌지 않고 누르기만 한 것은 구간 해제로 본다.
              // 끌지 않고 누르기만 한 것은 구간 해제로 본다. 폭은 값의 범위에 견준다.
              const tiny = (measure.max - measure.min) * 0.02
              if (!picked || picked.max - picked.min <= tiny) onRange(null)
              else onRange(picked)
            }}
          >
            {Array.from({ length: BINS }, (_, index) => {
              const count = measureCounts[index] ?? 0
              const width = measure.max - measure.min
              const left = measure.min + (index / BINS) * width
              const right = measure.min + ((index + 1) / BINS) * width
              const inRange = shown === null || (right > shown.min && left < shown.max)
              return (
                <span
                  key={index}
                  className={'holo-hist-bar' + (inRange ? '' : ' is-off')}
                  style={{ height: `${Math.max(2, (count / measureMax) * 100)}%` }}
                />
              )
            })}
          </div>
          <div className="holo-axis">
            <span>{tick(measure.min)}</span>
            <span>{tick((measure.min + measure.max) / 2)}</span>
            <span>{tick(measure.max)}</span>
          </div>
        </section>
      )}
    </div>
  )
}
