import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { StoredCamera } from '@holo/core'
import { DOLLY_RANGE, POLAR_MARGIN, createOrbitDrive, type OrbitLike } from './orbitDrive'

function fakeOrbit(
  position: [number, number, number],
  target: [number, number, number] = [0, 0, 0],
) {
  let updates = 0
  const rig: OrbitLike = {
    object: { position: new Vector3(...position) },
    target: new Vector3(...target),
    update() {
      updates += 1
    },
  }
  return { rig, updates: () => updates }
}

describe('createOrbitDrive', () => {
  it('목표점에서 떨어진 거리를 유지한 채 돈다', () => {
    const { rig, updates } = fakeOrbit([0, 0, 20])
    const drive = createOrbitDrive(
      () => rig,
      () => {},
    )
    drive.rotate(Math.PI / 2, 0)
    // 90도 돌면 +Z에서 +X로 간다. 거리는 그대로여야 한다.
    expect(rig.object.position.x).toBeCloseTo(20)
    expect(rig.object.position.z).toBeCloseTo(0)
    expect(rig.object.position.length()).toBeCloseTo(20)
    expect(updates()).toBe(1)
  })

  it('목표점이 원점이 아니어도 그 점을 중심으로 돈다', () => {
    const { rig } = fakeOrbit([5, 0, 20], [5, 0, 0])
    const drive = createOrbitDrive(
      () => rig,
      () => {},
    )
    drive.rotate(Math.PI, 0)
    expect(rig.object.position.x).toBeCloseTo(5)
    expect(rig.object.position.z).toBeCloseTo(-20)
  })

  it('위아래로 끝까지 돌려도 뒤집히지 않는다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const drive = createOrbitDrive(
      () => rig,
      () => {},
    )
    drive.rotate(0, -10)
    // phi가 0을 넘으면 카메라가 뒤집혀 화면이 거꾸로 선다. 여백만큼 앞에서 멈춘다.
    expect(rig.object.position.y).toBeCloseTo(20 * Math.cos(POLAR_MARGIN))
    expect(rig.object.position.y).toBeLessThan(20)
    drive.rotate(0, 20)
    expect(rig.object.position.y).toBeCloseTo(-20 * Math.cos(POLAR_MARGIN))
  })

  it('양수 dolly는 가까워지고 음수는 멀어진다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const drive = createOrbitDrive(
      () => rig,
      () => {},
    )
    drive.dolly(5)
    expect(rig.object.position.z).toBeCloseTo(15)
    drive.dolly(-3)
    expect(rig.object.position.z).toBeCloseTo(18)
  })

  it('확대는 정해진 범위를 벗어나지 않는다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const drive = createOrbitDrive(
      () => rig,
      () => {},
    )
    drive.dolly(1000)
    expect(rig.object.position.length()).toBeCloseTo(DOLLY_RANGE.min)
    drive.dolly(-1000)
    expect(rig.object.position.length()).toBeCloseTo(DOLLY_RANGE.max)
  })

  it('놓으면 지금 카메라를 그대로 알린다', () => {
    const { rig } = fakeOrbit([1, 2, 3], [4, 5, 6])
    const seen: StoredCamera[] = []
    const drive = createOrbitDrive(
      () => rig,
      (camera) => seen.push(camera),
    )
    drive.rest()
    expect(seen).toEqual([{ position: [1, 2, 3], target: [4, 5, 6] }])
  })

  it('컨트롤이 아직 없으면 아무 일도 하지 않는다', () => {
    const seen: StoredCamera[] = []
    const drive = createOrbitDrive(
      () => null,
      (camera) => seen.push(camera),
    )
    expect(() => {
      drive.rotate(1, 1)
      drive.dolly(1)
      drive.rest()
    }).not.toThrow()
    expect(seen).toEqual([])
  })
})
