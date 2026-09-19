/**
 * 벡터 컬럼 — 요구사항 문서 2.3의 〔확정 2026-09-18〕 규칙.
 *
 * 어느 경로로 들어왔든 로더 경계에서 하나의 모양으로 맞춘다. 그래야 파생 계산 워커가
 * 입력이 Parquet이었는지 CSV였는지 알 필요가 없고, 나중에 입력 형식을 늘리거나 줄여도
 * 로더 한 곳만 바뀐다.
 *
 * `values`의 배치는 Arrow `FixedSizeList<Float32>`의 자식 버퍼와 같다 —
 * i번째 행이 `[i * dimension, (i + 1) * dimension)` 구간을 차지한다.
 * UMAP·PCA가 원하는 행 우선 `[n × k]` 배치와 같은 모양이라 워커로 넘길 때 변환이 없다.
 */

export type VectorColumn = {
  readonly name: string
  readonly dimension: number
  readonly rowCount: number
  /** 연속된 Float32 버퍼. i번 행은 [i * dimension, (i + 1) * dimension). */
  readonly values: Float32Array
  /** 1이면 그 행은 좌표가 없다. 행을 지우지는 않는다(요구사항 2.2·A4). */
  readonly missing: Uint8Array
  readonly missingCount: number
}

/**
 * 넓은 형태 묶기 후보. 같은 접두사 + 0부터 끊기지 않고 이어지는 번호가 전제다.
 * 숫자 타입인지와 결측이 없는지는 호출한 쪽이 판별 결과로 알려 준다.
 */
export type WideVectorGroup = {
  /** 번호를 뗀 이름. `emb_0..emb_383` → `emb`. */
  readonly name: string
  /** 번호 순서대로 정렬된 원본 컬럼 이름. */
  readonly columns: readonly string[]
  readonly dimension: number
}

/** `emb_0`, `emb0`, `emb-0`, `emb.0`을 모두 접두사와 번호로 가른다. */
const SUFFIX_PATTERN = /^(.*?)[._-]?(\d+)$/

/** 차원이 1인 "벡터"는 그냥 숫자 컬럼이다. 둘 이상부터 묶는다. */
const MIN_DIMENSION = 2

/**
 * 넓은 형태 벡터 컬럼을 찾는다. 네 조건을 모두 만족할 때만 묶는다:
 * 같은 접두사 + 0부터 끊기지 않는 연속 번호 + 전부 숫자 타입 + 결측 없음.
 *
 * 하나라도 어긋나면 묶지 않고 개별 숫자 컬럼으로 남긴다 — 잘못 묶으면 사용자가
 * 컬럼 384개를 잃어버린 것처럼 보이기 때문에, 애매할 때는 묶지 않는 쪽이 안전하다.
 */
export function groupWideVectorColumns(
  names: readonly string[],
  isNumeric: (name: string) => boolean,
  hasBlank: (name: string) => boolean,
): WideVectorGroup[] {
  const buckets = new Map<string, Map<number, string>>()
  const rejected = new Set<string>()

  for (const name of names) {
    const match = SUFFIX_PATTERN.exec(name)
    if (match === null) continue
    const prefix = match[1] ?? ''
    const digits = match[2] ?? ''
    if (prefix === '') continue
    const index = Number(digits)
    let bucket = buckets.get(prefix)
    if (bucket === undefined) {
      bucket = new Map<number, string>()
      buckets.set(prefix, bucket)
    }
    // `emb_0`과 `emb_00`이 같이 오면 어느 쪽이 0번인지 알 수 없다. 그 접두사는 통째로 버린다.
    if (bucket.has(index)) rejected.add(prefix)
    bucket.set(index, name)
  }

  const groups: WideVectorGroup[] = []
  for (const [prefix, bucket] of buckets) {
    if (rejected.has(prefix)) continue
    if (bucket.size < MIN_DIMENSION) continue

    const columns: string[] = []
    let broken = false
    for (let index = 0; index < bucket.size; index += 1) {
      const name = bucket.get(index)
      if (name === undefined || !isNumeric(name) || hasBlank(name)) {
        broken = true
        break
      }
      columns.push(name)
    }
    if (broken) continue

    groups.push({ name: prefix, columns, dimension: columns.length })
  }

  // 컬럼이 많은 묶음부터. 표에서 감출 컬럼 목록을 만들 때 순서가 눈에 띈다.
  groups.sort((a, b) => b.dimension - a.dimension || a.name.localeCompare(b.name))
  return groups
}

/** 넓은 형태 컬럼들을 하나의 연속 버퍼로 옮긴다. */
export function vectorFromWideColumns(
  name: string,
  rowCount: number,
  columns: readonly ArrayLike<number>[],
): VectorColumn {
  const dimension = columns.length
  const values = new Float32Array(rowCount * dimension)
  for (let axis = 0; axis < dimension; axis += 1) {
    const source = columns[axis]
    if (source === undefined) continue
    for (let row = 0; row < rowCount; row += 1) {
      values[row * dimension + axis] = source[row] ?? 0
    }
  }
  return { name, dimension, rowCount, values, missing: new Uint8Array(rowCount), missingCount: 0 }
}

/**
 * 네이티브 리스트(Parquet `list<float>`, JSON 배열)를 정규화한다.
 * 차원을 주지 않으면 처음 만난 벡터의 길이를 기준으로 삼는다.
 *
 * 길이가 다르거나 비어 있는 행은 **삭제하지 않고** `missing`으로 표시한다.
 * 3D 점 뷰에 안 그려질 뿐 표에는 남아야 하고, 선택 비트 배열이 행 번호에 의존한다.
 */
export function vectorFromLists(
  name: string,
  rows: readonly (ArrayLike<number> | null | undefined)[],
  dimension?: number,
): VectorColumn {
  const rowCount = rows.length
  let width = dimension
  if (width === undefined) {
    for (const row of rows) {
      if (row !== null && row !== undefined && row.length > 0) {
        width = row.length
        break
      }
    }
  }
  const size = width ?? 0
  const values = new Float32Array(rowCount * size)
  const missing = new Uint8Array(rowCount)
  let missingCount = 0

  for (let row = 0; row < rowCount; row += 1) {
    const source = rows[row]
    if (source === null || source === undefined || source.length !== size || size === 0) {
      missing[row] = 1
      missingCount += 1
      continue
    }
    const base = row * size
    for (let axis = 0; axis < size; axis += 1) {
      const value = source[axis]
      if (value === undefined || !Number.isFinite(value)) {
        missing[row] = 1
        break
      }
      values[base + axis] = value
    }
    if (missing[row] === 1) missingCount += 1
  }

  return { name, dimension: size, rowCount, values, missing, missingCount }
}
