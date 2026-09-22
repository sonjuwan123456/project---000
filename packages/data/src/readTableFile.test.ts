import { describe, expect, it } from 'vitest'
import {
  PreferTextError,
  UnsupportedFileError,
  loadJson,
  loadJsonLines,
  loadRecords,
  readTableFile,
} from './readTableFile'

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
