import { describe, expect, it } from 'vitest'
import { detectStringVector } from './stringVectorGuard'

function repeat(value: string, count = 20): string[] {
  return Array.from({ length: count }, () => value)
}

describe('detectStringVector', () => {
  it('쉼표로 구분된 파이썬 리스트를 찾는다', () => {
    const finding = detectStringVector('embedding', repeat('[0.12, -0.44, 0.9, 0.31]'))
    expect(finding?.flavor).toBe('list')
    expect(finding?.truncated).toBe(false)
    expect(finding?.message).toContain('embedding_0')
  })

  it('공백으로 구분된 numpy 출력을 찾는다', () => {
    const finding = detectStringVector('embedding', repeat('[ 0.12 -0.44  0.9  0.31]'))
    expect(finding?.flavor).toBe('numpy')
    expect(finding?.truncated).toBe(false)
  })

  it('가운데가 잘린 numpy 출력은 잘렸다고 알린다', () => {
    // 여기서 파싱을 해 주면 잘린 벡터로 UMAP을 돌려 놓고 아무도 모른다.
    const finding = detectStringVector('embedding', repeat('[ 0.12 -0.44 ... 0.77  0.31]'))
    expect(finding?.truncated).toBe(true)
    expect(finding?.message).toContain('잘린')
  })

  it('값이 서넛뿐인 짧은 리스트는 벡터로 보지 않는다', () => {
    expect(detectStringVector('tags', repeat('[1, 2]'))).toBeNull()
  })

  it('숫자가 아닌 값이 든 리스트는 벡터로 보지 않는다', () => {
    expect(detectStringVector('tags', repeat('[배송, 결제, 환불, 계정]'))).toBeNull()
  })

  it('일부만 그런 모양이면 컬럼 전체를 그렇게 보지 않는다', () => {
    const values = [...repeat('[0.1, 0.2, 0.3, 0.4]', 5), ...repeat('보통 문장입니다', 15)]
    expect(detectStringVector('mixed', values)).toBeNull()
  })

  it('빈 칸은 비율 계산에서 빼고, 값이 하나도 없으면 아무 말도 하지 않는다', () => {
    expect(detectStringVector('empty', ['', null, undefined])).toBeNull()
    const finding = detectStringVector('embedding', ['', null, ...repeat('[0.1, 0.2, 0.3, 0.4]')])
    expect(finding).not.toBeNull()
  })
})
