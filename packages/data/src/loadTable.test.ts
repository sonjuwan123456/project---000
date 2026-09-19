import { composeSelection } from '@holo/core'
import { describe, expect, it } from 'vitest'
import {
  buildTable,
  loadDelimitedText,
  type LoadedCategoryColumn,
  type LoadedNumberColumn,
} from './loadTable'

function columnNamed(table: ReturnType<typeof buildTable>, name: string) {
  return table.columns.find((column) => column.name === name)
}

describe('loadDelimitedText — 컬럼 종류', () => {
  const csv = [
    '문의번호,접수일,분류,만족도,내용',
    '1,2026-09-01,배송,4,상품이 아직 도착하지 않았습니다',
    '2,2026-09-02,결제,2,카드가 두 번 청구되었습니다',
    '3,2026-09-03,배송,5,운송장 번호가 조회되지 않습니다',
    '4,2026-09-04,환불,,반품 후 환불이 들어오지 않습니다',
  ].join('\n')

  it('컬럼마다 종류를 갈라 놓는다', () => {
    const table = loadDelimitedText(csv)
    expect(table.rowCount).toBe(4)
    expect(columnNamed(table, '문의번호')?.kind).toBe('number')
    expect(columnNamed(table, '접수일')?.kind).toBe('datetime')
    expect(columnNamed(table, '분류')?.kind).toBe('category')
    expect(columnNamed(table, '만족도')?.kind).toBe('number')
  })

  it('빈 칸이 있어도 행은 남는다', () => {
    // 행을 지우면 선택 비트 배열이 어긋난다.
    const table = loadDelimitedText(csv)
    const score = columnNamed(table, '만족도') as LoadedNumberColumn
    expect(score.values).toHaveLength(4)
    expect(Number.isNaN(score.values[3] as number)).toBe(true)
    expect(score.nullCount).toBe(1)
  })

  it('범주는 많은 순으로 번호를 매긴다', () => {
    const table = loadDelimitedText(csv)
    const kind = columnNamed(table, '분류') as LoadedCategoryColumn
    expect(kind.categories[0]).toBe('배송')
    expect(Array.from(kind.counts)).toEqual([2, 1, 1])
  })

  it('날짜는 UTC로 읽는다', () => {
    const table = loadDelimitedText(csv)
    const received = columnNamed(table, '접수일')
    expect(received?.kind).toBe('datetime')
    if (received?.kind !== 'datetime') return
    expect(received.values[0]).toBe(Date.UTC(2026, 8, 1))
  })
})

describe('buildTable — 파싱되지 않은 값', () => {
  it('95%에서 빠진 값을 버리지 않고 원본 문자열로 남긴다', () => {
    const values = Array.from({ length: 100 }, (_, row) => (row === 7 ? '미상' : String(row)))
    const table = buildTable(['수량'], [values], values.length)
    const column = columnNamed(table, '수량') as LoadedNumberColumn
    expect(column.kind).toBe('number')
    expect(column.unparsed.get(7)).toBe('미상')
    expect(Number.isNaN(column.values[7] as number)).toBe(true)
  })
})

describe('buildTable — 넓은 형태 임베딩', () => {
  const rows = 4
  const wide = {
    id: Array.from({ length: rows }, (_, row) => String(row)),
    emb_0: Array.from({ length: rows }, (_, row) => String(row * 3)),
    emb_1: Array.from({ length: rows }, (_, row) => String(row * 3 + 1)),
    emb_2: Array.from({ length: rows }, (_, row) => String(row * 3 + 2)),
  }

  it('묶어서 벡터 하나로 만들고 원본 컬럼은 감춘다', () => {
    const table = buildTable(Object.keys(wide), Object.values(wide), rows)
    expect(table.vectors).toHaveLength(1)
    expect(table.vectors[0]?.dimension).toBe(3)
    expect(Array.from(table.vectors[0]?.values ?? [])).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
    expect(table.hiddenColumns.has('emb_1')).toBe(true)
    expect(table.columns.map((column) => column.name)).toEqual(['id'])
  })

  it('묶었다는 사실을 안내로 남긴다', () => {
    const table = buildTable(Object.keys(wide), Object.values(wide), rows)
    expect(table.notices.some((notice) => notice.column === 'emb')).toBe(true)
  })

  it('결측이 하나라도 있으면 묶지 않고 숫자 컬럼으로 남긴다', () => {
    const broken = { ...wide, emb_1: ['0', '', '6', '9'] }
    const table = buildTable(Object.keys(broken), Object.values(broken), rows)
    expect(table.vectors).toHaveLength(0)
    expect(table.columns).toHaveLength(4)
  })
})

describe('buildTable — 문자열 안의 배열', () => {
  it('파싱하지 않고 안내만 남긴다', () => {
    const values = Array.from({ length: 20 }, () => '[0.12, -0.44, 0.9, 0.31]')
    const table = buildTable(['embedding'], [values], values.length)
    expect(table.vectors).toHaveLength(0)
    const notice = table.notices.find((entry) => entry.column === 'embedding')
    expect(notice?.level).toBe('warning')
    expect(notice?.message).toContain('Parquet')
  })
})

describe('buildTable — 조회 함수', () => {
  it('선택 코디네이터에 그대로 넘길 수 있다', () => {
    const table = loadDelimitedText(
      ['분류,만족도', '배송,4', '결제,2', '배송,5', '환불,1'].join('\n'),
    )
    const kind = columnNamed(table, '분류') as LoadedCategoryColumn
    const delivery = kind.categories.indexOf('배송')
    const selection = composeSelection(
      table.rowCount,
      new Map([['표', { kind: 'category' as const, column: '분류', values: [delivery] }]]),
      table.lookup,
    )
    expect(selection.count).toBe(2)
  })

  it('빈 칸은 어떤 구간 조건에도 걸리지 않는다', () => {
    const table = loadDelimitedText(['점수', '1', '', '3'].join('\n'))
    const selection = composeSelection(
      table.rowCount,
      new Map([['표', { kind: 'range' as const, column: '점수', min: -1e9, max: 1e9 }]]),
      table.lookup,
    )
    expect(selection.count).toBe(2)
  })
})

describe('buildTable — 이름이 겹치는 컬럼', () => {
  it('뒤쪽 이름에 번호를 붙여 떼어 놓는다', () => {
    const table = buildTable(['값', '값'], [['1'], ['2']], 1)
    expect(table.columns.map((column) => column.name)).toEqual(['값', '값 (2)'])
    expect(table.lookup('값 (2)')?.[0]).toBe(2)
  })
})
