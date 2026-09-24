import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { StoredCamera } from '@holo/core'
import {
  DOLLY_RANGE,
  FLIGHT_MS,
  POLAR_MARGIN,
  createOrbitDrive,
  type FrameClock,
  type OrbitLike,
} from './orbitDrive'

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

/** 손으로 돌리는 시계. `tick`이 시간을 옮기고 기다리던 프레임 하나를 부른다. */
function manualClock(reduced = false) {
  let time = 0
  let pending: (() => void) | null = null
  let serial = 0
  const clock: FrameClock = {
    now: () => time,
    request(step) {
      pending = step
      serial += 1
      return serial
    },
    cancel() {
      pending = null
    },
    reducedMotion: () => reduced,
  }
  return {
    clock,
    tick(ms: number) {
      time += ms
      const step = pending
      pending = null
      step?.()
    },
    flying: () => pending !== null,
  }
}

describe('flyTo', () => {
  const bookmark: StoredCamera = { position: [10, 4, 0], target: [2, 0, 0] }

  it('정해진 시간에 걸쳐 날아가 닿고, 닿으면 한 번 알린다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const seen: StoredCamera[] = []
    const time = manualClock()
    const drive = createOrbitDrive(
      () => rig,
      (camera) => seen.push(camera),
      time.clock,
    )

    drive.flyTo(bookmark)
    time.tick(FLIGHT_MS / 2)
    // 반쯤 왔을 때는 출발점과 도착점 사이 어딘가다.
    expect(rig.object.position.x).toBeGreaterThan(0)
    expect(rig.object.position.x).toBeLessThan(10)
    expect(seen).toEqual([])

    time.tick(FLIGHT_MS)
    expect(rig.object.position.toArray()).toEqual([10, 4, 0])
    expect(rig.target.toArray()).toEqual([2, 0, 0])
    expect(seen).toEqual([bookmark])
    expect(time.flying()).toBe(false)
  })

  it('움직임 줄이기를 켠 사람에게는 바로 옮긴다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const seen: StoredCamera[] = []
    const time = manualClock(true)
    const drive = createOrbitDrive(
      () => rig,
      (camera) => seen.push(camera),
      time.clock,
    )

    drive.flyTo(bookmark)
    expect(rig.object.position.toArray()).toEqual([10, 4, 0])
    expect(seen).toEqual([bookmark])
    expect(time.flying()).toBe(false)
  })

  it('날아가는 중에 손이 돌리면 그 자리에서 멈춘다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    const seen: StoredCamera[] = []
    const time = manualClock()
    const drive = createOrbitDrive(
      () => rig,
      (camera) => seen.push(camera),
      time.clock,
    )

    drive.flyTo(bookmark)
    time.tick(FLIGHT_MS / 4)
    drive.rotate(0.1, 0)
    expect(time.flying()).toBe(false)
    // 멈춘 뒤에 시간이 가도 비행이 이어져 손을 거스르지 않는다.
    const after = rig.object.position.clone()
    time.tick(FLIGHT_MS)
    expect(rig.object.position.equals(after)).toBe(true)
    expect(seen).toEqual([])
  })

  it('날아가는 사이에 뷰가 닫히면 조용히 그만둔다', () => {
    const { rig } = fakeOrbit([0, 0, 20])
    let open = true
    const seen: StoredCamera[] = []
    const time = manualClock()
    const drive = createOrbitDrive(
      () => (open ? rig : null),
      (camera) => seen.push(camera),
      time.clock,
    )

    drive.flyTo(bookmark)
    open = false
    expect(() => time.tick(FLIGHT_MS)).not.toThrow()
    expect(seen).toEqual([])
    expect(time.flying()).toBe(false)
  })
})
