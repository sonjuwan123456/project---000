import { useEffect, useRef, useState } from 'react'
import type { RowMask } from '@holo/core'
import { SAMPLE_CATEGORIES, type SampleTable } from '@holo/data'

/**
 * 표 뷰 — 설계 문서 5장의 "필터" 반응을 맡는 뷰.
 *
 * 선택에서 빠진 행은 지운다. 표는 읽으려고 보는 화면이라 흐린 행이 섞이면
 * 오히려 방해가 되기 때문이다.
 *
 * 만 행을 그대로 DOM에 올리면 스크롤이 끊기므로 보이는 구간만 만든다.
 * 행 높이를 고정해 두면 스크롤 위치에서 몇 번째 행인지 바로 계산할 수 있다.
 */
export type TableViewProps = {
  table: SampleTable
  /** 코디네이터가 준 보이는 행 번호. null이면 전체 행이 순서대로 보인다. */
  rows: Int32Array | null
  /** 보이는 행 수. rows가 null이면 전체 행 수. */
  visibleCount: number
  hovered: number | null
  onHover: (row: number | null) => void
  /** 행을 누르면 그 행 하나만 남긴다. 같은 행을 다시 누르면 푼다. */
  onPick: (rows: RowMask | null, count: number) => void
}

const ROW_HEIGHT = 34
/** 위아래로 더 만들어 두는 행. 빠르게 스크롤할 때 빈 칸이 스치는 것을 막는다. */
const OVERSCAN = 6

const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' })

function sentimentLabel(value: number): string {
  if (value <= -0.3) return '부정'
  if (value >= 0.3) return '긍정'
  return '중립'
}

export function TableView(props: TableViewProps) {
  const { table, rows, visibleCount, hovered, onHover, onPick } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [first, setFirst] = useState(0)
  const [window_, setWindow] = useState(24)
  const [picked, setPicked] = useState<number | null>(null)

  // 조건이 바뀌면 보이는 행 자체가 달라진다. 스크롤 위치를 그대로 두면 엉뚱한 곳을 보게 된다.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
    setFirst(0)
  }, [rows, visibleCount])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setWindow(Math.ceil(element.clientHeight / ROW_HEIGHT) + OVERSCAN * 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const start = Math.max(0, first - OVERSCAN)
  const end = Math.min(visibleCount, start + window_)
  const slice: number[] = []
  for (let index = start; index < end; index += 1) {
    slice.push(rows === null ? index : (rows[index] ?? 0))
  }

  function handlePick(row: number) {
    if (picked === row) {
      setPicked(null)
      onPick(null, 0)
      return
    }
    const mask = new Uint8Array(table.rowCount)
    mask[row] = 1
    setPicked(row)
    onPick(mask, 1)
  }

  return (
    <div className="holo-table">
      <div className="holo-table-head">
        <span>원문</span>
        <span>범주</span>
        <span>감성</span>
        <span>글자</span>
        <span>날짜</span>
      </div>
      <div
        className="holo-table-body"
        ref={scroller}
        onScroll={(event) => setFirst(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT))}
        onPointerLeave={() => onHover(null)}
      >
        <div style={{ height: visibleCount * ROW_HEIGHT, position: 'relative' }}>
          <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
            {slice.map((row) => (
              <div
                key={row}
                className={
                  'holo-table-row' +
                  (row === hovered ? ' is-hovered' : '') +
                  (row === picked ? ' is-picked' : '')
                }
                style={{ height: ROW_HEIGHT }}
                onPointerEnter={() => onHover(row)}
                onClick={() => handlePick(row)}
              >
                <span className="holo-cell-text">{table.textOf(row)}</span>
                <span
                  className="holo-cell-tag"
                  style={{ color: `var(--holo-cat-${table.category[row] ?? 0})` }}
                >
                  {SAMPLE_CATEGORIES[table.category[row] ?? 0] ?? '기타'}
                </span>
                <span className="holo-cell-num">{sentimentLabel(table.sentiment[row] ?? 0)}</span>
                <span className="holo-cell-num">{table.charCount[row] ?? 0}</span>
                <span className="holo-cell-num">{dateFormat.format(table.dateOf(row))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
