import { describe, expect, it } from 'vitest'

import { DEFAULT_UMAP, umapTo3D } from './umap'
import type { VectorColumn } from './vectorColumn'

/**
 * 군집이 뚜렷한 벡터 컬럼. 같은 부류끼리는 붙어 있고 부류끼리는 멀다.
 *
 * `holes`에 적은 행은 벡터가 없는 행으로 둔다 — 값은 0으로 남지만 `missing`이 1이다.
 */
function clustered(options: {
  readonly rowsPerCluster: number
  readonly clusters: number
  readonly dimension: number
  readonly holes?: readonly number[]
}): VectorColumn {
  const { rowsPerCluster, clusters, dimension } = options
  const holes = new Set(options.holes ?? [])
  const rowCount = rowsPerCluster * clusters
  const values = new Float32Array(rowCount * dimension)
  const missing = new Uint8Array(rowCount)

  let state = 24680
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 8) / 0x1000000
  }

  const centers: number[][] = []
  for (let c = 0; c < clusters; c += 1) {
    const center = new Array<number>(dimension).fill(0)
    // 부류마다 다른 축 하나를 크게 올린다. 축이 겹치지 않아 확실히 갈라진다.
    center[c % dimension] = 10
    centers.push(center)
  }

  for (let row = 0; row < rowCount; row += 1) {
    if (holes.has(row)) {
      missing[row] = 1
      continue
    }
    const center = centers[Math.floor(row / rowsPerCluster)] ?? []
    const base = row * dimension
    for (let axis = 0; axis < dimension; axis += 1) {
      values[base + axis] = (center[axis] ?? 0) + (rand() - 0.5) * 0.2
    }
  }

  return {
    name: 'embedding',
    dimension,
    rowCount,
    values,
    missing,
    missingCount: holes.size,
  }
}

function distance(
  result: { x: Float32Array; y: Float32Array; z: Float32Array },
  a: number,
  b: number,
): number {
  const dx = (result.x[a] ?? 0) - (result.x[b] ?? 0)
  const dy = (result.y[a] ?? 0) - (result.y[b] ?? 0)
  const dz = (result.z[a] ?? 0) - (result.z[b] ?? 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

describe('umapTo3D', () => {
  it('같은 파일을 두 번 줄이면 좌표가 똑같다', () => {
    const vector = clustered({ rowsPerCluster: 20, clusters: 3, dimension: 8 })
    const first = umapTo3D(vector)
    const second = umapTo3D(vector)

    // Math.random을 그대로 쓰면 여기서 갈린다. 씨앗을 고정해 둔 이유다.
    expect(Array.from(second.x)).toEqual(Array.from(first.x))
    expect(Array.from(second.y)).toEqual(Array.from(first.y))
    expect(Array.from(second.z)).toEqual(Array.from(first.z))
  })

  it('씨앗이 다르면 다른 구름이 나온다', () => {
    const vector = clustered({ rowsPerCluster: 20, clusters: 3, dimension: 8 })
    const first = umapTo3D(vector)
    const second = umapTo3D(vector, { ...DEFAULT_UMAP, seed: 0x1234567 })

    // 씨앗이 실제로 쓰이는지 본다. 상수를 넣어 두면 이 시험이 통과하지 않는다.
    expect(Array.from(second.x)).not.toEqual(Array.from(first.x))
  })

  it('떨어져 있던 군집은 3D에서도 떨어져 있다', () => {
    const vector = clustered({ rowsPerCluster: 25, clusters: 3, dimension: 8 })
    const result = umapTo3D(vector)

    // 같은 부류 안에서 가장 먼 둘, 다른 부류와 가장 가까운 둘을 견준다.
    let widest = 0
    for (let a = 0; a < 25; a += 1) {
      for (let b = a + 1; b < 25; b += 1) widest = Math.max(widest, distance(result, a, b))
    }
    let nearest = Infinity
    for (let a = 0; a < 25; a += 1) {
      for (let b = 25; b < 50; b += 1) nearest = Math.min(nearest, distance(result, a, b))
    }

    expect(nearest).toBeGreaterThan(widest)
  })

  it('벡터가 없던 행은 그대로 빈 행으로 남고 행 번호가 밀리지 않는다', () => {
    const holes = [0, 7, 30]
    const vector = clustered({ rowsPerCluster: 20, clusters: 3, dimension: 8, holes })
    const result = umapTo3D(vector)

    expect(result.missingCount).toBe(holes.length)
    expect(result.x).toHaveLength(vector.rowCount)
    for (const row of holes) {
      expect(result.missing[row]).toBe(1)
      expect(result.x[row]).toBe(0)
      expect(result.y[row]).toBe(0)
      expect(result.z[row]).toBe(0)
    }

    /*
     * 빈 행을 0으로 채워 umap-js에 같이 넣으면 원점에 가짜 군집이 하나 생긴다.
     * 그러면 값이 있는 행들이 그 군집에 끌려가 서로 가까워진다. 빈 행을 뺀 것이
     * 맞는지 보려면, 값이 있는 행끼리 여전히 부류대로 갈라져 있는지 보면 된다.
     */
    const present = [1, 2, 3].filter((row) => !holes.includes(row))
    const other = [21, 22, 23].filter((row) => !holes.includes(row))
    let sameCluster = 0
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        sameCluster = Math.max(sameCluster, distance(result, present[i] ?? 0, present[j] ?? 0))
      }
    }
    let across = Infinity
    for (const a of present) {
      for (const b of other) across = Math.min(across, distance(result, a, b))
    }
    expect(across).toBeGreaterThan(sameCluster)
  })

  it('점이 너무 적으면 좌표를 만들지 않는다', () => {
    const vector: VectorColumn = {
      name: 'embedding',
      dimension: 4,
      rowCount: 3,
      values: new Float32Array(12).fill(1),
      missing: new Uint8Array(3),
      missingCount: 0,
    }
    const result = umapTo3D(vector)

    expect(result.epochs).toBe(0)
    expect(result.missingCount).toBe(3)
    expect(Array.from(result.missing)).toEqual([1, 1, 1])
  })

  it('진행률은 0에서 1까지 뒤로 가지 않고 올라간다', () => {
    const vector = clustered({ rowsPerCluster: 15, clusters: 3, dimension: 8 })
    const seen: number[] = []
    const result = umapTo3D(vector, { ...DEFAULT_UMAP, onProgress: (one) => seen.push(one) })

    expect(result.epochs).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBeCloseTo(1, 6)
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index] ?? 0).toBeGreaterThanOrEqual(seen[index - 1] ?? 0)
    }
  })
})
