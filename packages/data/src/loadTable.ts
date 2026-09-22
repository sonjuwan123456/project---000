/**
 * 표 데이터 자산을 불러오는 입구 — M1.
 *
 * 문자열 표(CSV·TSV)를 받아 컬럼 종류를 판별하고, 넓은 형태 임베딩을 묶고,
 * 선택 코디네이터가 그대로 쓸 수 있는 컬럼 조회 함수까지 붙여서 돌려준다.
 *
 * Parquet·JSON처럼 타입이 이미 있는 형식은 `buildTable`에 이미 판별된 컬럼을 넘기면 된다.
 * 그 경로에서도 아래층이 보는 모양은 같다.
 */

import type { ColumnLookup } from '@holo/core'
import { assetIdOfShape } from './assetId'
import { progressOf, type ProgressReporter } from './progress'
import {
  DEFAULT_INFERENCE,
  isBlank,
  parseDatetime,
  parseNumber,
  profileColumn,
  type ColumnProfile,
  type InferenceOptions,
} from './columnType'
import { parseDelimitedText, type DelimitedTable } from './delimitedText'
import { detectStringVector } from './stringVectorGuard'
import { groupWideVectorColumns, vectorFromWideColumns, type VectorColumn } from './vectorColumn'

export type LoadedNumberColumn = {
  readonly kind: 'number'
  readonly name: string
  readonly profile: ColumnProfile
  /** 빈 칸과 파싱되지 않은 값은 NaN이다. 선택 조건은 NaN을 절대 고르지 않는다. */
  readonly values: Float64Array
  readonly nullCount: number
  /** 95% 규칙에서 빠진 값. 조용히 버리지 않고 원본 문자열을 그대로 보관한다. */
  readonly unparsed: ReadonlyMap<number, string>
}

export type LoadedDatetimeColumn = {
  readonly kind: 'datetime'
  readonly name: string
  readonly profile: ColumnProfile
  /** epoch 밀리초. 타임존이 없던 값은 UTC로 읽었다. */
  readonly values: Float64Array
  readonly nullCount: number
  readonly unparsed: ReadonlyMap<number, string>
}

export type LoadedCategoryColumn = {
  readonly kind: 'category'
  readonly name: string
  readonly profile: ColumnProfile
  /** `categories`의 자리 번호. 빈 칸은 -1. */
  readonly codes: Int32Array
  readonly categories: readonly string[]
  /** `categories`와 같은 순서의 행 수. 많은 순으로 정렬되어 있다. */
  readonly counts: Int32Array
  readonly nullCount: number
}

export type LoadedTextColumn = {
  readonly kind: 'text'
  readonly name: string
  readonly profile: ColumnProfile
  readonly values: readonly (string | null)[]
  readonly nullCount: number
}

export type LoadedColumn =
  LoadedNumberColumn | LoadedDatetimeColumn | LoadedCategoryColumn | LoadedTextColumn

export type LoadNotice = {
  readonly level: 'info' | 'warning'
  readonly column?: string
  readonly message: string
}

export type LoadedTable = {
  /**
   * 이 표를 알아보는 id. 작업 공간이 저장해 둔 행 번호를 다시 얹어도 되는지
   * 판단하는 데 쓴다. 같은 파일을 다시 열면 같은 값이고, 고친 파일은 다른 값이다.
   */
  readonly assetId: string
  readonly rowCount: number
  /** 화면에 보일 컬럼. 벡터로 묶인 원본 컬럼은 여기 없다. */
  readonly columns: readonly LoadedColumn[]
  readonly vectors: readonly VectorColumn[]
  /** 벡터로 묶여 표와 컬럼 목록에서 감춘 원본 컬럼 이름. */
  readonly hiddenColumns: ReadonlySet<string>
  /** 사용자에게 보여야 할 안내. 막힌 벡터 컬럼이 여기로 온다. */
  readonly notices: readonly LoadNotice[]
  /** 선택 코디네이터에 그대로 넘길 수 있는 컬럼 조회 함수. */
  readonly lookup: ColumnLookup
}

/**
 * 조회 함수를 뺀 표. 워커와 주고받는 모양이다.
 *
 * `lookup`만 함수고 나머지는 전부 값(TypedArray, Map, Set)이라 구조화 복제를 그대로
 * 통과한다. 워커는 이 모양으로 돌려주고 받는 쪽이 `attachLookup`으로 함수를 다시 단다.
 */
export type LoadedTableData = Omit<LoadedTable, 'lookup'>

/** 워커에서 온 표에 조회 함수를 다시 단다. */
export function attachLookup(data: LoadedTableData): LoadedTable {
  return { ...data, lookup: lookupFor(data.columns, data.vectors) }
}

function buildNumberColumn(
  name: string,
  raw: readonly (string | null)[],
  profile: ColumnProfile,
): LoadedNumberColumn {
  const values = new Float64Array(raw.length)
  const unparsed = new Map<number, string>()
  let nullCount = 0
  for (let row = 0; row < raw.length; row += 1) {
    const cell = raw[row]
    if (isBlank(cell)) {
      values[row] = Number.NaN
      nullCount += 1
      continue
    }
    const parsed = parseNumber(cell as string)
    if (parsed === null) {
      values[row] = Number.NaN
      nullCount += 1
      unparsed.set(row, cell as string)
      continue
    }
    values[row] = parsed
  }
  return { kind: 'number', name, profile, values, nullCount, unparsed }
}

function buildDatetimeColumn(
  name: string,
  raw: readonly (string | null)[],
  profile: ColumnProfile,
): LoadedDatetimeColumn {
  const values = new Float64Array(raw.length)
  const unparsed = new Map<number, string>()
  let nullCount = 0
  for (let row = 0; row < raw.length; row += 1) {
    const cell = raw[row]
    if (isBlank(cell)) {
      values[row] = Number.NaN
      nullCount += 1
      continue
    }
    const parsed = parseDatetime(cell as string)
    if (parsed === null) {
      values[row] = Number.NaN
      nullCount += 1
      unparsed.set(row, cell as string)
      continue
    }
    values[row] = parsed
  }
  return { kind: 'datetime', name, profile, values, nullCount, unparsed }
}

function buildCategoryColumn(
  name: string,
  raw: readonly (string | null)[],
  profile: ColumnProfile,
): LoadedCategoryColumn {
  const firstSeen = new Map<string, number>()
  const tally: number[] = []
  const codes = new Int32Array(raw.length)
  let nullCount = 0

  for (let row = 0; row < raw.length; row += 1) {
    const cell = raw[row]
    if (isBlank(cell)) {
      codes[row] = -1
      nullCount += 1
      continue
    }
    const value = cell as string
    let code = firstSeen.get(value)
    if (code === undefined) {
      code = tally.length
      firstSeen.set(value, code)
      tally.push(0)
    }
    codes[row] = code
    tally[code] = (tally[code] ?? 0) + 1
  }

  // 많은 순으로 다시 매긴다. 색상 상위 12개·분포 상위 20개 규칙이 이 순서를 그대로 쓴다.
  const order = tally.map((_, code) => code).sort((a, b) => (tally[b] ?? 0) - (tally[a] ?? 0))
  const remap = new Int32Array(tally.length)
  order.forEach((oldCode, newCode) => {
    remap[oldCode] = newCode
  })
  for (let row = 0; row < codes.length; row += 1) {
    const code = codes[row] ?? -1
    if (code >= 0) codes[row] = remap[code] ?? 0
  }

  const names = new Map<number, string>()
  for (const [value, code] of firstSeen) names.set(code, value)
  const categories = order.map((oldCode) => names.get(oldCode) ?? '')
  const counts = Int32Array.from(order, (oldCode) => tally[oldCode] ?? 0)

  return { kind: 'category', name, profile, codes, categories, counts, nullCount }
}

function buildTextColumn(
  name: string,
  raw: readonly (string | null)[],
  profile: ColumnProfile,
): LoadedTextColumn {
  const values = raw.map((cell) => (isBlank(cell) ? null : (cell as string)))
  const nullCount = values.reduce((sum, cell) => (cell === null ? sum + 1 : sum), 0)
  return { kind: 'text', name, profile, values, nullCount }
}

function lookupFor(
  columns: readonly LoadedColumn[],
  vectors: readonly VectorColumn[],
): ColumnLookup {
  const table = new Map<string, ArrayLike<number>>()
  for (const column of columns) {
    if (column.kind === 'number' || column.kind === 'datetime')
      table.set(column.name, column.values)
    else if (column.kind === 'category') table.set(column.name, column.codes)
  }
  // 벡터의 축 하나를 조건에 쓸 일은 없지만, 좌표 없는 행을 고르는 조건은 필요하다.
  for (const vector of vectors) table.set(`${vector.name}:좌표없음`, vector.missing)
  return (name) => table.get(name)
}

/** 이름이 겹치면 조회 함수가 한쪽을 덮어쓴다. 겹치는 쪽에 번호를 붙여 떼어 놓는다. */
function uniqueNames(header: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return header.map((name) => {
    const used = seen.get(name)
    if (used === undefined) {
      seen.set(name, 1)
      return name
    }
    let next = used + 1
    let candidate = `${name} (${next})`
    while (seen.has(candidate)) {
      next += 1
      candidate = `${name} (${next})`
    }
    seen.set(name, next)
    seen.set(candidate, 1)
    return candidate
  })
}

export type BuildOptions = {
  readonly inference?: InferenceOptions
  /**
   * 타입이 이미 있는 형식(Parquet `list<float>`, JSON 배열)에서 바로 만든 벡터.
   * 여기로 들어온 벡터는 넓은 형태 묶기를 거치지 않는다.
   */
  readonly nativeVectors?: readonly VectorColumn[]
  /** 파일에서 뽑은 자산 id. 주지 않으면 표의 모양으로 만든다. */
  readonly assetId?: string
  /** 진행률을 알린다. 주지 않으면 아무것도 세지 않는다. */
  readonly onProgress?: ProgressReporter
}

/**
 * 이미 문자열 컬럼으로 갈라진 표를 불러온다.
 *
 * 순서가 중요하다. 넓은 형태 묶기가 컬럼 종류 판별보다 **뒤**에 오는 이유는
 * 묶는 조건 자체가 "전부 숫자 타입 + 결측 없음"이라 판별 결과를 필요로 하기 때문이다.
 */
export function buildTable(
  header: readonly string[],
  rawColumns: readonly (readonly (string | null)[])[],
  rowCount: number,
  options: BuildOptions = {},
): LoadedTable {
  const inference = options.inference ?? DEFAULT_INFERENCE
  const notices: LoadNotice[] = []
  const names = uniqueNames(header)
  const profiles = new Map<string, ColumnProfile>()

  /*
   * 종류 판별이 읽기에서 제일 오래 걸리는 단계다. 컬럼마다 모든 셀을 한 번씩 훑고,
   * 384차원 임베딩이면 그 컬럼이 384개다. 그래서 여기를 컬럼 단위로 알린다.
   */
  const report = options.onProgress
  names.forEach((name, index) => {
    if (name !== header[index]) {
      notices.push({
        level: 'info',
        column: name,
        message: `이름이 같은 컬럼이 있어 '${header[index] ?? ''}'을(를) '${name}'으로 구분했습니다.`,
      })
    }
    // "12/384"가 같이 뜬다. 막대가 멈춘 듯 보일 때 이 숫자가 움직이는 것이 근거가 된다.
    report?.(
      progressOf(
        'profiling',
        names.length === 0 ? 1 : index / names.length,
        `컬럼 ${index + 1}/${names.length}`,
      ),
    )
    profiles.set(name, profileColumn(rawColumns[index] ?? [], inference))
  })

  // 1) 문자열 안의 배열은 묶기 전에 막는다. 막힌 컬럼은 텍스트로 남는다.
  names.forEach((name, index) => {
    const profile = profiles.get(name)
    if (profile === undefined || profile.kind === 'number' || profile.kind === 'datetime') return
    const finding = detectStringVector(name, rawColumns[index] ?? [])
    if (finding !== null) notices.push({ level: 'warning', column: name, message: finding.message })
  })

  // 2) 넓은 형태 임베딩 묶기.
  const isNumeric = (name: string) => profiles.get(name)?.kind === 'number'
  const hasBlank = (name: string) => (profiles.get(name)?.blank ?? 0) > 0
  const groups = groupWideVectorColumns(names, isNumeric, hasBlank)
  const hiddenColumns = new Set<string>()
  for (const group of groups) for (const name of group.columns) hiddenColumns.add(name)

  report?.(progressOf('building', 0))

  // 3) 남은 컬럼을 종류대로 만든다.
  const columns: LoadedColumn[] = []
  const numericByName = new Map<string, Float64Array>()
  names.forEach((name, index) => {
    const raw = rawColumns[index] ?? []
    const profile = profiles.get(name) ?? profileColumn(raw, inference)
    if (profile.kind === 'number') {
      const built = buildNumberColumn(name, raw, profile)
      numericByName.set(name, built.values)
      if (!hiddenColumns.has(name)) columns.push(built)
      return
    }
    if (hiddenColumns.has(name)) return
    if (profile.kind === 'datetime') columns.push(buildDatetimeColumn(name, raw, profile))
    else if (profile.kind === 'category') columns.push(buildCategoryColumn(name, raw, profile))
    else columns.push(buildTextColumn(name, raw, profile))
  })

  // 4) 묶인 컬럼을 하나의 연속 버퍼로 옮긴다. 네이티브 리스트는 이미 그 모양이라 그대로 둔다.
  const vectors = [
    ...(options.nativeVectors ?? []),
    ...groups.map((group) =>
      vectorFromWideColumns(
        group.name,
        rowCount,
        group.columns.map((name) => numericByName.get(name) ?? new Float64Array(rowCount)),
      ),
    ),
  ]
  for (const group of groups) {
    notices.push({
      level: 'info',
      column: group.name,
      message: `'${group.name}' 컬럼 ${group.dimension}개를 ${group.dimension}차원 임베딩 하나로 묶었습니다.`,
    })
  }

  const assetId =
    options.assetId ??
    assetIdOfShape(
      rowCount,
      columns.map((column) => [column.name, column.kind] as const),
      vectors.map((vector) => [vector.name, vector.dimension] as const),
    )

  return {
    assetId,
    rowCount,
    columns,
    vectors,
    hiddenColumns,
    notices,
    lookup: lookupFor(columns, vectors),
  }
}

export type LoadDelimitedOptions = BuildOptions & {
  /** 주지 않으면 헤더 줄에서 고른다. */
  readonly delimiter?: string
}

/** CSV·TSV 텍스트 하나를 자산으로 만든다. */
export function loadDelimitedText(text: string, options: LoadDelimitedOptions = {}): LoadedTable {
  const report = options.onProgress
  const parsed: DelimitedTable = parseDelimitedText(text, options.delimiter, (read) =>
    report?.(progressOf('parsing', text.length === 0 ? 1 : read / text.length)),
  )
  const table = buildTable(parsed.header, parsed.columns, parsed.rowCount, options)
  if (parsed.overflowRows.length === 0) return table
  const notices: LoadNotice[] = [
    ...table.notices,
    {
      level: 'warning',
      message: `헤더보다 칸이 많은 행이 ${parsed.overflowRows.length}개 있습니다. 넘친 값은 읽지 않았습니다.`,
    },
  ]
  return { ...table, notices }
}
