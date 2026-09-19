import { describe, expect, it } from 'vitest'
import { isBlank, parseDatetime, parseNumber, profileColumn } from './columnType'

describe('parseNumber', () => {
  it('빈 문자열과 공백을 수로 보지 않는다', () => {
    // Number('')는 0이라 Number만으로는 이 구분이 안 된다.
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
  })

  it('앞뒤 공백은 떼고 지수 표기는 받는다', () => {
    expect(parseNumber(' 12 ')).toBe(12)
    expect(parseNumber('-0.5')).toBe(-0.5)
    expect(parseNumber('1.2e-3')).toBe(0.0012)
  })

  it('자릿수 쉼표와 단위가 붙은 값은 받지 않는다', () => {
    expect(parseNumber('1,234')).toBeNull()
    expect(parseNumber('12원')).toBeNull()
    expect(parseNumber('NaN')).toBeNull()
    expect(parseNumber('Infinity')).toBeNull()
  })
})

describe('parseDatetime', () => {
  it('타임존이 없으면 UTC로 읽는다', () => {
    // 로컬로 읽으면 같은 파일이 기기마다 다르게 보인다.
    expect(parseDatetime('2026-09-18')).toBe(Date.UTC(2026, 8, 18))
    expect(parseDatetime('2026-09-18T09:30:00')).toBe(Date.UTC(2026, 8, 18, 9, 30))
    expect(parseDatetime('2026-09-18 09:30')).toBe(Date.UTC(2026, 8, 18, 9, 30))
  })

  it('타임존이 있으면 그만큼 되돌린다', () => {
    expect(parseDatetime('2026-09-18T09:30:00Z')).toBe(Date.UTC(2026, 8, 18, 9, 30))
    expect(parseDatetime('2026-09-18T09:30:00+09:00')).toBe(Date.UTC(2026, 8, 18, 0, 30))
    expect(parseDatetime('2026-09-18T09:30:00-0500')).toBe(Date.UTC(2026, 8, 18, 14, 30))
  })

  it('없는 날짜를 다음 달로 넘기지 않는다', () => {
    // Date.UTC(2026, 1, 31)은 3월 3일이 된다.
    expect(parseDatetime('2026-02-31')).toBeNull()
    expect(parseDatetime('2026-13-01')).toBeNull()
  })

  it('ISO가 아닌 표기는 받지 않는다', () => {
    expect(parseDatetime('2026/09/18')).toBeNull()
    expect(parseDatetime('18-09-2026')).toBeNull()
  })
})

describe('profileColumn — 판별 순서', () => {
  it('95%가 수로 읽히면 나머지가 섞여 있어도 숫자다', () => {
    const values = Array.from({ length: 100 }, (_, row) => (row < 96 ? String(row) : '미상'))
    const profile = profileColumn(values)
    expect(profile.kind).toBe('number')
    expect(profile.unparsed).toBe(4)
  })

  it('94%면 숫자가 아니다', () => {
    const values = Array.from({ length: 100 }, (_, row) => (row < 94 ? String(row) : '미상'))
    expect(profileColumn(values).kind).not.toBe('number')
  })

  it('빈 칸은 비율 계산에서 빠진다', () => {
    const values = ['1', '2', '', null, undefined, '3']
    const profile = profileColumn(values)
    expect(profile.kind).toBe('number')
    expect(profile.sampled).toBe(3)
    expect(profile.blank).toBe(3)
  })

  it('ISO 날짜 컬럼은 날짜시간이다', () => {
    const values = Array.from(
      { length: 50 },
      (_, row) => `2026-09-${String((row % 28) + 1).padStart(2, '0')}`,
    )
    expect(profileColumn(values).kind).toBe('datetime')
  })

  it('연도만 있는 컬럼은 숫자로 간다 — 판별 순서가 숫자 먼저다', () => {
    const values = Array.from({ length: 50 }, () => '2026')
    expect(profileColumn(values).kind).toBe('number')
  })
})

describe('profileColumn — 범주와 텍스트', () => {
  it('짧고 값이 적으면 범주다', () => {
    const cities = ['서울', '부산', '대구', '인천']
    const values = Array.from({ length: 5000 }, (_, row) => cities[row % cities.length] ?? '')
    const profile = profileColumn(values)
    expect(profile.kind).toBe('category')
    expect(profile.uniqueCount).toBe(4)
  })

  it('고유값이 1000개를 넘어도 비율이 20% 이하면 범주다', () => {
    // 넓게 잡기로 한 쪽. 상품 코드 2000종이 5만 행에 반복되는 경우.
    const values = Array.from({ length: 2000 }, (_, row) => `SKU-${row % 1500}`)
    const profile = profileColumn(values, {
      sampleSize: 2000,
      numberRatio: 0.95,
      datetimeRatio: 0.95,
      categoryMaxUnique: 1000,
      categoryMaxUniqueRatio: 0.9,
      categoryMaxAverageLength: 80,
    })
    expect(profile.kind).toBe('category')
  })

  it('반복이 많아 고유값 비율이 낮아도 문장이 길면 텍스트다', () => {
    // 평균 길이 조건이 없으면 반복이 많은 문의 컬럼이 통째로 범주가 된다.
    const long =
      '주문한 상품이 아직 도착하지 않았습니다. 배송 예정일이 지났는데 출고 상태가 그대로이고 운송장 번호를 조회해도 정보가 나오지 않아 언제 받을 수 있는지 알 수가 없습니다.'
    const values = Array.from({ length: 1000 }, (_, row) => `${long} (${row % 5})`)
    const profile = profileColumn(values)
    expect(profile.averageLength).toBeGreaterThan(80)
    expect(profile.kind).toBe('text')
  })

  it('서로 다른 문장이 이어지면 길이가 짧아도 고유값에서 걸러진다', () => {
    // 한국어 한 문장은 80자를 넘기는 일이 드물어, 짧은 자유 문장은 길이 조건만으로는 못 거른다.
    // 실제 문의 5만 건은 문장이 저마다 달라 고유값 조건에서 텍스트로 빠진다.
    const values = Array.from(
      { length: 2000 },
      (_, row) => `${row}번 문의: 배송이 늦어 언제 오는지 알고 싶습니다`,
    )
    const profile = profileColumn(values)
    expect(profile.averageLength).toBeLessThan(80)
    expect(profile.kind).toBe('text')
  })

  it('짧은 문장이 몇 가지로 반복되면 범주로 본다', () => {
    // 넓게 잡기로 한 쪽의 결과. 값이 적고 짧으니 색칠·분포·필터가 되는 편이 쓸모 있다.
    const templates = ['배송이 늦습니다', '결제가 두 번 됐습니다', '환불이 안 들어옵니다']
    const values = Array.from({ length: 2000 }, (_, row) => templates[row % templates.length] ?? '')
    expect(profileColumn(values).kind).toBe('category')
  })

  it('컬럼 전체가 빈 칸이면 텍스트로 두고 표시한다', () => {
    const profile = profileColumn(['', '', null])
    expect(profile.kind).toBe('text')
    expect(profile.allBlank).toBe(true)
  })
})

describe('isBlank', () => {
  it('공백만 있는 칸은 빈 칸이고, NA 같은 표기는 값이다', () => {
    expect(isBlank('  ')).toBe(true)
    expect(isBlank(null)).toBe(true)
    expect(isBlank('NA')).toBe(false)
  })
})
