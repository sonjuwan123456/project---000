import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { CameraDrive } from '@holo/core'
import {
  GestureInterpreter,
  createCameraGestures,
  useHandTracking,
  type Cursor,
  type DetectedHand,
  type HandTrackingStatus,
} from '@holo/input'
import './handCursors.css'

/**
 * 손으로 3D 뷰를 돌리고 확대한다 (설계 문서 10장 M0).
 *
 * 손 좌표는 초당 60번 바뀌므로 React 상태로 올리지 않는다. 해석은 `@holo/input`이 하고
 * 여기서는 화면에 닿는 두 가지만 맡는다. 집은 자리가 무대인지 보는 것과, 커서를 그리는 것.
 */

/** 화면 좌표(0~1)가 3D 무대 위인지. 표나 패널을 집었으면 카메라가 돌면 안 된다. */
function isStage(x: number, y: number): boolean {
  const element = document.elementFromPoint(x * window.innerWidth, y * window.innerHeight)
  return element?.closest('.holo-stage') != null
}

type HandCursorsProps = {
  enabled: boolean
  cursors: RefObject<readonly Cursor[]>
}

/** 손가락 자리를 링으로 그린다. 집을수록 링이 차고 작아진다. */
function HandCursors({ enabled, cursors }: HandCursorsProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const surface = canvas.current

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const g = surface?.getContext('2d')
      if (!surface || !g) return

      const dpr = Math.min(window.devicePixelRatio, 2)
      const width = window.innerWidth
      const height = window.innerHeight
      if (
        surface.width !== Math.round(width * dpr) ||
        surface.height !== Math.round(height * dpr)
      ) {
        surface.width = Math.round(width * dpr)
        surface.height = Math.round(height * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, width, height)

      for (const cursor of cursors.current) {
        const x = cursor.x * width
        const y = cursor.y * height
        const rgb = cursor.pinching ? '255,180,94' : '242,239,233'
        const radius = 22 - cursor.pinch * 10

        g.fillStyle = `rgba(${rgb},${0.06 + cursor.pinch * 0.12})`
        g.beginPath()
        g.arc(x, y, radius, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = `rgba(${rgb},0.25)`
        g.lineWidth = 1
        g.stroke()

        // 테두리가 차오르는 정도가 곧 집은 정도다. 손이 언제 잡히는지 눈으로 알 수 있다.
        g.strokeStyle = `rgba(${rgb},0.95)`
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + cursor.pinch * Math.PI * 2)
        g.stroke()

        g.fillStyle = `rgb(${rgb})`
        g.beginPath()
        g.arc(x, y, cursor.pinching ? 3.5 : 2, 0, Math.PI * 2)
        g.fill()
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(raf)
      surface?.getContext('2d')?.clearRect(0, 0, surface.width, surface.height)
    }
  }, [enabled, cursors])

  if (!enabled) return null
  return <canvas ref={canvas} className="holo-hand-layer" aria-hidden="true" />
}

export type HandGesturesProps = {
  enabled: boolean
  /** 다시 켤 때마다 올라가는 번호. 실패한 뒤 "다시 시도"가 먹히게 한다. */
  session: number
  /** 3D 뷰가 내준 카메라 손잡이. 뷰가 없으면 비어 있다. */
  drive: RefObject<CameraDrive | null>
  onStatus: (status: HandTrackingStatus, message: string | null) => void
}

export function HandGestures({ enabled, session, drive, onStatus }: HandGesturesProps) {
  const cursors = useRef<readonly Cursor[]>([])
  const interpreter = useMemo(() => new GestureInterpreter(true), [])
  const gestures = useMemo(
    () => createCameraGestures({ drive: () => drive.current, isStage }),
    [drive],
  )

  const onHands = useCallback(
    (hands: DetectedHand[], now: number) => {
      const { cursors: next, events } = interpreter.update(hands, now)
      cursors.current = next
      for (const event of events) gestures.handle(event)
    },
    [interpreter, gestures],
  )

  useHandTracking({ enabled, session, onHands, onStatus })

  useEffect(() => {
    if (enabled) return
    // 끄는 순간 쥐고 있던 것을 놓는다. 남겨 두면 다시 켤 때 집은 채로 시작한다.
    interpreter.reset()
    gestures.reset()
    cursors.current = []
  }, [enabled, interpreter, gestures])

  return <HandCursors enabled={enabled} cursors={cursors} />
}
