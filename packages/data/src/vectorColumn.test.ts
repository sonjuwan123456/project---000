import { describe, expect, it } from 'vitest'
import { groupWideVectorColumns, vectorFromLists, vectorFromWideColumns } from './vectorColumn'

const allNumeric = () => true
const noBlanks = () => false

describe('groupWideVectorColumns', () => {
  it('0부터 이어지는 같은 접두사 컬럼을 묶는다', () => {
    const names = ['id', 'emb_0', 'emb_1', 'emb_2', 'category']
    const groups = groupWideVectorColumns(names, allNumeric, noBlanks)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('emb')
    expect(groups[0]?.dimension).toBe(3)
    expect(groups[0]?.columns).toEqual(['emb_0', 'emb_1', 'emb_2'])
  })

  it('구분자 없이 붙은 번호도 묶는다', () => {
    const groups = groupWideVectorColumns(['v0', 'v1', 'v2'], allNumeric, noBlanks)
    expect(groups[0]?.name).toBe('v')
  })

  it('1부터 시작하면 묶지 않는다', () => {
    // 분기 컬럼 q1, q2, q3을 임베딩으로 오인하지 않기 위한 조건이다.
    expect(groupWideVectorColumns(['q1', 'q2', 'q3'], allNumeric, noBlanks)).toHaveLength(0)
  })

  it('번호가 끊기면 묶지 않는다', () => {
    expect(groupWideVectorColumns(['emb_0', 'emb_1', 'emb_3'], allNumeric, noBlanks)).toHaveLength(
      0,
    )
  })

  it('숫자가 아닌 컬럼이 섞이면 묶지 않는다', () => {
    const isNumeric = (name: string) => name !== 'emb_1'
    expect(groupWideVectorColumns(['emb_0', 'emb_1'], isNumeric, noBlanks)).toHaveLength(0)
  })

  it('결측이 있으면 묶지 않는다', () => {
    const hasBlank = (name: string) => name === 'emb_2'
    expect(groupWideVectorColumns(['emb_0', 'emb_1', 'emb_2'], allNumeric, hasBlank)).toHaveLength(
      0,
    )
  })

  it('차원이 1이면 그냥 숫자 컬럼으로 둔다', () => {
    expect(groupWideVectorColumns(['emb_0'], allNumeric, noBlanks)).toHaveLength(0)
  })

  it('emb_0과 emb_00이 같이 오면 그 접두사는 통째로 버린다', () => {
    // 어느 쪽이 0번인지 알 수 없는데 묶어 버리면 조용히 틀린 벡터가 된다.
    const names = ['emb_0', 'emb_00', 'emb_1']
    expect(groupWideVectorColumns(names, allNumeric, noBlanks)).toHaveLength(0)
  })

  it('묶음이 여럿이면 차원이 큰 쪽이 앞이다', () => {
    const names = ['a_0', 'a_1', 'b_0', 'b_1', 'b_2']
    const groups = groupWideVectorColumns(names, allNumeric, noBlanks)
    expect(groups.map((group) => group.name)).toEqual(['b', 'a'])
  })
})

describe('vectorFromWideColumns', () => {
  it('행 우선으로 이어 붙인다 — i번 행이 [i*k, (i+1)*k)', () => {
    // UMAP·PCA가 원하는 배치와 같아야 워커로 넘길 때 변환이 없다.
    const vector = vectorFromWideColumns('emb', 3, [
      Float64Array.from([1, 4, 7]),
      Float64Array.from([2, 5, 8]),
      Float64Array.from([3, 6, 9]),
    ])
    expect(vector.dimension).toBe(3)
    expect(Array.from(vector.values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(vector.missingCount).toBe(0)
  })
})

describe('vectorFromLists', () => {
  it('첫 벡터의 길이를 차원으로 삼는다', () => {
    const vector = vectorFromLists('emb', [
      [1, 2],
      [3, 4],
    ])
    expect(vector.dimension).toBe(2)
    expect(Array.from(vector.values)).toEqual([1, 2, 3, 4])
  })

  it('길이가 다른 행은 지우지 않고 좌표 없음으로 둔다', () => {
    // 선택 비트 배열이 행 번호에 의존해서, 행을 지우면 선택이 어긋난다.
    const vector = vectorFromLists('emb', [[1, 2], [9], null, [3, 4]])
    expect(vector.rowCount).toBe(4)
    expect(Array.from(vector.missing)).toEqual([0, 1, 1, 0])
    expect(vector.missingCount).toBe(2)
  })

  it('NaN이 섞인 행도 좌표 없음으로 둔다', () => {
    const vector = vectorFromLists('emb', [
      [1, 2],
      [Number.NaN, 4],
    ])
    expect(Array.from(vector.missing)).toEqual([0, 1])
    expect(vector.missingCount).toBe(1)
  })
})
