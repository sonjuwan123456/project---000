import { useEffect, useMemo, useRef, useState } from 'react'
import type { ViewColumn } from '@holo/data'

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
  /** 표에 그릴 컬럼. 순서가 그대로 칸 순서다. */
  columns: readonly ViewColumn[]
  /** 코디네이터가 준 보이는 행 번호. null이면 전체 행이 순서대로 보인다. */
  rows: Int32Array | null
  /** 보이는 행 수. rows가 null이면 전체 행 수. */
  visibleCount: number
  hovered: number | null
  onHover: (row: number | null) => void
  /** 지금 이 표가 골라 둔 행. 선택은 작업 공간이 들고 있다. */
  picked: number | null
  /** 행을 누르면 알린다. 같은 행을 다시 누르는 것은 해제로 해석하는 쪽이 정한다. */
  onPick: (row: number) => void
}

const ROW_HEIGHT = 34
/** 위아래로 더 만들어 두는 행. 빠르게 스크롤할 때 빈 칸이 스치는 것을 막는다. */
const OVERSCAN = 6

/**
 * 칸 너비. 글자 컬럼은 남는 자리를 나눠 갖고, 나머지는 내용에 맞춘 고정 폭이다.
 * 컬럼 수가 파일마다 다르니 CSS에 적어 둘 수 없다.
 */
function gridTemplate(columns: readonly ViewColumn[]): string {
  if (columns.length === 0) return 'minmax(0, 1fr)'
  const widths: string[] = columns.map((column) => {
    if (column.kind === 'text') return 'minmax(0, 2fr)'
    if (column.kind === 'tag') return 'minmax(4.5em, 0.8fr)'
    return 'minmax(4em, 0.6fr)'
  })
  // 글자 컬럼이 하나도 없으면 전부 고정 폭이라 표가 왼쪽에 몰린다.
  if (!columns.some((column) => column.kind === 'text')) widths.push('minmax(0, 1fr)')
  return widths.join(' ')
}

function cellClass(kind: ViewColumn['kind']): string {
  if (kind === 'text') return 'holo-cell-text'
  if (kind === 'tag') return 'holo-cell-tag'
  return 'holo-cell-num'
}

export function TableView(props: TableViewProps) {
  const { columns, rows, visibleCount, hovered, onHover, picked, onPick } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [first, setFirst] = useState(0)
  const [window_, setWindow] = useState(24)

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

  const template = useMemo(() => gridTemplate(columns), [columns])
  const start = Math.max(0, first - OVERSCAN)
  const end = Math.min(visibleCount, start + window_)
  const slice: number[] = []
  for (let index = start; index < end; index += 1) {
    slice.push(rows === null ? index : (rows[index] ?? 0))
  }

  return (
    <div className="holo-table">
      <div className="holo-table-head" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <span key={column.name}>{column.name}</span>
        ))}
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
                style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
                onPointerEnter={() => onHover(row)}
                onClick={() => onPick(row)}
              >
                {columns.map((column) => (
                  <span
                    key={column.name}
                    className={cellClass(column.kind)}
                    style={
                      column.colorOf === null
                        ? undefined
                        : { color: `var(--holo-cat-${column.colorOf(row)})` }
                    }
                  >
                    {column.textOf(row)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
