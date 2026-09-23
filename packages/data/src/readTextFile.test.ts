import { describe, expect, it } from 'vitest'
import {
  TEXT_BYTE_LIMIT,
  buildText,
  countByLevel,
  levelAt,
  levelsOfLines,
  readTextFile,
  splitLines,
} from './readTextFile'
import { UnsupportedFileError } from './unsupported'

const bytesOf = (text: string): ArrayBuffer => {
  const encoded = new TextEncoder().encode(text)
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer
}

const fileOf = (name: string, bytes: ArrayBuffer) => ({
  name,
  size: bytes.byteLength,
  lastModified: 0,
  arrayBuffer: async () => bytes,
})

const LOG = `2026-09-20 12:01:30 [INFO] 서버 시작
2026-09-20 12:01:31 [DEBUG] 설정 읽음
2026-09-20 12:01:35 [ERROR] 연결 실패
2026-09-20 12:01:36 [WARN] 다시 시도합니다
2026-09-20 12:01:40 [ERROR] 포기합니다
`

describe('splitLines', () => {
  it('윈도우 줄바꿈의 \\r를 남기지 않는다', () => {
    // 남으면 줄 끝 글자를 찾는 검색이 조용히 빗나간다.
    expect(splitLines('가\r\n나\r다')).toEqual(['가', '나', '다'])
  })

  it('끝의 빈 줄 하나만 버린다', () => {
    expect(splitLines('가\n나\n')).toEqual(['가', '나'])
    // 일부러 둔 빈 줄은 남긴다.
    expect(splitLines('가\n나\n\n')).toEqual(['가', '나', ''])
  })

  it('빈 글자는 빈 줄 하나다', () => {
    expect(splitLines('')).toEqual([''])
  })
})

describe('levelsOfLines', () => {
  it('로그가 아니면 재지 않는다', () => {
    expect(levelsOfLines(splitLines(LOG), 'plain')).toHaveLength(0)
    expect(levelsOfLines(splitLines(LOG), 'code')).toHaveLength(0)
  })

  it('줄마다의 레벨을 자리로 담는다', () => {
    const levels = levelsOfLines(splitLines(LOG), 'log')
    expect(levels).toHaveLength(5)
    expect(levelAt(levels, 0)).toBe('info')
    expect(levelAt(levels, 2)).toBe('error')
    expect(levelAt(levels, 3)).toBe('warn')
  })

  it('레벨 없는 줄은 0이고 null로 되돌아온다', () => {
    const levels = levelsOfLines(['그냥 한 줄'], 'log')
    expect(levels[0]).toBe(0)
    expect(levelAt(levels, 0)).toBeNull()
    expect(levelAt(levels, 99)).toBeNull()
  })

  it('레벨별로 센다', () => {
    const counts = countByLevel(levelsOfLines(splitLines(LOG), 'log'))
    expect(counts).toEqual({ error: 2, warn: 1, info: 1, debug: 1, trace: 0 })
  })
})

describe('readTextFile', () => {
  it('로그 파일을 갈래·줄·레벨까지 갖춰 읽는다', async () => {
    const loaded = await readTextFile(fileOf('app.log', bytesOf(LOG)))
    expect(loaded.flavor).toBe('log')
    expect(loaded.lines).toHaveLength(5)
    expect(loaded.encoding).toBe('utf-8')
    expect(countByLevel(loaded.levels).error).toBe(2)
    expect(loaded.truncated).toBe(false)
  })

  it('같은 파일은 같은 id로 읽힌다', async () => {
    const one = await readTextFile(fileOf('app.log', bytesOf(LOG)))
    const two = await readTextFile(fileOf('app.log', bytesOf(LOG)))
    expect(one.assetId).toBe(two.assetId)
  })

  it('오류 줄이 있으면 안내로 알린다', async () => {
    const loaded = await readTextFile(fileOf('app.log', bytesOf(LOG)))
    expect(loaded.notices.some((notice) => notice.message.includes('오류 줄이 2개'))).toBe(true)
  })

  it('EUC-KR 파일을 깨뜨리지 않고 읽고, 추측했다고 알린다', async () => {
    const cp949 = new Uint8Array([
      0xc0,
      0xcc,
      0xb8,
      0xa7,
      0x0a, // '이름\n'
      0xb1,
      0xe8,
      0xc7,
      0xd1,
      0xb1,
      0xdb,
      0x0a, // '김한글\n'
    ])
    const buffer = cp949.buffer.slice(0, cp949.byteLength) as ArrayBuffer
    const loaded = await readTextFile(fileOf('메모.txt', buffer))
    expect(loaded.encoding).toBe('cp949')
    expect(loaded.lines).toEqual(['이름', '김한글'])
    expect(loaded.guessed).toBe(true)
    expect(loaded.notices.some((notice) => notice.level === 'warning')).toBe(true)
  })

  it('인코딩을 손으로 고르면 그대로 읽는다', async () => {
    const loaded = await readTextFile(fileOf('메모.txt', bytesOf('이름')), {
      forcedEncoding: 'cp949',
    })
    expect(loaded.encoding).toBe('cp949')
    expect(loaded.text).not.toBe('이름')
    expect(loaded.guessed).toBe(false)
  })

  it('읽지 못하면 이해할 수 있는 오류를 낸다', async () => {
    const broken = {
      name: '깨진.txt',
      size: 1,
      lastModified: 0,
      arrayBuffer: async () => {
        throw new Error('boom')
      },
    }
    await expect(readTextFile(broken)).rejects.toBeInstanceOf(UnsupportedFileError)
  })
})

describe('readTextFile — 아주 큰 파일', () => {
  /*
   * 자르는 자리가 한글 한 글자(UTF-8로 세 바이트)의 가운데에 떨어지게 만든 파일이다.
   * 끊긴 꼬리를 떼지 않으면 엄격한 UTF-8 해독이 실패하고, 감지가 CP949로 물러서서
   * 파일 전체가 깨져 보인다. 마지막 한 글자 때문에 32MB가 통째로 망가지는 것이다.
   */
  it('글자 가운데에서 잘려도 인코딩 감지가 무너지지 않는다', async () => {
    const filler = '가'.repeat(Math.ceil(TEXT_BYTE_LIMIT / 3))
    const bytes = bytesOf(filler)
    expect(bytes.byteLength).toBeGreaterThan(TEXT_BYTE_LIMIT)
    // 경계가 글자 가운데인지 확인한다. 아니면 이 시험이 아무것도 재지 않는다.
    expect((new Uint8Array(bytes)[TEXT_BYTE_LIMIT] ?? 0) & 0xc0).toBe(0x80)

    const loaded = await readTextFile(fileOf('큰.txt', bytes))
    expect(loaded.encoding).toBe('utf-8')
    expect(loaded.truncated).toBe(true)
    expect(loaded.text.startsWith('가가가')).toBe(true)
    // 잘린 자리에 대체 문자가 남지 않는다.
    expect(loaded.text.includes('�')).toBe(false)
    expect(loaded.notices.some((notice) => notice.message.includes('MB만 열었습니다'))).toBe(true)
  })
})

describe('buildText', () => {
  it('바이트를 다시 풀 수 있어서 인코딩을 바꿔 고를 수 있다', () => {
    const first = buildText({ assetId: 'a', name: '메모.txt' }, bytesOf('이름'))
    expect(first.encoding).toBe('utf-8')
    const again = buildText({ assetId: 'a', name: '메모.txt' }, first.bytes, {
      forcedEncoding: 'cp949',
    })
    expect(again.encoding).toBe('cp949')
    expect(again.text).not.toBe(first.text)
  })
})

describe('readTextFile 큰 파일', () => {
  it('한계보다 크면 앞부분만 떼어 온다 — 통째로 올리면 자르기 전에 죽는다', async () => {
    const head = bytesOf('첫 줄\n둘째 줄\n')
    let asked: [number | undefined, number | undefined] | null = null
    const loaded = await readTextFile({
      name: '거대한.log',
      size: 4 * 1024 * TEXT_BYTE_LIMIT,
      lastModified: 0,
      arrayBuffer: async () => {
        throw new Error('통째로 읽으면 안 된다')
      },
      slice: (start, end) => {
        asked = [start, end]
        return { arrayBuffer: async () => head }
      },
    })
    expect(asked).toEqual([0, TEXT_BYTE_LIMIT])
    expect(loaded.lines).toEqual(['첫 줄', '둘째 줄'])
  })

  it('떼어 온 것이라도 원본 크기로 잘렸다고 말한다', async () => {
    const loaded = await readTextFile({
      name: '거대한.log',
      size: 100 * 1024 * 1024,
      lastModified: 0,
      arrayBuffer: async () => bytesOf(''),
      slice: () => ({ arrayBuffer: async () => bytesOf('한 줄') }),
    })
    expect(loaded.truncated).toBe(true)
    expect(loaded.byteLength).toBe(100 * 1024 * 1024)
    expect(loaded.notices.some((notice) => notice.message.includes('100MB'))).toBe(true)
  })

  it('앞부분만 떼어 올 수 없으면 예전처럼 통째로 읽는다', async () => {
    const loaded = await readTextFile(fileOf('보통.log', bytesOf('한 줄')))
    expect(loaded.truncated).toBe(false)
    expect(loaded.lines).toEqual(['한 줄'])
  })

  it('작은 파일은 떼어 오지 않는다 — 두 번 읽을 이유가 없다', async () => {
    let sliced = false
    const bytes = bytesOf('짧은 글')
    const loaded = await readTextFile({
      name: '짧은.log',
      size: bytes.byteLength,
      lastModified: 0,
      arrayBuffer: async () => bytes,
      slice: () => {
        sliced = true
        return { arrayBuffer: async () => bytes }
      },
    })
    expect(sliced).toBe(false)
    expect(loaded.truncated).toBe(false)
  })
})
