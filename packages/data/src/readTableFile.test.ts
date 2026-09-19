import { describe, expect, it } from 'vitest'
import {
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

  it('모르는 확장자는 받는 형식을 알려 준다', async () => {
    await expect(readTableFile(fileOf('사진.png', ''))).rejects.toThrow(/CSV, TSV, JSON/)
  })

  it('컬럼을 못 찾으면 첫 줄을 확인하라고 한다', async () => {
    await expect(readTableFile(fileOf('빈.csv', ''))).rejects.toThrow(/첫 줄/)
  })
})
