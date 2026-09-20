import { describe, expect, it } from 'vitest'
import { GestureInterpreter, LANDMARK_COUNT, type DetectedHand, type Landmark } from './gestures'

/** 손목 (cx, cy+0.2), 중지 뿌리 (cx, cy) 기준으로 엄지·검지 끝만 벌려 둔 가짜 손. */
function makeHand(cx: number, cy: number, pinched: boolean, handedness = 'Right'): DetectedHand {
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({
    x: cx,
    y: cy + 0.2,
    z: 0,
  }))
  lm[0] = { x: cx, y: cy + 0.2, z: 0 }
  lm[9] = { x: cx, y: cy, z: 0 }
  const gap = pinched ? 0.01 : 0.12
  lm[4] = { x: cx - gap / 2, y: cy - 0.05, z: 0 }
  lm[8] = { x: cx + gap / 2, y: cy - 0.05, z: 0 }
  return { handedness, landmarks: lm }
}

describe('GestureInterpreter', () => {
  it('짧게 집었다 놓으면 탭으로 인식한다', () => {
    const g = new GestureInterpreter()
    g.update([makeHand(0.5, 0.5, false)], 0)
    const start = g.update([makeHand(0.5, 0.5, true)], 16)
    expect(start.events[0]?.type).toBe('pinchstart')
    const end = g.update([makeHand(0.5, 0.5, false)], 150)
    const ev = end.events.find((e) => e.type === 'pinchend')
    expect(ev && ev.type === 'pinchend' && ev.tap).toBe(true)
  })

  it('집은 채로 크게 움직이면 탭이 아니다', () => {
    const g = new GestureInterpreter()
    g.update([makeHand(0.3, 0.5, true)], 0)
    for (let t = 1; t <= 10; t++) g.update([makeHand(0.3 + t * 0.03, 0.5, true)], t * 16)
    const end = g.update([makeHand(0.6, 0.5, false)], 200)
    const ev = end.events.find((e) => e.type === 'pinchend')
    expect(ev && ev.type === 'pinchend' && ev.tap).toBe(false)
  })

  it('양손으로 집고 벌리면 양수 zoom을 내고 회전은 내지 않는다', () => {
    const g = new GestureInterpreter()
    g.update([makeHand(0.4, 0.5, true, 'Left'), makeHand(0.6, 0.5, true, 'Right')], 0)
    const out = g.update([makeHand(0.3, 0.5, true, 'Left'), makeHand(0.7, 0.5, true, 'Right')], 16)
    const zoom = out.events.find((e) => e.type === 'zoom')
    expect(zoom && zoom.type === 'zoom' && zoom.delta).toBeGreaterThan(0)
    expect(out.events.some((e) => e.type === 'pinchmove')).toBe(false)
  })

  it('손이 사라지면 집기를 해제한다', () => {
    const g = new GestureInterpreter()
    g.update([makeHand(0.5, 0.5, true)], 0)
    const out = g.update([], 16)
    expect(out.events).toEqual([expect.objectContaining({ type: 'pinchend', tap: false })])
  })

  it('랜드마크가 모자란 손은 건너뛴다', () => {
    const g = new GestureInterpreter()
    const hand = makeHand(0.5, 0.5, true)
    const broken: DetectedHand = { ...hand, landmarks: hand.landmarks.slice(0, 5) }
    const out = g.update([broken], 0)
    expect(out.cursors).toEqual([])
    expect(out.events).toEqual([])
  })

  it('거울 모드는 좌우를 뒤집고, 끄면 그대로 둔다', () => {
    // 웹캠 영상은 거울이 아니라 카메라가 본 그대로다. 뒤집지 않으면 손과 커서가 반대로 간다.
    const mirrored = new GestureInterpreter(true)
    const asIs = new GestureInterpreter(false)
    expect(mirrored.update([makeHand(0.3, 0.5, false)], 0).cursors[0]?.x).toBeCloseTo(0.7)
    expect(asIs.update([makeHand(0.3, 0.5, false)], 0).cursors[0]?.x).toBeCloseTo(0.3)
  })
})
