import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * 칸 사이 손잡이. 끌어서 옆 패널 폭이나 아래 표 높이를 바꾼다.
 *
 * 끄는 동안에는 `onMove`로 미리 보여 주기만 하고, 놓을 때 `onCommit`을 한 번 부른다.
 * 되돌리기 칸이 픽셀마다 쌓이지 않고 한 번 끈 것이 한 칸이 되게 하려는 것이다.
 * 두 번 누르면 기본 크기로 돌아간다.
 *
 * 키보드로도 된다(설계 문서 2장 "모든 기능은 마우스와 키보드만으로"). 손잡이에 초점을
 * 두고 화살표로 한 번에 16픽셀, Shift를 누르면 64픽셀 옮긴다.
 */
export type SplitterProps = {
  /** vertical은 좌우로 끄는 세로 막대(옆 패널), horizontal은 위아래로 끄는 가로 막대(아래 표). */
  orientation: 'vertical' | 'horizontal'
  /** 화면 읽기 프로그램에 알릴 이름. */
  label: string
  /** 지금 값과 범위. 화면 읽기 프로그램이 "몇 중 몇"으로 읽는다. */
  value: number
  min: number
  max: number
  /** 끄는 중. 누른 자리에서 옮겨 간 픽셀. */
  onMove: (delta: number) => void
  /** 놓았다. 옮겨 간 픽셀. 움직이지 않았으면 부르지 않는다. */
  onCommit: (delta: number) => void
  onReset: () => void
}

const STEP = 16
const BIG_STEP = 64

export function Splitter(props: SplitterProps) {
  const { orientation, label, value, min, max, onMove, onCommit, onReset } = props
  const start = useRef<number | null>(null)
  const moved = useRef(0)

  const along = (event: PointerEvent) =>
    orientation === 'vertical' ? event.clientX : event.clientY

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = along(event)
    moved.current = 0
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (start.current === null) return
    moved.current = along(event) - start.current
    onMove(moved.current)
  }

  /** 놓으면 적용하고, 브라우저가 끌기를 가로채면(cancel) 없던 일로 한다. */
  function finish(event: PointerEvent<HTMLDivElement>, apply: boolean) {
    if (start.current === null) return
    start.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const delta = moved.current
    moved.current = 0
    if (apply && delta !== 0) onCommit(delta)
    else onMove(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP : STEP
    const keys =
      orientation === 'vertical'
        ? { ArrowLeft: -step, ArrowRight: step }
        : { ArrowUp: -step, ArrowDown: step }
    const delta = (keys as Record<string, number | undefined>)[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      onCommit(delta)
      return
    }
    if (event.key === 'Home' || event.key === 'Enter') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      className={`holo-splitter is-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title={`${label} · 끌어서 크기 조절, 두 번 누르면 처음 크기`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
