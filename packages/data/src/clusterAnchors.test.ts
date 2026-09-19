import { describe, expect, it } from 'vitest'
import { anchorsOf } from './clusterAnchors'
import type { CategoryRole, Positions } from './viewModel'

type Point = { x: number; y: number; z: number; slot: number; missing?: boolean }

const positionsOf = (points: readonly Point[]): Positions => ({
  x: Float32Array.from(points.map((p) => p.x)),
  y: Float32Array.from(points.map((p) => p.y)),
  z: Float32Array.from(points.map((p) => p.z)),
  missing: Uint8Array.from(points.map((p) => (p.missing === true ? 1 : 0))),
  missingCount: points.filter((p) => p.missing === true).length,
  // anchorsOf는 축 이름도 유래도 보지 않는다. 평범한 숫자 컬럼에서 온 좌표로 둔다.
  axes: ['x', 'y', 'z'],
  derivedFrom: null,
})

const categoryOf = (
  points: readonly Point[],
  names: readonly string[],
  overflowSlot: number | null = null,
): CategoryRole => {
  const counts = new Int32Array(names.length)
  for (const point of points) {
    if (point.slot >= 0) counts[point.slot] = (counts[point.slot] ?? 0) + 1
  }
  return {
    column: 'category',
    names,
    counts,
    slotOf: (row) => points[row]?.slot ?? -1,
    colorOfSlot: (slot) => slot,
    overflowSlot,
    codesOfSlot: names.map((_, slot) => [slot]),
  }
}

const anchors = (points: readonly Point[], names: readonly string[], overflow?: number | null) =>
  anchorsOf(positionsOf(points), categoryOf(points, names, overflow ?? null))

describe('anchorsOf', () => {
  it('범주마다 점들의 무게중심을 구한다', () => {
    const result = anchors(
      [
        { x: 0, y: 0, z: 0, slot: 0 },
        { x: 2, y: 4, z: 6, slot: 0 },
        { x: 10, y: 10, z: 10, slot: 1 },
      ],
      ['배송', '결제'],
    )

    expect(result).toEqual([
      { slot: 0, name: '배송', color: 0, position: [1, 2, 3], size: 2 },
      { slot: 1, name: '결제', color: 1, position: [10, 10, 10], size: 1 },
    ])
  })

  it('좌표가 없는 행은 빼고 센다', () => {
    // 0,0,0에 놓인 채 세면 무게중심이 원점으로 끌려간다.
    const result = anchors(
      [
        { x: 4, y: 4, z: 4, slot: 0 },
        { x: 6, y: 6, z: 6, slot: 0 },
        { x: 0, y: 0, z: 0, slot: 0, missing: true },
      ],
      ['배송'],
    )

    expect(result).toEqual([{ slot: 0, name: '배송', color: 0, position: [5, 5, 5], size: 2 }])
  })

  it('범주 값이 없는 행은 빼고 센다', () => {
    const result = anchors(
      [
        { x: 2, y: 2, z: 2, slot: 0 },
        { x: 99, y: 99, z: 99, slot: -1 },
      ],
      ['배송'],
    )

    expect(result).toEqual([{ slot: 0, name: '배송', color: 0, position: [2, 2, 2], size: 1 }])
  })

  it('"기타" 자리에는 앵커를 만들지 않는다', () => {
    const result = anchors(
      [
        { x: 1, y: 1, z: 1, slot: 0 },
        { x: 50, y: 0, z: 0, slot: 1 },
        { x: -50, y: 0, z: 0, slot: 1 },
      ],
      ['배송', '기타'],
      1,
    )

    expect(result.map((anchor) => anchor.name)).toEqual(['배송'])
  })

  it('남은 점이 없는 자리는 결과에서 빠진다', () => {
    const result = anchors(
      [
        { x: 1, y: 1, z: 1, slot: 0 },
        { x: 0, y: 0, z: 0, slot: 1, missing: true },
      ],
      ['배송', '결제', '환불'],
    )

    expect(result.map((anchor) => anchor.slot)).toEqual([0])
  })

  it('size는 범주의 전체 행 수가 아니라 무게중심에 들어간 행 수다', () => {
    const points: Point[] = [
      { x: 1, y: 1, z: 1, slot: 0 },
      { x: 3, y: 3, z: 3, slot: 0 },
      { x: 0, y: 0, z: 0, slot: 0, missing: true },
    ]
    const category = categoryOf(points, ['배송'])

    expect(category.counts[0]).toBe(3)
    expect(anchorsOf(positionsOf(points), category)[0]?.size).toBe(2)
  })
})
