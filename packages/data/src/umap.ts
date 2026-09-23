/**
 * UMAP — 임베딩을 3D 좌표로 줄이는 두 번째 길.
 *
 * 주성분 분석은 데이터를 곧은 축 셋에 비추기만 한다. 그래서 빠르고 언제나 같은
 * 결과를 주지만, 군집이 곡면 위에 놓여 있으면 겹쳐 보인다. UMAP은 이웃 관계를
 * 먼저 세우고 그 관계를 지키는 자리를 찾으므로 군집이 실제로 갈라진다. 대신
 * 느리고, 축에 뜻이 없다(설명력이라는 값이 나오지 않는다).
 *
 * 계산 시간은 행 수에 거의 비례한다. 5만 행이면 분 단위다. 그래서 이 계산은
 * 파일을 열자마자 돌지 않고 사용자가 고를 때만 돈다 — 첫 좌표는 `pca.ts`가 낸다.
 *
 * 결과가 언제나 같아야 한다. umap-js는 기본으로 `Math.random`을 쓰는데, 그대로
 * 두면 같은 파일을 두 번 열 때 구름이 다르게 나온다. 씨앗 있는 난수를 넣는다.
 */

import { UMAP } from 'umap-js'

import type { VectorColumn } from './vectorColumn'

export type UmapResult = {
  /** 이웃 관계를 지키게 놓은 좌표. 행 순서와 개수는 그대로다. */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 1이면 좌표를 만들지 못한 행. 벡터가 없던 행이다. */
  readonly missing: Uint8Array
  readonly missingCount: number
  /** 실제로 돈 반복 횟수. 0이면 줄일 것이 없어 그냥 돌아온 것이다. */
  readonly epochs: number
}

export type UmapOptions = {
  /**
   * 한 점이 이웃으로 삼는 점의 수. 작으면 아주 가까운 것만 묶어 잘게 흩어지고,
   * 크면 큰 덩어리만 남는다. 15는 umap-js와 원 논문이 같이 쓰는 값이다.
   */
  readonly neighbors: number
  /** 붙어 있는 점들을 얼마나 붙여 둘지. 작을수록 군집이 빽빽해진다. */
  readonly minDist: number
  /** 난수 씨앗. 같은 씨앗이면 같은 구름이 나온다. */
  readonly seed: number
  /**
   * 진척을 알린다(0~1). 주지 않으면 아무것도 세지 않는다.
   *
   * 반복 횟수를 umap-js가 데이터 크기를 보고 먼저 정해 주므로, 몇 번 중 몇 번인지
   * 셀 수 있다. 이웃을 찾는 앞부분은 셀 수 없어서 그 구간을 0.2로 잡아 둔다.
   */
  readonly onProgress?: (fraction: number) => void
}

/** G6은 아직 답이 없다. 화면에 손잡이를 내지 않고 이 값으로 고정해 둔다. */
export const DEFAULT_UMAP: UmapOptions = { neighbors: 15, minDist: 0.1, seed: 0x9e3779b9 }

/** 이웃 찾기가 차지하는 진행률 구간. 나머지는 반복이 채운다. */
const KNN_SHARE = 0.2

/**
 * 씨앗이 같으면 같은 수열이 나오는 난수.
 *
 * `Math.random`을 그대로 두면 같은 파일을 두 번 열 때 구름이 뒤집혀 보인다.
 * `pca.ts`가 시작 벡터에 쓰는 것과 같은 선형 합동법이다.
 */
function seededRandom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 8) / 0x1000000
  }
}

/**
 * 벡터가 있는 행만 umap-js가 받는 모양(행마다 배열 하나)으로 옮긴다.
 *
 * 빈 행을 0으로 채워 같이 넣으면 안 된다. 원점에 쌓인 가짜 군집이 하나 생기고,
 * 그 군집이 이웃 관계를 끌어당겨 나머지 배치까지 밀어 놓는다.
 */
function presentRows(vector: VectorColumn): { rows: Int32Array; data: number[][] } {
  const { rowCount, dimension, values, missing } = vector
  const rows: number[] = []
  const data: number[][] = []
  for (let row = 0; row < rowCount; row += 1) {
    if (missing[row] === 1) continue
    const base = row * dimension
    const one = new Array<number>(dimension)
    for (let axis = 0; axis < dimension; axis += 1) one[axis] = values[base + axis] ?? 0
    rows.push(row)
    data.push(one)
  }
  return { rows: Int32Array.from(rows), data }
}

export function umapTo3D(vector: VectorColumn, options: UmapOptions = DEFAULT_UMAP): UmapResult {
  const { rowCount } = vector
  const x = new Float32Array(rowCount)
  const y = new Float32Array(rowCount)
  const z = new Float32Array(rowCount)
  const gone = new Uint8Array(vector.missing)

  const { rows, data } = presentRows(vector)
  const missingCount = rowCount - rows.length

  /*
   * 이웃을 세울 수 없으면 그냥 돌아간다.
   *
   * umap-js는 이웃 수가 점 수보다 많으면 경고만 내고 이웃 수를 줄여서 계속 가는데,
   * 점이 두엇뿐이면 나오는 좌표에 뜻이 없다. 좌표를 만들지 못했다고 말하는 편이 낫다.
   */
  if (rows.length < 4 || vector.dimension === 0) {
    const all = new Uint8Array(rowCount).fill(1)
    return { x, y, z, missing: all, missingCount: rowCount, epochs: 0 }
  }

  const umap = new UMAP({
    nComponents: 3,
    // 점이 적으면 이웃 수를 점 수에 맞춰 줄인다. 그대로 두면 이웃이 자기 자신뿐이다.
    nNeighbors: Math.min(options.neighbors, rows.length - 1),
    minDist: options.minDist,
    random: seededRandom(options.seed),
  })

  const epochs = umap.initializeFit(data)
  options.onProgress?.(KNN_SHARE)
  for (let step = 0; step < epochs; step += 1) {
    umap.step()
    options.onProgress?.(KNN_SHARE + ((1 - KNN_SHARE) * (step + 1)) / epochs)
  }

  const embedding = umap.getEmbedding()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? 0
    const point = embedding[index]
    if (point === undefined) continue
    x[row] = point[0] ?? 0
    y[row] = point[1] ?? 0
    z[row] = point[2] ?? 0
  }

  return { x, y, z, missing: gone, missingCount, epochs }
}
