import { describe, expect, it } from 'vitest'
import {
  PreferTextError,
  UnsupportedFileError,
  loadJson,
  loadJsonLines,
  loadRecords,
  readTableFile,
} from './readTableFile'
import type { LoadedColumn } from './loadTable'

function fileOf(name: string, text: string) {
  return { name, text: () => Promise.resolve(text) }
}

describe('loadRecords', () => {
  it('숫자 배열 컬럼은 문자열을 거치지 않고 바로 벡터가 된다', () => {
    const table = loadRecords([
      { id: 1, embedding: [0.1, 0.2, 0.3] },
      { id: 2, embedding: [0.4, 0.5, 0.6] },
    ])
    expect(table.vectors).toHaveLength(1)
    expect(table.vectors[0]?.dimension).toBe(3)
    expect(table.columns.map((column) => column.name)).toEqual(['id'])
  })

  it('길이가 다른 벡터 행은 좌표 없음으로 두고 개수를 알린다', () => {
    const table = loadRecords([
      { embedding: [0.1, 0.2] },
      { embedding: [0.3] },
      { embedding: null },
    ])
    expect(table.vectors[0]?.missingCount).toBe(2)
    expect(table.notices.some((notice) => notice.message.includes('좌표 없음'))).toBe(true)
  })

  it('행마다 키가 달라도 모두 컬럼으로 잡는다', () => {
    const table = loadRecords([{ a: 1 }, { b: 2 }])
    expect(table.columns.map((column) => column.name)).toEqual(['a', 'b'])
    expect(table.rowCount).toBe(2)
  })

  it('중첩된 객체는 표에 보이도록 문자열로 접어 둔다', () => {
    // 접은 뒤에는 다른 짧은 문자열과 똑같이 취급된다 — 여기서는 값이 적어 범주로 간다.
    const table = loadRecords([{ meta: { source: '웹' } }, { meta: { source: '앱' } }])
    const column = table.columns[0]
    expect(column?.kind).toBe('category')
    if (column?.kind !== 'category') return
    expect(column.categories).toContain('{"source":"웹"}')
  })
})

describe('loadJson', () => {
  it('객체 배열을 읽는다', () => {
    expect(loadJson('[{"a":1},{"a":2}]').rowCount).toBe(2)
  })

  it('data·rows·records로 감싼 모양도 읽는다', () => {
    expect(loadJson('{"data":[{"a":1}]}').rowCount).toBe(1)
    expect(loadJson('{"rows":[{"a":1},{"a":2}]}').rowCount).toBe(2)
  })

  it('행을 못 찾으면 무엇이 필요한지 말한다', () => {
    expect(() => loadJson('{"a":1}')).toThrow(UnsupportedFileError)
    expect(() => loadJson('{"a":1}')).toThrow(/객체 배열/)
  })

  it('깨진 JSON은 조용히 넘어가지 않는다', () => {
    expect(() => loadJson('[{"a":1},')).toThrow(UnsupportedFileError)
  })
})

describe('loadJsonLines', () => {
  it('한 줄에 객체 하나를 읽고 빈 줄은 건너뛴다', () => {
    const table = loadJsonLines('{"a":1}\n\n{"a":2}\n')
    expect(table.rowCount).toBe(2)
  })

  it('깨진 줄은 몇 번째인지 알린다', () => {
    expect(() => loadJsonLines('{"a":1}\n{a:2}\n')).toThrow(/2번째 줄/)
  })
})

describe('readTableFile', () => {
  it('확장자로 경로를 고른다', async () => {
    const csv = await readTableFile(fileOf('문의.csv', '분류,점수\n배송,4\n'))
    expect(csv.columns.map((column) => column.name)).toEqual(['분류', '점수'])

    const tsv = await readTableFile(fileOf('문의.tsv', '분류\t점수\n배송\t4\n'))
    expect(tsv.columns).toHaveLength(2)

    const jsonl = await readTableFile(fileOf('문의.jsonl', '{"분류":"배송"}\n'))
    expect(jsonl.rowCount).toBe(1)
  })

  it('아직 못 읽는 형식은 추측하지 않고 대안을 말한다', async () => {
    await expect(readTableFile(fileOf('표.xlsx', ''))).rejects.toThrow(/CSV로 내보내/)
    await expect(readTableFile(fileOf('표.parquet', ''))).rejects.toThrow(UnsupportedFileError)
  })

  it('등록은 되어 있지만 아직 뷰가 없는 형식은 그 사실을 말한다', async () => {
    // 이미지는 형식 표에 있고 M4가 채울 자리다. "표로 못 읽는다"보다 이 말이 맞다.
    await expect(readTableFile(fileOf('사진.png', ''))).rejects.toThrow(/이미지 패널은 아직/)
  })

  it('형식 표에 아예 없는 확장자는 받는 형식을 알려 준다', async () => {
    await expect(readTableFile(fileOf('무엇.zzz', ''))).rejects.toThrow(/CSV·TSV, JSON/)
  })

  it('컬럼을 못 찾으면 첫 줄을 확인하라고 한다', async () => {
    await expect(readTableFile(fileOf('빈.csv', ''))).rejects.toThrow(/첫 줄/)
  })
})

/*
 * 표로 읽으려다 글이었던 경우. 예전에는 "읽지 못합니다"로 끝났고, 사람은 파일이
 * 멀쩡한데도 아무것도 못 봤다. 이제 텍스트 패널로 넘긴다.
 */
describe('표가 아닐 때 텍스트로 넘기기', () => {
  const LOG = `2026-09-20 12:01:30 [INFO] 서버 시작
2026-09-20 12:01:31 [INFO] 포트 대기
2026-09-20 12:01:35 [ERROR] 연결 실패
2026-09-20 12:01:36 [WARN] 재시도
2026-09-20 12:01:40 [INFO] 연결됨
`

  it('.txt로 온 로그는 표로 읽지 않는다', async () => {
    await expect(readTableFile(fileOf('출력.txt', LOG))).rejects.toBeInstanceOf(PreferTextError)
  })

  it('.csv라고 적힌 것은 내용을 보고 뒤집지 않는다', async () => {
    // 사람이 표라고 이름 붙인 것을 내용으로 뒤집으면, 로그 모양 CSV가 열리지 않는다.
    const table = await readTableFile(
      fileOf(
        '로그.csv',
        `시각,레벨,메시지
2026-09-20 12:01:35,ERROR,연결 실패
2026-09-20 12:01:36,WARN,재시도
`,
      ),
    )
    expect(table.columns.map((column) => column.name)).toEqual(['시각', '레벨', '메시지'])
  })

  it('컬럼이 하나뿐인 .txt는 글로 본다', async () => {
    await expect(
      readTableFile(fileOf('메모.txt', '오늘 할 일\n장 보기\n빨래\n')),
    ).rejects.toBeInstanceOf(PreferTextError)
  })

  it('컬럼이 하나뿐이어도 .csv는 표로 둔다', async () => {
    const table = await readTableFile(fileOf('값.csv', '값\n1\n2\n3\n'))
    expect(table.rowCount).toBe(3)
  })

  it('객체 배열이 아닌 JSON은 글로 본다', async () => {
    // 설계 문서 6장: 깊게 중첩된 JSON은 트리 모양 텍스트 패널의 몫이다.
    await expect(
      readTableFile(fileOf('설정.json', '{"server":{"port":8080,"tls":{"on":true}}}')),
    ).rejects.toBeInstanceOf(PreferTextError)
  })

  it('망가진 JSON은 글로 넘기지 않고 오류로 말한다', async () => {
    // 이쪽은 진짜 실패다. 글자로 펼쳐 봐야 사람이 할 일이 없다.
    const error = await readTableFile(fileOf('깨진.json', '{"a": ')).catch((one: unknown) => one)
    expect(error).toBeInstanceOf(UnsupportedFileError)
    expect(error).not.toBeInstanceOf(PreferTextError)
  })

  it('넘길 때도 파일 이름을 달고 간다', async () => {
    const error = await readTableFile(fileOf('출력.txt', LOG)).catch((one: unknown) => one)
    expect((error as PreferTextError).fileName).toBe('출력.txt')
  })
})

const MB = 1024 * 1024

/** 크기만 크다고 말하는 파일. 400MB짜리 문자열을 실제로 만들 수는 없다. */
function sizedFile(name: string, size: number, text: string) {
  return { name, size, lastModified: 1, text: () => Promise.resolve(text) }
}

describe('readTableFile 크기 안전장치', () => {
  it('거부선을 넘는 표는 읽지 않고 까닭을 말한다', async () => {
    await expect(readTableFile(sizedFile('아주큰표.csv', 500 * MB, 'a,b\n1,2'))).rejects.toThrow(
      UnsupportedFileError,
    )
  })

  it('막은 까닭에 파일 크기와 한계가 함께 나온다', async () => {
    await expect(
      readTableFile(sizedFile('아주큰표.csv', 500 * MB, 'a,b\n1,2')),
    ).rejects.toThrowError(/500MB[\s\S]*400MB/)
  })

  it('파일을 열어 보기도 전에 막는다 — 여는 일 자체가 탭을 죽인다', async () => {
    let opened = false
    const file = {
      name: '아주큰표.csv',
      size: 500 * MB,
      text: () => {
        opened = true
        return Promise.resolve('a,b\n1,2')
      },
    }
    await expect(readTableFile(file)).rejects.toThrow(UnsupportedFileError)
    expect(opened).toBe(false)
  })

  it('표인지 글인지 모르는 큰 파일은 막지 않고 글자로 보낸다', async () => {
    await expect(readTableFile(sizedFile('거대한.txt', 500 * MB, '아무 글'))).rejects.toThrow(
      PreferTextError,
    )
  })

  it('경고선을 넘으면 열되 무겁다는 말을 안내 맨 앞에 얹는다', async () => {
    const table = await readTableFile(sizedFile('제법큰표.csv', 200 * MB, 'a,b\n1,2'))
    expect(table.rowCount).toBe(1)
    expect(table.notices[0]?.level).toBe('warning')
    expect(table.notices[0]?.message).toContain('200MB')
  })

  it('JSON 경로도 같은 말을 얹는다 — 안전장치가 확장자마다 다르면 안 된다', async () => {
    const table = await readTableFile(sizedFile('제법큰표.json', 200 * MB, '[{"a":1}]'))
    expect(table.notices[0]?.message).toContain('200MB')
  })

  it('경고선 아래면 크기 이야기를 꺼내지 않는다', async () => {
    const table = await readTableFile(sizedFile('보통표.csv', 7 * MB, 'a,b\n1,2'))
    expect(table.notices.some((notice) => notice.message.includes('MB'))).toBe(false)
  })
})

/*
 * 바이트로 주는 파일. 브라우저의 File이 이 모양이다 — 위의 `fileOf`는 `text()`만 있는
 * 옛 모양이라 UTF-8 말고는 표현할 수가 없고, 인코딩 이야기는 여기서만 할 수 있다.
 */
/** 첫 칸의 글자. 값이 적은 컬럼은 범주로 접히므로 둘 다 본다. */
function firstText(column: LoadedColumn | undefined): string | null | undefined {
  if (column?.kind === 'text') return column.values[0]
  if (column?.kind === 'category') return column.categories[0]
  return undefined
}

function bytesOf(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}

describe('readTableFile · 인코딩', () => {
  /*
   * 한국에서 오는 CSV는 EUC-KR인 일이 흔하다. `File.text()`는 무조건 UTF-8로 풀어서
   * 이런 파일이 통째로 깨진 글자가 되는데, 오류가 나지 않으므로 화면에는 멀쩡한 표에
   * 알아볼 수 없는 글자가 찬 모양으로 뜬다. 설계 문서 9장 M1의 완료 기준이다.
   */
  it('EUC-KR로 적힌 CSV를 알아본다', async () => {
    const cp949 = new Uint8Array([
      // "이름,분류\n홍길동,환불" 을 CP949로 적은 것
      0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xba, 0xd0, 0xb7, 0xf9, 0x0a, 0xc8, 0xab, 0xb1, 0xe6, 0xb5,
      0xbf, 0x2c, 0xc8, 0xaf, 0xba, 0xd2,
    ])
    const table = await readTableFile(bytesOf('고객.csv', cp949))
    expect(table.columns.map((column) => column.name)).toEqual(['이름', '분류'])
    expect(firstText(table.columns[0])).toBe('홍길동')
  })

  it('EUC-KR로 읽었으면 그렇다고 말한다 — 빗나갔을 때 사람이 알아채야 한다', async () => {
    const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7, 0x0a, 0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf])
    const table = await readTableFile(bytesOf('고객.csv', cp949))
    expect(
      table.notices.some((one) => one.level === 'warning' && one.message.includes('EUC-KR')),
    ).toBe(true)
  })

  /*
   * 엑셀이 내보낸 CSV에는 BOM이 붙는다. `text()`로 읽으면 그 세 바이트가 글자로 남아
   * 첫 컬럼 이름이 보이지 않는 글자로 시작하고, 이름으로 찾아도 걸리지 않는다.
   */
  it('BOM을 떼어 낸다 — 첫 컬럼 이름에 묻어 들어가면 찾지 못한다', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('id,값\n1,2')])
    const table = await readTableFile(bytesOf('엑셀.csv', withBom))
    expect(table.columns.map((column) => column.name)).toEqual(['id', '값'])
  })

  it('UTF-8이면 아무 말도 하지 않는다', async () => {
    const utf8 = new TextEncoder().encode('이름,분류\n홍길동,환불')
    const table = await readTableFile(bytesOf('고객.csv', utf8))
    expect(firstText(table.columns[0])).toBe('홍길동')

    expect(table.notices.filter((one) => one.level === 'warning')).toEqual([])
  })

  it('바이트를 못 주는 파일은 글자로 물러선다', async () => {
    const table = await readTableFile(fileOf('고객.csv', '이름,분류\n홍길동,환불'))
    expect(firstText(table.columns[0])).toBe('홍길동')
  })
})
