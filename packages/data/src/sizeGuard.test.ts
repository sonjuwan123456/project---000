import { describe, expect, it } from 'vitest'
import { checkFileSize, formatBytes, kindOfName, limitsOf, sizeNotices } from './sizeGuard'

const MB = 1024 * 1024

describe('formatBytes', () => {
  it('단위를 바꿔 가며 읽을 만하게 적는다', () => {
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2KB')
    expect(formatBytes(7 * MB)).toBe('7.0MB')
    expect(formatBytes(1536 * MB)).toBe('1.5GB')
  })

  it('10MB를 넘으면 소수점을 버린다 — 큰 수에서 .3MB는 뜻이 없다', () => {
    expect(formatBytes(9.44 * MB)).toBe('9.4MB')
    expect(formatBytes(120.6 * MB)).toBe('121MB')
  })
})

describe('checkFileSize', () => {
  it('기준 작업량(5만 행 × 384차원, 약 7MB)은 아무 말 없이 지나간다', () => {
    expect(checkFileSize('점.csv', 7 * MB).level).toBe('ok')
  })

  it('경고선 바로 아래와 바로 위가 갈린다', () => {
    const { warnBytes } = limitsOf('table')
    expect(checkFileSize('점.csv', warnBytes).level).toBe('ok')
    expect(checkFileSize('점.csv', warnBytes + 1).level).toBe('warn')
  })

  it('거부선 바로 아래와 바로 위가 갈린다', () => {
    const { blockBytes } = limitsOf('table')
    expect(checkFileSize('점.csv', blockBytes).level).toBe('warn')
    expect(checkFileSize('점.csv', blockBytes + 1).level).toBe('block')
  })

  it('막을 때는 파일 이름과 실제 크기와 한계를 다 말한다', () => {
    const verdict = checkFileSize('아주큰표.csv', 500 * MB)
    expect(verdict.level).toBe('block')
    if (verdict.level !== 'block') return
    expect(verdict.message).toContain('아주큰표.csv')
    expect(verdict.message).toContain('500MB')
    expect(verdict.message).toContain('400MB')
  })

  it('종류마다 기준이 다르다 — 같은 크기가 표는 막히고 모델은 열린다', () => {
    expect(checkFileSize('무거운.csv', 500 * MB).level).toBe('block')
    expect(checkFileSize('무거운.glb', 500 * MB).level).toBe('warn')
  })

  it('글자 파일은 크기를 따지지 않는다 — 읽개가 앞 32MB만 떼어다 푼다', () => {
    expect(checkFileSize('거대한.log', 4096 * MB).level).toBe('ok')
  })

  it('크기를 모르는 파일은 통과시킨다 — 모르는 것을 막으면 다 막힌다', () => {
    expect(checkFileSize('점.csv', undefined).level).toBe('ok')
  })

  it('확장자를 모르면 표로 본다 — 틀려도 막히지 죽지는 않는다', () => {
    expect(checkFileSize('정체불명.bin', 500 * MB).level).toBe('block')
    expect(checkFileSize('확장자없음', 500 * MB).level).toBe('block')
  })

  it('종류를 직접 주면 이름을 무시한다 — 내용으로 갈린 파일이 그렇게 온다', () => {
    expect(checkFileSize('로그처럼생긴.txt', 500 * MB, 'text').level).toBe('ok')
    expect(checkFileSize('로그처럼생긴.txt', 500 * MB).level).toBe('block')
  })

  it('경고는 막지 않는다 — 문구가 여는 일을 말려서는 안 된다', () => {
    const verdict = checkFileSize('제법큰.csv', 200 * MB)
    expect(verdict.level).toBe('warn')
    if (verdict.level !== 'warn') return
    expect(verdict.message).toContain('200MB')
    expect(verdict.message).not.toContain('열지 않았습니다')
  })
})

describe('kindOfName', () => {
  it('확장자로 종류를 낸다', () => {
    expect(kindOfName('점.csv')).toBe('table')
    expect(kindOfName('모형.glb')).toBe('model')
    expect(kindOfName('기록.log')).toBe('text')
  })

  it('모르는 것과 없는 것은 표로 둔다', () => {
    expect(kindOfName('정체불명.bin')).toBe('table')
    expect(kindOfName('확장자없음')).toBe('table')
  })

  it('아직 못 읽는 형식도 종류는 안다 — 크기부터 막을 일은 아니다', () => {
    expect(kindOfName('표.parquet')).toBe('table')
    expect(kindOfName('모형.fbx')).toBe('model')
  })
})

describe('sizeNotices', () => {
  it('경고만 안내가 된다 — 괜찮은 것과 막은 것은 안내할 말이 없다', () => {
    expect(sizeNotices({ level: 'ok' })).toEqual([])
    expect(sizeNotices({ level: 'block', message: '막았습니다' })).toEqual([])
    expect(sizeNotices({ level: 'warn', message: '큽니다' })).toEqual([
      { level: 'warning', message: '큽니다' },
    ])
  })
})
