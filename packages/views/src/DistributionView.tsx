import { useMemo, useRef, useState } from 'react'
import { SAMPLE_CATEGORIES, type SampleTable } from '@holo/data'

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
  table: SampleTable
  /** 범주 조건을 뺀 선택. 막대 높이는 이것으로 센다. null이면 전체. */
  visibleForCategories: Uint8Array | null
  /** 감성 조건을 뺀 선택. 히스토그램 높이는 이것으로 센다. null이면 전체. */
  visibleForSentiment: Uint8Array | null
  /** 지금 고른 범주 값들. 빈 배열이면 조건 없음. */
  categories: readonly number[]
  /** 지금 고른 감성 구간. null이면 조건 없음. */
  range: { min: number; max: number } | null
  onCategories: (values: readonly number[]) => void
  onRange: (range: { min: number; max: number } | null) => void
}

const BINS = 28
const SENTIMENT_MIN = -1
const SENTIMENT_MAX = 1

function countBy(
  table: SampleTable,
  visible: Uint8Array | null,
  bucketOf: (row: number) => number,
  buckets: number,
): Uint32Array {
  const counts = new Uint32Array(buckets)
  for (let row = 0; row < table.rowCount; row += 1) {
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

function binOf(value: number): number {
  const ratio = (value - SENTIMENT_MIN) / (SENTIMENT_MAX - SENTIMENT_MIN)
  return Math.min(BINS - 1, Math.max(0, Math.floor(ratio * BINS)))
}

export function DistributionView(props: DistributionViewProps) {
  const { table, visibleForCategories, visibleForSentiment, categories, range } = props
  const { onCategories, onRange } = props

  const categoryCounts = useMemo(
    () =>
      countBy(
        table,
        visibleForCategories,
        (row) => table.category[row] ?? 0,
        SAMPLE_CATEGORIES.length,
      ),
    [table, visibleForCategories],
  )
  const sentimentCounts = useMemo(
    () => countBy(table, visibleForSentiment, (row) => binOf(table.sentiment[row] ?? 0), BINS),
    [table, visibleForSentiment],
  )

  const categoryMax = maxOf(categoryCounts)
  const sentimentMax = maxOf(sentimentCounts)

  const brush = useRef<{ from: number } | null>(null)
  const [dragging, setDragging] = useState<{ min: number; max: number } | null>(null)

  function ratioAt(event: React.PointerEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  }
  function toSentiment(ratio: number): number {
    return SENTIMENT_MIN + ratio * (SENTIMENT_MAX - SENTIMENT_MIN)
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
      <section className="holo-chart">
        <h3>범주</h3>
        <div className="holo-bars">
          {SAMPLE_CATEGORIES.map((name, index) => {
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
                      background: `var(--holo-cat-${index})`,
                    }}
                  />
                </span>
                <span className="holo-bar-count">{count.toLocaleString('ko-KR')}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="holo-chart">
        <h3>
          감성
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
            const at = toSentiment(ratioAt(event))
            brush.current = { from: at }
            setDragging({ min: at, max: at })
          }}
          onPointerMove={(event) => {
            const from = brush.current
            if (!from) return
            const at = toSentiment(ratioAt(event))
            setDragging({ min: Math.min(from.from, at), max: Math.max(from.from, at) })
          }}
          onPointerUp={() => {
            const picked = dragging
            brush.current = null
            setDragging(null)
            // 끌지 않고 누르기만 한 것은 구간 해제로 본다.
            if (!picked || picked.max - picked.min < 0.04) onRange(null)
            else onRange(picked)
          }}
        >
          {Array.from({ length: BINS }, (_, index) => {
            const count = sentimentCounts[index] ?? 0
            const left = SENTIMENT_MIN + (index / BINS) * (SENTIMENT_MAX - SENTIMENT_MIN)
            const right = SENTIMENT_MIN + ((index + 1) / BINS) * (SENTIMENT_MAX - SENTIMENT_MIN)
            const inRange = shown === null || (right > shown.min && left < shown.max)
            return (
              <span
                key={index}
                className={'holo-hist-bar' + (inRange ? '' : ' is-off')}
                style={{ height: `${Math.max(2, (count / sentimentMax) * 100)}%` }}
              />
            )
          })}
        </div>
        <div className="holo-axis">
          <span>부정</span>
          <span>중립</span>
          <span>긍정</span>
        </div>
      </section>
    </div>
  )
}
