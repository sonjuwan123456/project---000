import { describe, expect, it } from 'vitest'
import { pcaTo3D } from './pca'
import { vectorFromLists, type VectorColumn } from './vectorColumn'

/** 알려진 방향으로 길쭉한 구름을 만든다. 첫 주성분이 그 방향을 찾아야 한다. */
function stretched(count: number, dimension: number, along: number): VectorColumn {
  let state = 7
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 8) / 0x1000000 - 0.5
  }
  const rows: number[][] = []
  for (let row = 0; row < count; row += 1) {
    const point = Array.from({ length: dimension }, () => random() * 0.1)
    point[along] = random() * 20
    rows.push(point)
  }
  return vectorFromLists('emb', rows)
}

describe('pcaTo3D', () => {
  it('가장 길쭉한 방향을 첫 축으로 잡는다', () => {
    const vector = stretched(300, 8, 5)
    const result = pcaTo3D(vector)
    // 다섯 번째 칸만 크게 움직였으니 x의 퍼짐이 나머지를 압도해야 한다.
    const spread = (values: Float32Array) => {
      let min = Infinity
      let max = -Infinity
      for (const value of values) {
        if (value < min) min = value
        if (value > max) max = value
      }
      return max - min
    }
    expect(spread(result.x)).toBeGreaterThan(spread(result.y) * 5)
    expect(result.explained[0]).toBeGreaterThan(0.9)
  })

  it('축 셋이 서로 다른 방향을 가리킨다', () => {
    // 세 방향으로 각각 늘어난 구름. 같은 축을 세 번 찾으면 좌표가 겹친다.
    const rows: number[][] = []
    let state = 11
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) | 0
      return (state >>> 8) / 0x1000000 - 0.5
    }
    for (let row = 0; row < 400; row += 1) {
      rows.push([random() * 30, random() * 12, random() * 4, random() * 0.2])
    }
    const result = pcaTo3D(vectorFromLists('emb', rows))
    expect(result.explained[0]).toBeGreaterThan(result.explained[1])
    expect(result.explained[1]).toBeGreaterThan(result.explained[2])
    expect(result.explained[0] + result.explained[1] + result.explained[2]).toBeLessThanOrEqual(
      1.001,
    )
  })

  it('같은 입력은 같은 좌표를 낸다', () => {
    const vector = stretched(120, 6, 2)
    const first = pcaTo3D(vector)
    const second = pcaTo3D(vector)
    expect(Array.from(first.x)).toEqual(Array.from(second.x))
  })

  it('행 순서와 개수를 그대로 둔다', () => {
    const vector = stretched(50, 5, 1)
    const result = pcaTo3D(vector)
    expect(result.x).toHaveLength(50)
    expect(result.missingCount).toBe(0)
  })

  it('좌표 없는 행은 그대로 좌표 없음으로 둔다', () => {
    const vector = vectorFromLists('emb', [[1, 2, 3], null, [4, 5, 6], [7, 8]])
    const result = pcaTo3D(vector)
    expect(Array.from(result.missing)).toEqual([0, 1, 0, 1])
    expect(result.missingCount).toBe(2)
    expect(result.x[1]).toBe(0)
  })

  it('쓸 행이 없으면 빈 결과를 낸다', () => {
    const result = pcaTo3D(vectorFromLists('emb', [null, null]))
    expect(result.missingCount).toBe(2)
    expect(result.explained).toEqual([0, 0, 0])
  })

  it('중심을 옮기고 계산한다 — 평균이 멀리 있어도 축이 흔들리지 않는다', () => {
    const near = stretched(200, 6, 3)
    const far = vectorFromLists(
      'emb',
      Array.from({ length: near.rowCount }, (_, row) =>
        Array.from(
          { length: near.dimension },
          (_, axis) => (near.values[row * near.dimension + axis] ?? 0) + 500,
        ),
      ),
    )
    const a = pcaTo3D(near)
    const b = pcaTo3D(far)
    expect(b.explained[0]).toBeCloseTo(a.explained[0] ?? 0, 3)
  })
})
