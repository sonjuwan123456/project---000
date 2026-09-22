import { describe, expect, it } from 'vitest'
import { decodeText, readBom, trimToUtf8Boundary, type DetectedEncoding } from './encoding'

/** CP949로 인코딩한다. Node의 해독기는 읽기만 되므로 표를 뒤집어 쓴다. */
function toCp949(text: string): Uint8Array {
  const decoder = new TextDecoder('windows-949')
  const out: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x80) {
      out.push(code)
      continue
    }
    // 두 바이트 조합을 훑어 같은 글자가 나오는 자리를 찾는다. 시험 문장 길이면 충분하다.
    let found = false
    for (let lead = 0x81; lead <= 0xfe && !found; lead += 1) {
      for (let trail = 0x41; trail <= 0xfe && !found; trail += 1) {
        if (decoder.decode(new Uint8Array([lead, trail])) === character) {
          out.push(lead, trail)
          found = true
        }
      }
    }
    if (!found) throw new Error(`CP949로 적을 수 없는 글자: ${character}`)
  }
  return new Uint8Array(out)
}

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const utf8 = (text: string): ArrayBuffer => bufferOf(new TextEncoder().encode(text))

function withPrefix(prefix: readonly number[], rest: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(prefix.length + rest.byteLength)
  out.set(prefix, 0)
  out.set(rest, prefix.length)
  return bufferOf(out)
}

/** UTF-16LE로 적는다. */
function toUtf16le(text: string, bom: boolean): ArrayBuffer {
  const units: number[] = []
  if (bom) units.push(0xff, 0xfe)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    units.push(code & 0xff, code >> 8)
  }
  return bufferOf(new Uint8Array(units))
}

const KOREAN = '이름,분류,내용\n김한글,배송,물건이 언제 오나요\n박세종,환불,환불 부탁드립니다\n'

describe('readBom', () => {
  it('UTF-8 BOM을 알아본다', () => {
    expect(readBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({
      encoding: 'utf-8-bom',
      skip: 3,
    })
  })

  it('UTF-16 BOM을 양쪽 다 알아본다', () => {
    expect(readBom(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))?.encoding).toBe('utf-16le')
    expect(readBom(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))?.encoding).toBe('utf-16be')
  })

  it('UTF-32LE를 UTF-16LE로 잘못 보지 않는다', () => {
    // FF FE 00 00 은 UTF-32LE BOM이다. 앞 두 바이트만 보면 UTF-16LE로 읽는다.
    expect(readBom(new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00]))).toBeNull()
  })

  it('BOM이 없으면 null이다', () => {
    expect(readBom(new TextEncoder().encode('이름,값'))).toBeNull()
  })

  it('파일이 BOM보다 짧아도 터지지 않는다', () => {
    expect(readBom(new Uint8Array([0xef]))).toBeNull()
    expect(readBom(new Uint8Array([]))).toBeNull()
  })
})

describe('decodeText', () => {
  it('UTF-8 한국어를 그대로 읽는다', () => {
    const decoded = decodeText(utf8(KOREAN))
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.text).toBe(KOREAN)
    expect(decoded.guessed).toBe(true)
  })

  it('EUC-KR 한국어를 깨뜨리지 않고 읽는다', () => {
    const decoded = decodeText(bufferOf(toCp949(KOREAN)))
    expect(decoded.encoding).toBe('cp949')
    // 이것이 M1 완료 기준이다. UTF-8로 읽으면 여기가 '�̸�,...'이 된다.
    expect(decoded.text).toBe(KOREAN)
  })

  /*
   * CP949 확장 영역(선두 0x81~0xA0, 완성형 2,350자 밖의 한글 8,822자)은 여기서 시험하지
   * 않는다. 이 Node 빌드의 `windows-949` 해독기가 그 영역을 두 바이트로 보지 않아서
   * (0x81 0x41이 '갂'이 아니라 U+0081 + 'A'로 나온다) 시험이 해독기의 한계를 재게 된다.
   * 브라우저는 WHATWG 인코딩 표준을 따라 그 영역까지 읽는다. 확인은 브라우저에서 한다.
   */

  it('BOM이 붙은 UTF-8은 BOM을 글자로 남기지 않는다', () => {
    const decoded = decodeText(withPrefix([0xef, 0xbb, 0xbf], new TextEncoder().encode(KOREAN)))
    expect(decoded.encoding).toBe('utf-8-bom')
    expect(decoded.text).toBe(KOREAN)
    // 떼어 내지 않으면 첫 컬럼 이름이 '<BOM>이름'이 되어 조회가 조용히 빗나간다.
    expect(decoded.text.startsWith('\ufeff')).toBe(false)
    expect(decoded.guessed).toBe(false)
  })

  it('UTF-16LE도 읽는다', () => {
    const decoded = decodeText(toUtf16le(KOREAN, true))
    expect(decoded.encoding).toBe('utf-16le')
    expect(decoded.text).toBe(KOREAN)
    expect(decoded.guessed).toBe(false)
  })

  it('아스키만 있으면 UTF-8로 본다', () => {
    const decoded = decodeText(utf8('name,value\na,1\n'))
    expect(decoded.encoding).toBe('utf-8')
    expect(decoded.text).toBe('name,value\na,1\n')
  })

  it('빈 파일도 터지지 않는다', () => {
    expect(decodeText(new ArrayBuffer(0)).text).toBe('')
  })

  it('손으로 고른 인코딩이 감지를 이긴다', () => {
    const bytes = toCp949(KOREAN)
    // 감지에 맡기면 cp949가 나오는 파일을 일부러 UTF-8로 읽게 한다.
    const forced = decodeText(bufferOf(bytes), 'utf-8')
    expect(forced.encoding).toBe('utf-8')
    expect(forced.guessed).toBe(false)
    expect(forced.text).not.toBe(KOREAN)
    // 강제 해독은 엄격하지 않아야 한다. 던지면 사용자가 고쳐 볼 기회가 없다.
    expect(forced.text.length).toBeGreaterThan(0)
  })

  it('손으로 고른 것이 BOM과 같으면 BOM을 떼어 낸다', () => {
    const forced = decodeText(
      withPrefix([0xef, 0xbb, 0xbf], new TextEncoder().encode(KOREAN)),
      'utf-8-bom',
    )
    expect(forced.text).toBe(KOREAN)
  })

  it('고른 인코딩마다 다른 글자가 나온다', () => {
    const bytes = bufferOf(toCp949('한글'))
    const seen = new Map<DetectedEncoding, string>()
    for (const encoding of ['utf-8', 'cp949', 'utf-16le'] as const) {
      seen.set(encoding, decodeText(bytes, encoding).text)
    }
    expect(seen.get('cp949')).toBe('한글')
    expect(new Set(seen.values()).size).toBe(3)
  })
})

describe('trimToUtf8Boundary', () => {
  const encode = (text: string) => new TextEncoder().encode(text)

  it('온전한 글자는 건드리지 않는다', () => {
    const bytes = encode('가나다')
    expect(trimToUtf8Boundary(bytes)).toHaveLength(bytes.byteLength)
    expect(trimToUtf8Boundary(encode('abc'))).toHaveLength(3)
  })

  it('끊긴 꼬리를 뗀다', () => {
    // '가'는 UTF-8로 세 바이트다. 하나·둘만 남은 끝은 글자가 되지 못한다.
    const whole = encode('가나')
    for (const cut of [1, 2]) {
      const trimmed = trimToUtf8Boundary(whole.subarray(0, 3 + cut))
      expect(new TextDecoder('utf-8', { fatal: true }).decode(trimmed)).toBe('가')
    }
  })

  it('네 바이트 글자(이모지)도 센다', () => {
    const whole = encode('a🎉')
    for (const cut of [1, 2, 3]) {
      const trimmed = trimToUtf8Boundary(whole.subarray(0, 1 + cut))
      expect(new TextDecoder('utf-8', { fatal: true }).decode(trimmed)).toBe('a')
    }
  })

  it('이어짐 바이트만 있는 조각에서도 터지지 않는다', () => {
    expect(trimToUtf8Boundary(new Uint8Array([0x80, 0x80]))).toHaveLength(2)
    expect(trimToUtf8Boundary(new Uint8Array([]))).toHaveLength(0)
  })

  it('떼고 나면 엄격한 UTF-8 해독이 통과한다 — 이것이 노리는 바다', () => {
    // 떼지 않으면 감지가 UTF-8을 포기하고 CP949로 물러서서 파일 전체가 깨져 보인다.
    // '한글 '이 일곱 바이트, '파'가 여덟째부터 셋. 아홉에서 자르면 '파'가 반만 남는다.
    const whole = encode('한글 파일입니다')
    const cut = whole.subarray(0, 9)
    expect(decodeText(bufferOf(cut)).encoding).not.toBe('utf-8')
    expect(decodeText(bufferOf(trimToUtf8Boundary(cut))).encoding).toBe('utf-8')
    expect(decodeText(bufferOf(trimToUtf8Boundary(cut))).text).toBe('한글 ')
  })
})
