import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { bundleOf, pickPrimary } from './fileBundle'
import { entriesOfZip, looksLikeZip } from './readZip'
import { UnsupportedFileError } from './unsupported'

/*
 * 아래 둘은 **바깥에서 만든 zip**이다. 내가 짠 읽개를 내가 짠 쓰개로만 시험하면 둘이
 * 같은 오해를 나눠 갖고도 통과한다. 그래서 형식을 못박는 시험은 파이썬이 만든 바이트로
 * 한다. REAL은 파이썬 `zipfile`이 만든 것(폴더 항목, deflate, UTF-8 한글 이름),
 * CP949는 이름을 CP949로 적고 UTF-8 깃발을 세우지 않은 것 — 윈도 탐색기가 만드는 모양이다.
 */
const REAL =
  'UEsDBBQAAAgIADF3Nl33RWY4IgAAAKsBAAARAAAA66qo7ZiVL3NjZW5lLmdsdGarVkosLk4tUbKqVipLLSrOzM9TslIy0jNQqq1VGAWDCgAAUEsDBBQAAAgIADF3Nl0RwfGLCQAAAMwAAAAeAAAA66qo7ZiVL3RleHR1cmVzL3dvb2QgZmxvb3IucG5n6wzwc2cYJgAAUEsDBBQAAAgIADF3Nl3Y98BGEQAAAMIBAAAXAAAA66qo7ZiVL+ydveyWtOuztOq4sC50eHR7taHhddOM191LXo0yhiYDAFBLAwQUAAAICAAxdzZdAAAAAAIAAAAAAAAAEQAAAOuqqO2YlS/ruYjtj7TrjZQvAwBQSwECFAMUAAAICAAxdzZd90VmOCIAAACrAQAAEQAAAAAAAAAAAAAAgAEAAAAA66qo7ZiVL3NjZW5lLmdsdGZQSwECFAMUAAAICAAxdzZdEcHxiwkAAADMAAAAHgAAAAAAAAAAAAAAgAFRAAAA66qo7ZiVL3RleHR1cmVzL3dvb2QgZmxvb3IucG5nUEsBAhQDFAAACAgAMXc2Xdj3wEYRAAAAwgEAABcAAAAAAAAAAAAAAIABlgAAAOuqqO2YlS/snb3slrTrs7TquLAudHh0UEsBAhQDFAAACAgAMXc2XQAAAAACAAAAAAAAABEAAAAAAAAAAAAQAP1B3AAAAOuqqO2YlS/ruYjtj7TrjZQvUEsFBgAAAAAEAAQADwEAAA0BAAAAAA=='
const CP949 =
  'UEsDBBQAAAAAAAAAAAB7B5cKCAAAAAgAAAAPAAAAx6UvsO2wtLmuwMcuY3N2YSxiCjEsMgpQSwMEFAAAAAAAAAAAAJ+uX/IFAAAABQAAAA4AAADHpS/A0L7uurix4i5tZCMgaGkKUEsBAhQAFAAAAAAAAAAAAHsHlwoIAAAACAAAAA8AAAAAAAAAAAAAAAAAAAAAAMelL7DtsLS5rsDHLmNzdlBLAQIUABQAAAAAAAAAAACfrl/yBQAAAAUAAAAOAAAAAAAAAAAAAAAAADUAAADHpS/A0L7uurix4i5tZFBLBQYAAAAAAgACAHkAAABmAAAAAAA='

function zipNamed(name: string, base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  return {
    name,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}

/*
 * 가장자리(가짜 크기, ZIP64 표시, 지역 머리말에만 붙은 덧붙임)는 바깥 도구로 만들기
 * 어려워서 여기서 짜 넣는다. 형식 자체는 위의 바깥 zip들이 이미 못박고 있다.
 */
type Member = {
  path: string
  body: Buffer
  deflate?: boolean
  declaredSize?: number
  localExtra?: number
  /** deflate라고 적어 놓고 눌린 조각 자리에 쓰레기를 넣는다. */
  brokenPiece?: boolean
}

function zipOf(
  name: string,
  members: readonly Member[],
  options: { zip64?: boolean; comment?: string } = {},
) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const member of members) {
    const raw = Buffer.from(member.path, 'utf8')
    const piece =
      member.brokenPiece === true
        ? Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
        : member.deflate === true
          ? deflateRawSync(member.body)
          : member.body

    const size = member.declaredSize ?? member.body.length
    const extra = Buffer.alloc(member.localExtra ?? 0)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(0x800, 6)
    head.writeUInt16LE(member.deflate === true ? 8 : 0, 8)
    head.writeUInt32LE(piece.length, 18)
    head.writeUInt32LE(size, 22)
    head.writeUInt16LE(raw.length, 26)
    head.writeUInt16LE(extra.length, 28)
    locals.push(head, raw, extra, piece)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(member.deflate === true ? 8 : 0, 10)
    central.writeUInt32LE(piece.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(raw.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, raw)
    offset += head.length + raw.length + extra.length + piece.length
  }

  const local = Buffer.concat(locals)
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(options.zip64 === true ? 0xffff : members.length, 8)
  end.writeUInt16LE(options.zip64 === true ? 0xffff : members.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(local.length, 16)
  const comment = Buffer.from(options.comment ?? '', 'utf8')
  end.writeUInt16LE(comment.length, 20)
  const bytes = Buffer.concat([local, directory, end, comment])

  return {
    name,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}

const textOf = async (buffer: ArrayBuffer) => new TextDecoder().decode(buffer)

describe('entriesOfZip — 바깥에서 만든 zip', () => {
  it('경로를 그대로 내고 폴더 항목은 버린다', async () => {
    const entries = await entriesOfZip(zipNamed('모형.zip', REAL))
    expect(entries.map(([path]) => path)).toEqual([
      '모형/scene.gltf',
      '모형/textures/wood floor.png',
      '모형/읽어보기.txt',
    ])
  })

  it('deflate로 눌린 내용을 풀어 준다', async () => {
    const entries = await entriesOfZip(zipNamed('모형.zip', REAL))
    const gltf = entries.find(([path]) => path.endsWith('.gltf'))?.[1]
    expect(await textOf(await gltf!.arrayBuffer())).toContain('"version":"2.0"')
    const note = entries.find(([path]) => path.endsWith('.txt'))?.[1]
    expect(await textOf(await note!.arrayBuffer())).toBe('가나다'.repeat(50))
  })

  it('크기는 목차에 적힌 푼 뒤의 크기다 — 눌린 크기가 아니다', async () => {
    const entries = await entriesOfZip(zipNamed('모형.zip', REAL))
    const note = entries.find(([path]) => path.endsWith('.txt'))?.[1]
    expect(note?.size).toBe(new TextEncoder().encode('가나다'.repeat(50)).byteLength)
  })

  /*
   * 윈도 탐색기로 압축하면 한글 이름이 CP949로 들어가고 UTF-8 깃발이 서지 않는다.
   * UTF-8로만 읽으면 이름이 통째로 깨져서, 사람이 자기 파일을 알아보지 못한다.
   */
  it('UTF-8 깃발이 없는 한글 이름을 EUC-KR로 읽는다', async () => {
    const entries = await entriesOfZip(zipNamed('표.zip', CP949))
    expect(entries.map(([path]) => path)).toEqual(['표/고객문의.csv', '표/읽어보기.md'])
    expect(await textOf(await entries[0]![1].arrayBuffer())).toBe('a,b\n1,2\n')
  })

  it('묶음으로 넘기면 모델을 고른다 — zip 하나가 폴더 하나와 같아진다', async () => {
    const bundle = bundleOf('모형.zip', await entriesOfZip(zipNamed('모형.zip', REAL)))
    expect(pickPrimary(bundle)?.path).toBe('모형/scene.gltf')
  })
})

describe('entriesOfZip — 가장자리', () => {
  /*
   * 중앙 목록의 오프셋은 지역 머리말을 가리키고, 내용은 이름과 **지역 머리말 쪽**
   * 덧붙임 뒤다. 덧붙임은 한쪽에만 붙을 수 있어서, 중앙 목록 값으로 건너뛰면 여기서
   * 여섯 바이트가 어긋나 해제가 통째로 실패한다.
   */
  it('내용 자리를 지역 머리말에서 다시 읽는다', async () => {
    const body = Buffer.from('덧붙임 뒤에 내용이 온다')
    const zip = zipOf('한개.zip', [{ path: 'a.txt', body, deflate: true, localExtra: 6 }])
    const [entry] = await entriesOfZip(zip)
    expect(await textOf(await entry![1].arrayBuffer())).toBe('덧붙임 뒤에 내용이 온다')
  })

  /*
   * zip의 목차는 맨 끝이 아니라 **주석 앞**에 있다. 끝에서 22바이트만 보면 주석이
   * 붙은 zip은 통째로 "zip이 아닙니다"가 된다. 압축 도구들이 서명이나 안내를 여기에
   * 적어 두는 일이 흔하다.
   */
  it('끝에 주석이 붙은 zip도 목차를 찾아낸다', async () => {
    const zip = zipOf('주석.zip', [{ path: 'a.txt', body: Buffer.from('내용') }], {
      comment: '이 압축은 무엇무엇 도구가 만들었습니다'.repeat(20),
    })
    const [entry] = await entriesOfZip(zip)
    expect(entry?.[0]).toBe('a.txt')
    expect(await textOf(await entry![1].arrayBuffer())).toBe('내용')
  })

  it('누르지 않고 담은 항목도 읽는다', async () => {
    const zip = zipOf('한개.zip', [{ path: 'a.txt', body: Buffer.from('그대로') }])
    const [entry] = await entriesOfZip(zip)
    expect(await textOf(await entry![1].arrayBuffer())).toBe('그대로')
  })

  /*
   * 폭탄은 첫 항목을 푸는 순간 이미 늦다. 목차에 적힌 합으로 막는지 보려고 내용은
   * 몇 바이트만 담고 푼 뒤의 크기만 크게 적어 둔다 — 실제 폭탄이 딱 이 모양이다.
   */
  it('풀면 커지는 zip은 한 바이트도 풀기 전에 막는다', async () => {
    const zip = zipOf('폭탄.zip', [
      { path: 'a.bin', body: Buffer.alloc(64), declaredSize: 900 * 1024 * 1024 },
    ])
    await expect(entriesOfZip(zip)).rejects.toThrow(UnsupportedFileError)
    await expect(entriesOfZip(zip)).rejects.toThrow(/풀면/)
  })

  it('ZIP64는 못 연다고 말하고 무엇을 하면 되는지 알려 준다', async () => {
    const zip = zipOf('큰것.zip', [{ path: 'a.txt', body: Buffer.from('x') }], { zip64: true })
    await expect(entriesOfZip(zip)).rejects.toThrow(/폴더째/)
  })

  it('zip이 아니거나 비어 있으면 까닭을 말한다', async () => {
    const notZip = zipNamed(
      '가짜.zip',
      Buffer.from('이건 zip이 아니다'.repeat(4)).toString('base64'),
    )
    await expect(entriesOfZip(notZip)).rejects.toThrow(UnsupportedFileError)
    const empty = zipNamed('빈것.zip', '')
    await expect(entriesOfZip(empty)).rejects.toThrow(UnsupportedFileError)
  })

  it('열 수 있는 항목이 하나도 없으면 까닭을 말한다', async () => {
    await expect(entriesOfZip(zipOf('빈것.zip', []))).rejects.toThrow(/찾지 못했습니다/)
  })

  /*
   * 푸는 일을 미루지 않으면 여는 순간 zip 전체가 메모리에 풀린다. 한 항목이 깨진
   * zip에서 나머지가 멀쩡히 나오는 것이 미뤘다는 증거다 — 미리 풀었다면 여기서 터진다.
   */
  it('푸는 일을 미룬다 — 깨진 항목이 여는 일을 막지 않는다', async () => {
    const entries = await entriesOfZip(
      zipOf('섞임.zip', [
        { path: 'a.txt', body: Buffer.from('성한 것'), deflate: true },
        { path: 'b.txt', body: Buffer.from('깨진 것'), deflate: true, brokenPiece: true },
      ]),
    )
    // 여는 데 성공했다는 것 자체가 증거다. 미리 풀었다면 여기까지 오지 못한다.
    expect(entries).toHaveLength(2)
    expect(await textOf(await entries[0]![1].arrayBuffer())).toBe('성한 것')
    await expect(entries[1]![1].arrayBuffer()).rejects.toThrow()
  })
})

describe('looksLikeZip', () => {
  it('확장자만 본다', () => {
    expect(looksLikeZip('모형.zip')).toBe(true)
    expect(looksLikeZip('모형.ZIP')).toBe(true)
    expect(looksLikeZip('모형.gltf')).toBe(false)
  })
})
