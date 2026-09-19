/**
 * 컬럼 종류 판별 — 요구사항 문서 2.2의 〔확정 2026-09-18〕 규칙.
 *
 * 위에서부터 순서대로 검사하고 먼저 맞는 것으로 확정한다.
 * 벡터는 컬럼 하나만 봐서는 알 수 없어(넓은 형태는 여러 컬럼이 모여야 한다)
 * 여기서는 다루지 않는다. `groupWideVectorColumns`가 먼저 돌고 남은 컬럼이 여기로 온다.
 */

export type ScalarColumnKind = 'number' | 'datetime' | 'category' | 'text'

export type InferenceOptions = {
  /** 앞에서부터 몇 개를 보고 판단할지. 5만 행을 다 보지 않아도 종류는 갈린다. */
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
  /** 표본 기준 고유값 개수. 표본 크기가 상한이다. */
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

export function profileColumn(
  values: readonly (string | null | undefined)[],
  options: InferenceOptions = DEFAULT_INFERENCE,
): ColumnProfile {
  const limit = Math.min(values.length, options.sampleSize)
  const unique = new Set<string>()
  let sampled = 0
  let blank = 0
  let numeric = 0
  let datetime = 0
  let lengthSum = 0

  for (let row = 0; row < limit; row += 1) {
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
  const withinUnique =
    unique.size <= options.categoryMaxUnique ||
    unique.size / sampled <= options.categoryMaxUniqueRatio
  if (averageLength <= options.categoryMaxAverageLength && withinUnique) {
    return { ...base, kind: 'category', unparsed: 0 }
  }
  return { ...base, kind: 'text', unparsed: 0 }
}
