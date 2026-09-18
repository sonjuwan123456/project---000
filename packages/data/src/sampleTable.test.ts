import { describe, expect, it } from 'vitest'
import { SAMPLE_CATEGORIES, createSampleTable } from './sampleTable'

describe('createSampleTable', () => {
  it('요청한 행 수를 정확히 채운다', () => {
    const table = createSampleTable(1000)
    expect(table.rowCount).toBe(1000)
    expect(table.x).toHaveLength(1000)
    expect(table.x.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('같은 씨앗이면 같은 표가 나온다', () => {
    const a = createSampleTable(500)
    const b = createSampleTable(500)
    expect(Array.from(a.sentiment.slice(0, 10))).toEqual(Array.from(b.sentiment.slice(0, 10)))
  })

  it('모든 범주가 들어 있고 기타 덩어리는 작다', () => {
    const table = createSampleTable(5000)
    const counts = new Array(SAMPLE_CATEGORIES.length).fill(0) as number[]
    for (let row = 0; row < table.rowCount; row += 1) {
      const index = table.category[row] ?? 0
      counts[index] = (counts[index] ?? 0) + 1
    }
    expect(counts.every((count) => count > 0)).toBe(true)
    expect(counts[5] ?? 0).toBeLessThan(counts[0] ?? 0)
  })

  it('컬럼 조회 함수가 선택 코디네이터에 바로 들어맞는다', () => {
    const table = createSampleTable(100)
    expect(table.columns('sentiment')).toBe(table.sentiment)
    expect(table.columns('없는컬럼')).toBeUndefined()
  })

  it('원문과 날짜를 행마다 만든다', () => {
    const table = createSampleTable(100)
    expect(table.textOf(0).length).toBeGreaterThan(0)
    expect(table.dateOf(0).getTime()).toBeGreaterThan(0)
  })
})
