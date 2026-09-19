/**
 * 주성분 분석 — 임베딩을 3D 좌표로 줄이는 가장 싼 길.
 *
 * UMAP이 군집을 더 잘 갈라 놓지만 무겁고 파라미터가 많다(G6). PCA는 파라미터가
 * 없고 결과가 언제나 같아서, 파일을 열자마자 보여 줄 첫 좌표로는 이쪽이 맞다.
 *
 * 공분산 행렬(k × k)을 만들지 않는다. 384차원이면 147,456칸이고 만드는 비용이
 * 데이터를 한 번 더 훑는 것보다 크다. 대신 거듭제곱 반복으로 축을 하나씩 꺼내고
 * 꺼낸 축을 빼낸다(deflation).
 *
 * 축을 찾을 때는 행을 솎아 쓰고, 찾은 축에 **모든 행**을 투영한다. 축의 방향은
 * 5천 행만 봐도 거의 정해지지만, 좌표는 모든 행에 있어야 한다.
 */

import type { VectorColumn } from './vectorColumn'

export type PcaResult = {
  /** 주성분 세 개에 투영한 좌표. 행 순서와 개수는 그대로다. */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 1이면 좌표를 만들지 못한 행. 벡터가 없던 행이다. */
  readonly missing: Uint8Array
  readonly missingCount: number
  /** 각 축이 설명하는 분산의 비율. 합이 1이 아니다 — 셋만 꺼냈기 때문이다. */
  readonly explained: readonly [number, number, number]
}

export type PcaOptions = {
  /** 축을 찾을 때 볼 행 수의 상한. */
  readonly fitSample: number
  /** 축 하나당 거듭제곱 반복 횟수. */
  readonly iterations: number
}

export const DEFAULT_PCA: PcaOptions = { fitSample: 5000, iterations: 24 }

/** 축을 찾는 데 쓸 행. 앞에서부터 자르지 않고 고르게 솎는다 — 파일이 정렬돼 있을 수 있다. */
function fitRows(rows: Int32Array, limit: number): Int32Array {
  if (rows.length <= limit) return rows
  const step = rows.length / limit
  const picked = new Int32Array(limit)
  for (let index = 0; index < limit; index += 1) {
    picked[index] = rows[Math.floor(index * step)] ?? 0
  }
  return picked
}

/** 씨앗이 같으면 축도 같다. 같은 파일을 두 번 열어 좌표가 달라지면 안 된다. */
function seededUnit(size: number, seed: number): Float64Array {
  const vector = new Float64Array(size)
  let state = seed | 0
  let norm = 0
  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    const value = (state >>> 8) / 0x1000000 - 0.5
    vector[index] = value
    norm += value * value
  }
  const scale = norm === 0 ? 1 : 1 / Math.sqrt(norm)
  for (let index = 0; index < size; index += 1) vector[index] = (vector[index] ?? 0) * scale
  return vector
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0
  for (let index = 0; index < a.length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0)
  return sum
}

export function pcaTo3D(vector: VectorColumn, options: PcaOptions = DEFAULT_PCA): PcaResult {
  const { rowCount, dimension, values, missing } = vector
  const present: number[] = []
  for (let row = 0; row < rowCount; row += 1) {
    if (missing[row] !== 1) present.push(row)
  }
  const rows = Int32Array.from(present)

  const x = new Float32Array(rowCount)
  const y = new Float32Array(rowCount)
  const z = new Float32Array(rowCount)
  const gone = new Uint8Array(missing)
  const missingCount = rowCount - rows.length
  if (rows.length === 0 || dimension === 0) {
    return { x, y, z, missing: gone, missingCount, explained: [0, 0, 0] }
  }

  // 중심을 옮기지 않으면 첫 축이 평균 방향을 가리켜 버린다.
  const mean = new Float64Array(dimension)
  for (const row of rows) {
    const base = row * dimension
    for (let axis = 0; axis < dimension; axis += 1) {
      mean[axis] = (mean[axis] ?? 0) + (values[base + axis] ?? 0)
    }
  }
  for (let axis = 0; axis < dimension; axis += 1) mean[axis] = (mean[axis] ?? 0) / rows.length

  const sample = fitRows(rows, options.fitSample)
  const centered = new Float64Array(sample.length * dimension)
  let totalVariance = 0
  for (let index = 0; index < sample.length; index += 1) {
    const base = (sample[index] ?? 0) * dimension
    const out = index * dimension
    for (let axis = 0; axis < dimension; axis += 1) {
      const value = (values[base + axis] ?? 0) - (mean[axis] ?? 0)
      centered[out + axis] = value
      totalVariance += value * value
    }
  }

  const components: Float64Array[] = []
  const strengths: number[] = []
  const projected = new Float64Array(sample.length)

  for (let component = 0; component < 3; component += 1) {
    let axisVector = seededUnit(dimension, 0x9e3779b9 + component * 7919)
    // 이미 꺼낸 축 방향을 빼고 시작한다. 안 그러면 같은 축을 세 번 찾는다.
    for (const found of components) {
      const overlap = dot(axisVector, found)
      for (let axis = 0; axis < dimension; axis += 1) {
        axisVector[axis] = (axisVector[axis] ?? 0) - overlap * (found[axis] ?? 0)
      }
    }

    let strength = 0
    for (let step = 0; step < options.iterations; step += 1) {
      // projected = X · v
      for (let index = 0; index < sample.length; index += 1) {
        const base = index * dimension
        let sum = 0
        for (let axis = 0; axis < dimension; axis += 1) {
          sum += (centered[base + axis] ?? 0) * (axisVector[axis] ?? 0)
        }
        projected[index] = sum
      }
      // next = Xᵀ · projected
      const next = new Float64Array(dimension)
      for (let index = 0; index < sample.length; index += 1) {
        const base = index * dimension
        const weight = projected[index] ?? 0
        if (weight === 0) continue
        for (let axis = 0; axis < dimension; axis += 1) {
          next[axis] = (next[axis] ?? 0) + (centered[base + axis] ?? 0) * weight
        }
      }
      for (const found of components) {
        const overlap = dot(next, found)
        for (let axis = 0; axis < dimension; axis += 1) {
          next[axis] = (next[axis] ?? 0) - overlap * (found[axis] ?? 0)
        }
      }
      const norm = Math.sqrt(dot(next, next))
      if (norm < 1e-12) break
      for (let axis = 0; axis < dimension; axis += 1) next[axis] = (next[axis] ?? 0) / norm
      axisVector = next
      strength = norm
    }

    components.push(axisVector)
    strengths.push(strength)
  }

  const axes: readonly Float32Array[] = [x, y, z]
  for (let component = 0; component < 3; component += 1) {
    const found = components[component]
    const out = axes[component]
    if (found === undefined || out === undefined) continue
    for (const row of rows) {
      const base = row * dimension
      let sum = 0
      for (let axis = 0; axis < dimension; axis += 1) {
        sum += ((values[base + axis] ?? 0) - (mean[axis] ?? 0)) * (found[axis] ?? 0)
      }
      out[row] = sum
    }
  }

  const explained = strengths.map((strength) =>
    totalVariance === 0 ? 0 : Math.min(1, strength / totalVariance),
  )

  return {
    x,
    y,
    z,
    missing: gone,
    missingCount,
    explained: [explained[0] ?? 0, explained[1] ?? 0, explained[2] ?? 0],
  }
}
