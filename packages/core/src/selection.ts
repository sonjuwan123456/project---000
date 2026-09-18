/**
 * 선택 코디네이터 — 뷰는 조건만 발행하고 서로를 모른다.
 *
 * 설계 문서 5장: 각 뷰가 자기 선택 조건을 발행하면 코디네이터가 조건을 AND로 합쳐
 * 행 비트 배열을 만든다. 뷰를 하나 더 만들어도 연동 코드를 고칠 일이 없다.
 *
 * 비트 배열은 저장하지 않는다. 작업 공간에는 조건만 저장하고 불러올 때 다시 계산한다.
 */

/** 행마다 1(선택) 또는 0. 행 수만큼 길다. */
export type RowMask = Uint8Array

/** 조건을 발행한 뷰의 id. 필터 반응 뷰가 자기 조건을 빼는 데 쓴다. */
export type SelectionSource = string

/** 숫자 컬럼 하나. Float32Array·Uint8Array 같은 TypedArray가 그대로 들어맞는다. */
export type NumericColumn = ArrayLike<number>

/** 컬럼 이름으로 값 배열을 찾는다. 데이터층을 모르기 위해 함수 하나로만 받는다. */
export type ColumnLookup = (column: string) => NumericColumn | undefined

export type SelectionClause =
  /** 올가미처럼 행을 직접 고른 선택. */
  | { readonly kind: 'rows'; readonly rows: RowMask }
  /** 범주 컬럼에서 고른 값들. 빈 배열은 조건 없음과 같다. */
  | { readonly kind: 'category'; readonly column: string; readonly values: readonly number[] }
  /** 숫자 컬럼의 닫힌 구간 [min, max]. */
  | { readonly kind: 'range'; readonly column: string; readonly min: number; readonly max: number }

/** 뷰 id → 그 뷰가 발행한 조건. */
export type SelectionClauses = ReadonlyMap<SelectionSource, SelectionClause>

export type ComposedSelection = {
  /** 조건이 하나도 없으면 null. "전체 선택"을 배열로 만들지 않기 위한 것이다. */
  readonly mask: RowMask | null
  /** 선택된 행 수. mask가 null이면 전체 행 수. */
  readonly count: number
}

export type ComposeOptions = {
  /**
   * 이 뷰가 발행한 조건을 빼고 합친다.
   *
   * 필터로 반응하는 뷰(표, 분포 그래프)는 자기 조건을 빼야 자기가 고른 값 때문에
   * 자기 화면이 비는 일이 없다. 강조로 반응하는 뷰(3D 점)는 빼지 않는다.
   */
  readonly exclude?: SelectionSource
}

function matches(clause: SelectionClause, row: number, columns: ColumnLookup): boolean {
  if (clause.kind === 'rows') return clause.rows[row] === 1

  const column = columns(clause.column)
  if (column === undefined) return true // 없는 컬럼을 참조하는 조건은 무시한다.
  const value = column[row]
  if (value === undefined || Number.isNaN(value)) return false

  if (clause.kind === 'category') {
    return clause.values.length === 0 || clause.values.includes(value)
  }
  return value >= clause.min && value <= clause.max
}

/** 조건들을 AND로 합쳐 행 비트 배열을 만든다. */
export function composeSelection(
  rowCount: number,
  clauses: SelectionClauses,
  columns: ColumnLookup,
  options: ComposeOptions = {},
): ComposedSelection {
  const active: SelectionClause[] = []
  for (const [source, clause] of clauses) {
    if (source === options.exclude) continue
    active.push(clause)
  }
  if (active.length === 0) return { mask: null, count: rowCount }

  const mask = new Uint8Array(rowCount)
  let count = 0
  for (let row = 0; row < rowCount; row += 1) {
    let selected = true
    for (const clause of active) {
      if (!matches(clause, row, columns)) {
        selected = false
        break
      }
    }
    if (selected) {
      mask[row] = 1
      count += 1
    }
  }
  return { mask, count }
}

/**
 * 비트 배열을 행 번호 배열로 바꾼다. 가상 스크롤 표가 n번째 보이는 행을 찾을 때 쓴다.
 * mask가 null이면 전체가 대상이므로 배열을 만들지 않고 null을 돌려준다.
 */
export function maskToRowIndices(selection: ComposedSelection): Int32Array | null {
  const { mask, count } = selection
  if (mask === null) return null

  const rows = new Int32Array(count)
  let written = 0
  for (let row = 0; row < mask.length && written < count; row += 1) {
    if (mask[row] === 1) {
      rows[written] = row
      written += 1
    }
  }
  return rows
}
