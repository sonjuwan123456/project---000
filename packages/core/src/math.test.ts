import { describe, expect, it } from 'vitest'
import { clamp, damp, lerp } from './math'

describe('clamp', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('범위 밖의 값은 자른다', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('lerp', () => {
  it('양 끝과 가운데를 맞춘다', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.5)).toBe(5)
  })
})

describe('damp', () => {
  it('프레임을 쪼개도 같은 시간이면 같은 곳에 도달한다', () => {
    const smoothing = 0.01
    const oneStep = damp(0, 100, smoothing, 1)

    let split = 0
    for (let i = 0; i < 10; i += 1) {
      split = damp(split, 100, smoothing, 0.1)
    }

    expect(split).toBeCloseTo(oneStep, 6)
  })

  it('목표에 다가가되 넘지 않는다', () => {
    const next = damp(0, 100, 0.01, 0.016)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(100)
  })
})
