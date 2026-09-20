import { describe, expect, it } from 'vitest'
import type { CameraDrive } from '@holo/core'
import { ROTATE_GAIN, ZOOM_GAIN, createCameraGestures } from './cameraGestures'

function fakeDrive() {
  const calls: string[] = []
  const rotations: [number, number][] = []
  const dollies: number[] = []
  const drive: CameraDrive = {
    rotate(azimuth, polar) {
      calls.push('rotate')
      rotations.push([azimuth, polar])
    },
    dolly(delta) {
      calls.push('dolly')
      dollies.push(delta)
    },
    rest() {
      calls.push('rest')
    },
  }
  return { drive, calls, rotations, dollies }
}

/** 무대가 화면 위쪽 절반이고 아래쪽 절반은 표라고 보는 가짜 화면. */
const isStage = (_x: number, y: number) => y < 0.5

describe('createCameraGestures', () => {
  it('무대에서 집고 끌면 카메라를 돌린다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.2 })
    g.handle({ type: 'pinchmove', id: 'Right', x: 0.6, y: 0.2, dx: 0.1, dy: 0 })
    expect(fake.rotations).toEqual([[-0.1 * ROTATE_GAIN.azimuth, -0]])
  })

  it('표 위에서 집고 끌면 카메라가 돌지 않는다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.8 })
    g.handle({ type: 'pinchmove', id: 'Right', x: 0.6, y: 0.8, dx: 0.1, dy: 0 })
    g.handle({ type: 'pinchend', id: 'Right', x: 0.6, y: 0.8, tap: false })
    expect(fake.calls).toEqual([])
  })

  it('무대에서 집기 시작했으면 손이 표 위로 넘어가도 계속 돈다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.2 })
    g.handle({ type: 'pinchmove', id: 'Right', x: 0.5, y: 0.9, dx: 0, dy: 0.7 })
    expect(fake.rotations).toHaveLength(1)
  })

  it('무대에서 돌린 뒤 놓으면 카메라를 저장한다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.2 })
    g.handle({ type: 'pinchend', id: 'Right', x: 0.5, y: 0.2, tap: true })
    expect(fake.calls).toEqual(['rest'])
  })

  it('무대를 쥔 손이 하나도 없으면 확대하지 않는다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Left', x: 0.3, y: 0.8 })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.7, y: 0.8 })
    g.handle({ type: 'zoom', delta: 0.1 })
    expect(fake.dollies).toEqual([])

    g.handle({ type: 'pinchstart', id: 'Third', x: 0.5, y: 0.2 })
    g.handle({ type: 'zoom', delta: 0.1 })
    expect(fake.dollies).toEqual([0.1 * ZOOM_GAIN])
  })

  it('3D 뷰가 없으면 아무 일도 하지 않는다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => null, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.2 })
    g.handle({ type: 'pinchmove', id: 'Right', x: 0.6, y: 0.2, dx: 0.1, dy: 0 })
    g.handle({ type: 'zoom', delta: 0.1 })
    expect(fake.calls).toEqual([])
  })

  it('끄면 쥐고 있던 것을 놓는다', () => {
    const fake = fakeDrive()
    const g = createCameraGestures({ drive: () => fake.drive, isStage })
    g.handle({ type: 'pinchstart', id: 'Right', x: 0.5, y: 0.2 })
    g.reset()
    g.handle({ type: 'pinchmove', id: 'Right', x: 0.6, y: 0.2, dx: 0.1, dy: 0 })
    expect(fake.calls).toEqual([])
  })
})
