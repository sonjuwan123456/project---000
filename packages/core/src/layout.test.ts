import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, clampLayout, resizeLayout, sameLayout } from './layout'

describe('resizeLayout', () => {
  it('옆 손잡이를 왼쪽으로 끌면 옆 패널이 넓어진다', () => {
    const next = resizeLayout(DEFAULT_LAYOUT, 'side', -80, 600)
    expect(next.side).toBe(DEFAULT_LAYOUT.side + 80)
    expect(next.bottom).toBe(DEFAULT_LAYOUT.bottom)
  })

  it('아래 손잡이를 위로 끌면 표가 커진다. 픽셀은 높이에 대한 비율로 바뀐다', () => {
    const next = resizeLayout({ side: 300, bottom: 0.4 }, 'bottom', -60, 600)
    expect(next.bottom).toBeCloseTo(0.5)
    expect(next.side).toBe(300)
  })

  it('범위 밖으로는 끌려 나가지 않는다', () => {
    expect(resizeLayout(DEFAULT_LAYOUT, 'side', -5000, 600).side).toBe(LAYOUT_LIMITS.side.max)
    expect(resizeLayout(DEFAULT_LAYOUT, 'side', 5000, 600).side).toBe(LAYOUT_LIMITS.side.min)
    expect(resizeLayout(DEFAULT_LAYOUT, 'bottom', -5000, 600).bottom).toBe(LAYOUT_LIMITS.bottom.max)
    expect(resizeLayout(DEFAULT_LAYOUT, 'bottom', 5000, 600).bottom).toBe(LAYOUT_LIMITS.bottom.min)
  })

  it('높이를 모르면(0) 아래 패널을 건드리지 않는다', () => {
    expect(resizeLayout(DEFAULT_LAYOUT, 'bottom', -60, 0)).toBe(DEFAULT_LAYOUT)
  })
})

describe('clampLayout', () => {
  it('기본 배치는 범위 안이다', () => {
    expect(clampLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT)
  })

  it('옆 폭은 정수 픽셀로 맞춘다', () => {
    expect(clampLayout({ side: 301.6, bottom: 0.4 }).side).toBe(302)
  })
})

describe('sameLayout', () => {
  it('끝자리 오차는 같은 것으로 본다', () => {
    expect(
      sameLayout(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, bottom: DEFAULT_LAYOUT.bottom + 1e-9 }),
    ).toBe(true)
    expect(sameLayout(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, side: 301 })).toBe(false)
  })
})
