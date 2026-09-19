import { describe, expect, it } from 'vitest'
import { buildTable } from './loadTable'
import { loadDelimitedText } from './loadTable'
import { toViewModel } from './viewModel'

function csv(lines: readonly string[]) {
  return toViewModel(loadDelimitedText(lines.join('\n')), '시험.csv')
}

describe('좌표 고르기', () => {
  it('숫자 컬럼이 셋 이상이면 분산이 큰 셋으로 좌표를 만든다', () => {
    const lines = ['a,b,c,d']
    for (let row = 0; row < 50; row += 1) {
      // b는 거의 움직이지 않으니 빠져야 한다.
      lines.push(`${row},${100 + (row % 2)},${row * 3},${row * 7}`)
    }
    const model = csv(lines)
    expect(model.position).not.toBeNull()
    expect(model.position?.axes).not.toContain('b')
  })

  it('숫자가 셋이 안 되면 왜 못 만드는지 말한다', () => {
    const model = csv(['이름,점수', '가,1', '나,2', '다,3'])
    expect(model.position).toBeNull()
    expect(model.positionMissing).toContain('세 개')
  })

  it('숫자 컬럼이 없고 임베딩만 있으면 주성분으로 줄여서 좌표를 만든다', () => {
    const lines = ['emb_0,emb_1,emb_2,emb_3']
    for (let row = 0; row < 20; row += 1) lines.push(`${row},${row + 1},${row + 2},${row + 3}`)
    const model = csv(lines)
    // 넓은 형태가 벡터로 묶여서 숫자 컬럼이 남지 않는다. 그때만 줄인다.
    expect(model.position?.axes).toEqual(['PC1', 'PC2', 'PC3'])
    expect(model.position?.derivedFrom).toContain('주성분')
    expect(model.positionMissing).toBeNull()
  })

  it('숫자 컬럼이 셋 있으면 임베딩이 있어도 그 컬럼을 쓴다', () => {
    // 사용자가 아는 축이 이름 없는 주성분보다 읽기 쉽다.
    const lines = ['매출,방문,체류,emb_0,emb_1,emb_2']
    for (let row = 0; row < 20; row += 1) {
      lines.push(`${row * 3},${row * 7},${row * 2},${row},${row + 1},${row + 2}`)
    }
    const model = csv(lines)
    expect(model.position?.derivedFrom).toBeNull()
    expect(model.position?.axes).toContain('매출')
  })

  it('값이 하나뿐인 축은 좌표로 쓰지 않는다', () => {
    const lines = ['a,b,c']
    for (let row = 0; row < 30; row += 1) lines.push(`${row},5,5`)
    expect(csv(lines).position).toBeNull()
  })

  it('숫자 칸이 빈 행은 좌표 없음으로 두고 행은 남긴다', () => {
    const lines = ['a,b,c']
    for (let row = 0; row < 30; row += 1) {
      lines.push(row === 3 ? `,${row * 2},${row * 5}` : `${row},${row * 2},${row * 5}`)
    }
    const model = csv(lines)
    expect(model.rowCount).toBe(30)
    expect(model.position?.missingCount).toBe(1)
    expect(model.position?.missing[3]).toBe(1)
  })
})

describe('범주 고르기', () => {
  it('값이 적은 범주 컬럼을 색칠에 쓴다', () => {
    // 값이 수백 개인 컬럼으로 칠하면 대부분이 "기타"가 된다.
    const lines = ['메모,등급']
    for (let row = 0; row < 60; row += 1) lines.push(`메모 ${row},${['상', '중', '하'][row % 3]}`)
    expect(csv(lines).category?.column).toBe('등급')
  })

  it('열두 개를 넘는 값은 기타로 모은다', () => {
    const lines = ['이름']
    for (let row = 0; row < 40; row += 1) lines.push(`값${row % 20}`)
    const model = csv(lines)
    expect(model.category?.names).toHaveLength(13)
    expect(model.category?.names.at(-1)).toBe('기타')
    expect(model.category?.overflowSlot).toBe(12)
  })

  it('기타에 모인 자리는 원본 코드를 모두 들고 있다', () => {
    const lines = ['이름']
    for (let row = 0; row < 40; row += 1) lines.push(`값${row % 20}`)
    const role = csv(lines).category
    const overflow = role?.codesOfSlot.at(-1) ?? []
    expect(overflow).toHaveLength(8)
  })

  it('값이 팔레트보다 많은 컬럼은 표에서 색을 받지 않는다', () => {
    const lines = ['이름']
    for (let row = 0; row < 40; row += 1) lines.push(`값${row}`)
    const model = csv(lines)
    expect(model.columns[0]?.colorOf).toBeNull()
  })
})

describe('표에 그릴 칸', () => {
  it('종류에 맞는 칸으로 바꾼다', () => {
    const model = csv(['분류,점수,날짜', '배송,4,2026-09-18', '결제,2,2026-09-19'])
    const kinds = model.columns.map((column) => [column.name, column.kind])
    expect(kinds).toEqual([
      ['분류', 'tag'],
      ['점수', 'num'],
      ['날짜', 'num'],
    ])
    expect(model.columns[2]?.textOf(0)).toContain('2026')
  })

  it('날짜는 UTC로 그린다 — 불러올 때 UTC로 읽었기 때문이다', () => {
    const model = csv(['날짜', '2026-01-01', '2026-06-30'])
    expect(model.columns[0]?.textOf(0)).toContain('1')
    expect(model.columns[0]?.textOf(0)).toContain('2026')
  })

  it('빈 칸은 빈 글자로 둔다', () => {
    const model = csv(['점수', '1', '', '3'])
    expect(model.columns[0]?.textOf(1)).toBe('')
  })

  it('행 이름은 글자가 가장 긴 컬럼에서 가져온다', () => {
    const model = csv([
      '코드,내용',
      'A1,주문한 상품이 아직 도착하지 않아 확인을 부탁드립니다',
      'B2,결제가 두 번 청구되었습니다',
    ])
    expect(model.rowLabel(0)).toContain('주문한')
  })
})

describe('조회 함수', () => {
  it('불러온 표의 조회 함수를 그대로 내준다', () => {
    const table = buildTable(['점수'], [['1', '2']], 2)
    const model = toViewModel(table, '시험')
    expect(model.lookup('점수')?.[1]).toBe(2)
    expect(model.assetId).toBe(table.assetId)
  })
})
