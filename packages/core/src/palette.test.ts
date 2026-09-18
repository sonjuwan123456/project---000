import { describe, expect, it } from 'vitest'
import { categoryPalette, cssVariables, hexToRgb01, holoColors } from './palette'

describe('hexToRgb01', () => {
  it('0~1 값으로 바꾼다', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1])
  })

  it('형식이 아니면 거부한다', () => {
    expect(() => hexToRgb01('5bd1e8')).toThrow()
  })
})

describe('cssVariables', () => {
  it('토큰 이름을 CSS 변수로 옮긴다', () => {
    expect(cssVariables()['--holo-bg']).toBe(holoColors.bg)
    expect(cssVariables()['--holo-cat-0']).toBeDefined()
  })
})

describe('categoryPalette', () => {
  it('색마다 세 값을 채운다', () => {
    const palette = categoryPalette()
    expect(palette.length % 3).toBe(0)
    expect(palette.every((value) => value >= 0 && value <= 1)).toBe(true)
  })
})
