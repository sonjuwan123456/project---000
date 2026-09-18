import { describe, expect, it } from 'vitest'
import {
  composeSelection,
  maskToRowIndices,
  type ColumnLookup,
  type SelectionClause,
  type SelectionSource,
} from './selection'

const category = Uint8Array.from([0, 1, 2, 0, 1, 2])
const score = Float32Array.from([-0.9, -0.2, 0.1, 0.4, 0.8, -0.5])
const columns: ColumnLookup = (name) =>
  name === 'category' ? category : name === 'score' ? score : undefined

const clausesOf = (...entries: [SelectionSource, SelectionClause][]) => new Map(entries)

describe('composeSelection', () => {
  it('조건이 없으면 배열을 만들지 않고 전체를 돌려준다', () => {
    const result = composeSelection(6, clausesOf(), columns)
    expect(result.mask).toBeNull()
    expect(result.count).toBe(6)
  })

  it('조건을 AND로 합친다', () => {
    const result = composeSelection(
      6,
      clausesOf(
        ['chart', { kind: 'category', column: 'category', values: [0, 1] }],
        ['histogram', { kind: 'range', column: 'score', min: 0, max: 1 }],
      ),
      columns,
    )
    expect(Array.from(result.mask ?? [])).toEqual([0, 0, 0, 1, 1, 0])
    expect(result.count).toBe(2)
  })

  it('필터 뷰는 자기 조건을 뺀 나머지만 적용받는다', () => {
    const clauses = clausesOf(
      ['chart', { kind: 'category', column: 'category', values: [0] }],
      ['histogram', { kind: 'range', column: 'score', min: 0, max: 1 }],
    )
    const forChart = composeSelection(6, clauses, columns, { exclude: 'chart' })
    expect(Array.from(forChart.mask ?? [])).toEqual([0, 0, 1, 1, 1, 0])
  })

  it('올가미 선택은 행을 직접 고른다', () => {
    const rows = Uint8Array.from([1, 0, 1, 0, 0, 1])
    const result = composeSelection(6, clausesOf(['cluster', { kind: 'rows', rows }]), columns)
    expect(result.count).toBe(3)
  })

  it('없는 컬럼을 참조하는 조건은 무시한다', () => {
    const result = composeSelection(
      6,
      clausesOf(['chart', { kind: 'category', column: '없는컬럼', values: [1] }]),
      columns,
    )
    expect(result.count).toBe(6)
  })
})

describe('maskToRowIndices', () => {
  it('선택된 행 번호만 순서대로 모은다', () => {
    const selection = composeSelection(
      6,
      clausesOf(['chart', { kind: 'category', column: 'category', values: [2] }]),
      columns,
    )
    expect(Array.from(maskToRowIndices(selection) ?? [])).toEqual([2, 5])
  })

  it('조건이 없으면 배열을 만들지 않는다', () => {
    expect(maskToRowIndices({ mask: null, count: 6 })).toBeNull()
  })
})
