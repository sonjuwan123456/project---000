/**
 * 뷰 모델 — 불러온 표를 뷰가 그릴 수 있는 모양으로 옮긴다.
 *
 * 뷰는 "3D 좌표 세 축", "색을 나눌 범주", "구간을 고를 숫자"를 원하고, 파일은
 * 아무 컬럼이나 들고 온다. 그 사이를 여기서 한 번만 잇는다. 뷰마다 컬럼을 고르게
 * 두면 뷰가 늘어날 때마다 같은 규칙을 다시 쓰게 된다.
 *
 * 어느 컬럼이 어느 자리를 맡을지는 사용자가 바꿀 수 있어야 한다. 지금은 자동으로만
 * 고른다.
 */

import { MAX_COLORED_CATEGORIES, OVERFLOW_CATEGORY, type ColumnLookup } from '@holo/core'
import type { LoadedCategoryColumn, LoadedColumn, LoadedTable } from './loadTable'
import type { VectorColumn } from './vectorColumn'

export type CellKind = 'text' | 'tag' | 'num'

export type ViewColumn = {
  readonly name: string
  readonly kind: CellKind
  /** 표 한 칸에 쓸 글자. */
  textOf(row: number): string
  /** 범주 컬럼이면 색 자리 번호. 아니면 null. */
  colorOf: ((row: number) => number) | null
}

/** 3D 점 뷰가 쓰는 좌표. 축마다 보기 좋은 범위로 맞춰 둔다. */
export type Positions = {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 1이면 좌표가 없는 행. 그리지 않는다. */
  readonly missing: Uint8Array
  readonly missingCount: number
  /** 어느 컬럼에서 왔는지. 화면에 축 이름으로 보여 준다. */
  readonly axes: readonly [string, string, string]
}

export type CategoryRole = {
  readonly column: string
  /** 색과 막대에 쓸 이름. 마지막은 상위에 들지 못한 값을 모은 "기타". */
  readonly names: readonly string[]
  /** 이름 순서대로의 행 수. */
  readonly counts: Int32Array
  /** 행 → 이름 자리. 빈 칸은 -1. */
  slotOf(row: number): number
  /** 이름 자리 → 팔레트 자리. "기타"만 자리가 다르다. */
  colorOfSlot(slot: number): number
  /** "기타" 자리. 넘치는 값이 없으면 null. */
  readonly overflowSlot: number | null
  /** 이름 자리 → 원본 코드들. 선택 조건을 만들 때 되돌리는 데 쓴다. */
  readonly codesOfSlot: readonly (readonly number[])[]
}

export type MeasureRole = {
  readonly column: string
  readonly values: ArrayLike<number>
  readonly min: number
  readonly max: number
}

export type ViewModel = {
  readonly assetId: string
  readonly label: string
  readonly rowCount: number
  readonly lookup: ColumnLookup
  readonly position: Positions | null
  /** 좌표를 못 만든 이유. `position`이 null일 때만 있다. */
  readonly positionMissing: string | null
  readonly category: CategoryRole | null
  readonly measure: MeasureRole | null
  readonly columns: readonly ViewColumn[]
  /** 행 하나를 한 줄로. 활동 기록 문구에 쓴다. */
  rowLabel(row: number): string
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
})

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return value.toLocaleString('ko-KR')
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })
}

/** 2~98 백분위로 자른 뒤 맞춘다. 값 하나가 멀리 있으면 나머지가 한 점에 뭉친다. */
function scaleAxis(source: ArrayLike<number>, rowCount: number, span: number): Float32Array {
  const finite: number[] = []
  for (let row = 0; row < rowCount; row += 1) {
    const value = source[row]
    if (value !== undefined && Number.isFinite(value)) finite.push(value)
  }
  const out = new Float32Array(rowCount)
  if (finite.length === 0) return out

  finite.sort((a, b) => a - b)
  const low = finite[Math.floor(finite.length * 0.02)] ?? finite[0] ?? 0
  const high = finite[Math.ceil(finite.length * 0.98) - 1] ?? finite[finite.length - 1] ?? 0
  const width = high - low
  for (let row = 0; row < rowCount; row += 1) {
    const value = source[row]
    if (value === undefined || !Number.isFinite(value)) continue
    const ratio = width === 0 ? 0.5 : (Math.min(high, Math.max(low, value)) - low) / width
    out[row] = (ratio - 0.5) * 2 * span
  }
  return out
}

function varianceOf(source: ArrayLike<number>, rowCount: number): number {
  let count = 0
  let mean = 0
  let squares = 0
  for (let row = 0; row < rowCount; row += 1) {
    const value = source[row]
    if (value === undefined || !Number.isFinite(value)) continue
    count += 1
    const delta = value - mean
    mean += delta / count
    squares += delta * (value - mean)
  }
  if (count < 2) return 0
  // 단위가 다른 컬럼을 견주려면 평균으로 나눠 무단위로 만들어야 한다.
  const variance = squares / (count - 1)
  const scale = Math.abs(mean) < 1e-9 ? 1 : Math.abs(mean)
  return variance / (scale * scale)
}

const AXIS_SPAN = 6

function positionsFromColumns(
  rowCount: number,
  picked: readonly { name: string; values: ArrayLike<number> }[],
): Positions {
  const [first, second, third] = picked
  const x = scaleAxis(first?.values ?? [], rowCount, AXIS_SPAN)
  const y = scaleAxis(second?.values ?? [], rowCount, AXIS_SPAN * 0.7)
  const z = scaleAxis(third?.values ?? [], rowCount, AXIS_SPAN)
  const missing = new Uint8Array(rowCount)
  let missingCount = 0
  for (let row = 0; row < rowCount; row += 1) {
    const gone = picked.some((axis) => {
      const value = axis.values[row]
      return value === undefined || !Number.isFinite(value)
    })
    if (gone) {
      missing[row] = 1
      missingCount += 1
    }
  }
  return {
    x,
    y,
    z,
    missing,
    missingCount,
    axes: [first?.name ?? '', second?.name ?? '', third?.name ?? ''],
  }
}

/** 상위 12개만 색을 받고 나머지는 "기타"로 모은다(요구사항 2.2). */
function categoryRoleOf(column: LoadedCategoryColumn): CategoryRole {
  const kept = Math.min(column.categories.length, MAX_COLORED_CATEGORIES)
  const overflow = column.categories.length > kept
  const names = [...column.categories.slice(0, kept)]
  const counts: number[] = []
  for (let slot = 0; slot < kept; slot += 1) counts.push(column.counts[slot] ?? 0)

  const codesOfSlot: number[][] = names.map((_, slot) => [slot])
  if (overflow) {
    names.push('기타')
    let rest = 0
    const codes: number[] = []
    for (let code = kept; code < column.categories.length; code += 1) {
      rest += column.counts[code] ?? 0
      codes.push(code)
    }
    counts.push(rest)
    codesOfSlot.push(codes)
  }

  const overflowSlot = overflow ? names.length - 1 : null

  return {
    column: column.name,
    names,
    counts: Int32Array.from(counts),
    slotOf(row) {
      const code = column.codes[row] ?? -1
      if (code < 0) return -1
      return code < kept ? code : (overflowSlot ?? -1)
    },
    colorOfSlot(slot) {
      if (slot < 0) return OVERFLOW_CATEGORY
      return slot === overflowSlot ? OVERFLOW_CATEGORY : slot
    },
    overflowSlot,
    codesOfSlot,
  }
}

/**
 * 값이 긴 범주 컬럼은 표에서 색표로 그리지 않는다. 범주로 판별하는 것과
 * 모든 고유값에 색을 주는 것은 다른 문제다(요구사항 2.2).
 */
const TAG_MAX_LENGTH = 20

function viewColumnOf(column: LoadedColumn): ViewColumn {
  if (column.kind === 'category' && column.profile.averageLength > TAG_MAX_LENGTH) {
    return {
      name: column.name,
      kind: 'text',
      textOf: (row) => {
        const code = column.codes[row] ?? -1
        return code < 0 ? '' : (column.categories[code] ?? '')
      },
      colorOf: null,
    }
  }
  if (column.kind === 'category') {
    /*
     * 값이 팔레트보다 많으면 색을 주지 않는다. 열두 색을 돌려 쓰면 서로 다른 값이
     * 같은 색을 받아, 색이 뜻을 전하는 대신 거짓말을 하게 된다.
     */
    const colored = column.categories.length <= MAX_COLORED_CATEGORIES
    const role = colored ? categoryRoleOf(column) : null
    return {
      name: column.name,
      kind: 'tag',
      textOf: (row) => {
        const code = column.codes[row] ?? -1
        return code < 0 ? '' : (column.categories[code] ?? '')
      },
      colorOf: role === null ? null : (row) => role.colorOfSlot(role.slotOf(row)),
    }
  }
  if (column.kind === 'number') {
    return {
      name: column.name,
      kind: 'num',
      textOf: (row) => formatNumber(column.values[row] ?? Number.NaN),
      colorOf: null,
    }
  }
  if (column.kind === 'datetime') {
    return {
      name: column.name,
      kind: 'num',
      textOf: (row) => {
        const value = column.values[row]
        return value === undefined || !Number.isFinite(value) ? '' : dateFormat.format(value)
      },
      colorOf: null,
    }
  }
  return {
    name: column.name,
    kind: 'text',
    textOf: (row) => column.values[row] ?? '',
    colorOf: null,
  }
}

function missingReason(vectors: readonly VectorColumn[], numericCount: number): string {
  if (vectors.length > 0) {
    return `임베딩은 있지만 아직 3D 좌표로 줄이지 못합니다. 차원 축소(PCA·UMAP)가 붙어야 합니다.`
  }
  return `3D로 놓으려면 숫자 컬럼이 세 개는 있어야 하는데 ${numericCount}개뿐입니다.`
}

export function toViewModel(table: LoadedTable, label: string): ViewModel {
  const numeric = table.columns.filter((column) => column.kind === 'number')
  const ranked = numeric
    .map((column) => ({
      name: column.name,
      values: column.values as ArrayLike<number>,
      spread: varianceOf(column.values, table.rowCount),
    }))
    .filter((entry) => entry.spread > 0)
    .sort((a, b) => b.spread - a.spread)

  const position =
    ranked.length >= 3 ? positionsFromColumns(table.rowCount, ranked.slice(0, 3)) : null
  const positionMissing = position === null ? missingReason(table.vectors, numeric.length) : null

  /*
   * 색을 나눌 범주는 값이 적은 쪽을 고른다. 값이 수백 개인 컬럼으로 칠하면
   * 대부분이 "기타"가 되어 색이 아무것도 말해 주지 않는다.
   */
  const pickedCategory = table.columns
    .filter((column): column is LoadedCategoryColumn => column.kind === 'category')
    .filter((column) => column.categories.length >= 2)
    .sort((a, b) => a.categories.length - b.categories.length)[0]
  const category = pickedCategory === undefined ? null : categoryRoleOf(pickedCategory)

  // 히스토그램은 좌표에 쓰지 않은 숫자 컬럼을 먼저 고른다. 같은 값을 두 번 보여 주지 않는다.
  const usedByPosition = new Set(position?.axes ?? [])
  const spare = ranked.find((entry) => !usedByPosition.has(entry.name)) ?? ranked[0]
  const measure =
    spare === undefined
      ? null
      : (() => {
          let min = Number.POSITIVE_INFINITY
          let max = Number.NEGATIVE_INFINITY
          for (let row = 0; row < table.rowCount; row += 1) {
            const value = spare.values[row]
            if (value === undefined || !Number.isFinite(value)) continue
            if (value < min) min = value
            if (value > max) max = value
          }
          if (min > max) return null
          return { column: spare.name, values: spare.values, min, max }
        })()

  const columns = table.columns.map(viewColumnOf)
  // 행을 한 줄로 부를 때는 가장 말이 되는 칸, 즉 글자가 가장 긴 컬럼을 쓴다.
  let labelAt = 0
  let longest = -1
  table.columns.forEach((column, index) => {
    if (column.profile.averageLength > longest) {
      longest = column.profile.averageLength
      labelAt = index
    }
  })
  const textColumn = columns[labelAt] ?? columns[0]

  return {
    assetId: table.assetId,
    label,
    rowCount: table.rowCount,
    lookup: table.lookup,
    position,
    positionMissing,
    category,
    measure,
    columns,
    rowLabel: (row) => textColumn?.textOf(row) ?? `${row + 1}번 행`,
  }
}
