/**
 * 컬럼 종류 판별 — 요구사항 문서 2.2의 〔확정 2026-09-18〕 규칙.
 *
 * 위에서부터 순서대로 검사하고 먼저 맞는 것으로 확정한다.
 * 벡터는 컬럼 하나만 봐서는 알 수 없어(넓은 형태는 여러 컬럼이 모여야 한다)
 * 여기서는 다루지 않는다. `groupWideVectorColumns`가 먼저 돌고 남은 컬럼이 여기로 온다.
 */

export type ScalarColumnKind = 'number' | 'datetime' | 'category' | 'text'

export type InferenceOptions = {
  /** 종류를 가릴 때 파싱해 볼 값의 개수. 앞에서부터가 아니라 컬럼 전체에 고르게 뿌린다. */
  readonly sampleSize: number
  /** 숫자로 확정하는 최소 비율. */
  readonly numberRatio: number
  /** 날짜시간으로 확정하는 최소 비율. */
  readonly datetimeRatio: number
  readonly categoryMaxUnique: number
  readonly categoryMaxUniqueRatio: number
  readonly categoryMaxAverageLength: number
}

export const DEFAULT_INFERENCE: InferenceOptions = {
  sampleSize: 2000,
  numberRatio: 0.95,
  datetimeRatio: 0.95,
  categoryMaxUnique: 1000,
  categoryMaxUniqueRatio: 0.2,
  categoryMaxAverageLength: 80,
}

export type ColumnProfile = {
  readonly kind: ScalarColumnKind
  /** 표본에서 비어 있지 않았던 값의 개수. */
  readonly sampled: number
  /** 표본에서 빈 칸이었던 개수. */
  readonly blank: number
  /** 확정된 종류로 파싱되지 않은 표본 값의 개수. 텍스트·범주는 항상 0. */
  readonly unparsed: number
  /**
   * 고유값 개수. 범주인지 가리는 데까지 간 컬럼은 **모든 행**을 세고,
   * 그 전에 숫자·날짜시간·긴 텍스트로 갈린 컬럼은 표본에서만 센다.
   * 셈은 범주가 될 수 없는 것이 확실해지는 수에서 멈추므로 그 위로는 정확하지 않다.
   */
  readonly uniqueCount: number
  readonly averageLength: number
  /** 컬럼 전체가 빈 칸이면 텍스트로 두고 인코딩 후보에서 뺀다. */
  readonly allBlank: boolean
}

/** 빈 칸 판정. 잘라내고 남은 것이 없으면 빈 칸이다. `NA`·`null` 같은 관용 표기는 값으로 본다. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

/**
 * 숫자 파싱. `Number('')`이 0이고 `Number(' 12 ')`가 12라 `Number`만으로는 못 쓴다.
 * 통화 기호·자릿수 구분 쉼표는 받지 않는다 — 받기 시작하면 `1,234`가 나라마다 달라진다.
 */
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

export function parseNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!NUMBER_PATTERN.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * ISO 8601 날짜·날짜시간. 타임존이 없으면 UTC로 고정 해석한다(요구사항 2.2).
 * 로컬 시간대로 두면 같은 파일이 기기마다 다르게 보여 재현성이 깨진다.
 *
 * 사용자가 형식을 직접 지정하는 경로는 컬럼 종류 변경 UI와 함께 붙는다.
 */
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/

export function parseDatetime(value: string): number | null {
  const match = ISO_PATTERN.exec(value.trim())
  if (match === null) return null
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const millis = fraction === undefined ? 0 : Math.round(Number(`0.${fraction}`) * 1000)
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour === undefined ? 0 : Number(hour),
    minute === undefined ? 0 : Number(minute),
    second === undefined ? 0 : Number(second),
    millis,
  )
  if (Number.isNaN(utc)) return null
  // Date.UTC는 2026-02-31을 3월 3일로 넘겨 버린다. 넘어간 날짜는 받지 않는다.
  const rolled = new Date(utc)
  if (
    rolled.getUTCFullYear() !== Number(year) ||
    rolled.getUTCMonth() !== Number(month) - 1 ||
    rolled.getUTCDate() !== Number(day)
  ) {
    return null
  }
  if (zone === undefined || zone === 'Z') return utc
  const sign = zone.startsWith('-') ? 1 : -1
  const digits = zone.slice(1).replace(':', '')
  const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))
  return utc + sign * offsetMinutes * 60_000
}

/**
 * 종류를 가릴 때 볼 행 번호. 앞에서부터 자르면 안 된다 — 파일은 정렬돼 있을 수 있고,
 * 로그처럼 중간부터 채워지기 시작한 컬럼은 앞 2천 행이 전부 빈 칸이라 통째로
 * 텍스트가 돼 버린다. 일정한 간격도 안 된다. 간격이 파일의 주기와 맞으면 한 부류만
 * 뽑힌다. 황금비 간격은 주기가 없고 씨앗 없이도 언제나 같은 행을 뽑는다.
 * `pca.ts`의 표본 솎기와 같은 이유로 같은 방식을 쓴다.
 */
const GOLDEN = 0.618033988749895

function* sampleRows(length: number, limit: number): Generator<number> {
  if (length <= limit) {
    for (let row = 0; row < length; row += 1) yield row
    return
  }
  for (let index = 0; index < limit; index += 1) {
    yield Math.floor(((index * GOLDEN) % 1) * length)
  }
}

/**
 * 고유값을 **모든 행에서** 센다. 비율 조건이 뜻을 가지려면 컬럼 전체를 봐야 한다.
 * 표본 2천 개로 비율을 재면 "고유값 ≤ 20%"는 고유값 400개 이하라는 뜻이 되어
 * "고유값 ≤ 1000" 안에 통째로 들어가 버린다. 즉 비율 조건이 아무것도 결정하지 못한다.
 *
 * 범주가 될 수 없는 것이 확실해지면 멈춘다. 그 위로 더 세어 봐야 답이 같고,
 * 자유 문장 컬럼에서 5만 개짜리 집합을 만들 이유가 없다.
 */
function countDistinct(
  values: readonly (string | null | undefined)[],
  options: InferenceOptions,
): { distinct: number; filled: number; exact: boolean } {
  const ceiling = Math.max(
    options.categoryMaxUnique,
    Math.ceil(values.length * options.categoryMaxUniqueRatio),
  )
  const seen = new Set<string>()
  let filled = 0
  for (const raw of values) {
    if (isBlank(raw)) continue
    filled += 1
    if (seen.size > ceiling) continue
    seen.add(raw as string)
  }
  return { distinct: seen.size, filled, exact: seen.size <= ceiling }
}

export function profileColumn(
  values: readonly (string | null | undefined)[],
  options: InferenceOptions = DEFAULT_INFERENCE,
): ColumnProfile {
  const unique = new Set<string>()
  let sampled = 0
  let blank = 0
  let numeric = 0
  let datetime = 0
  let lengthSum = 0

  for (const row of sampleRows(values.length, options.sampleSize)) {
    const raw = values[row]
    if (isBlank(raw)) {
      blank += 1
      continue
    }
    const value = raw as string
    sampled += 1
    lengthSum += value.length
    unique.add(value)
    if (parseNumber(value) !== null) numeric += 1
    if (parseDatetime(value) !== null) datetime += 1
  }

  const averageLength = sampled === 0 ? 0 : lengthSum / sampled
  const base = {
    sampled,
    blank,
    uniqueCount: unique.size,
    averageLength,
    allBlank: sampled === 0,
  }

  if (sampled === 0) {
    return { ...base, kind: 'text', unparsed: 0 }
  }
  if (numeric / sampled >= options.numberRatio) {
    return { ...base, kind: 'number', unparsed: sampled - numeric }
  }
  if (datetime / sampled >= options.datetimeRatio) {
    return { ...base, kind: 'datetime', unparsed: sampled - datetime }
  }
  // 길이는 표본만으로 갈린다. 여기서 텍스트로 빠지면 아래 전체 훑기를 하지 않는다.
  if (averageLength > options.categoryMaxAverageLength) {
    return { ...base, kind: 'text', unparsed: 0 }
  }

  const counted = countDistinct(values, options)
  const withinUnique =
    counted.distinct <= options.categoryMaxUnique ||
    (counted.exact && counted.distinct / counted.filled <= options.categoryMaxUniqueRatio)
  return {
    ...base,
    uniqueCount: counted.distinct,
    kind: withinUnique ? 'category' : 'text',
    unparsed: 0,
  }
}
