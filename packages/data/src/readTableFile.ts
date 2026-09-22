/**
 * 파일 하나를 표 데이터 자산으로 읽는다 — M1의 바깥쪽 입구.
 *
 * 확장자로 경로를 고르고, 어느 경로로 들어왔든 `LoadedTable` 하나로 맞춰서 돌려준다.
 * 읽지 못하는 형식은 추측해서 열지 않고 무엇이 필요한지 말한다. 설계 문서 6장의
 * "해석 오류를 이해할 수 있는 메시지로" 원칙이 여기에도 걸린다.
 */

import { assetIdOfFile, type FileIdentity } from './assetId'
import { extensionOf, plannedMessage, supportedLabels } from './formats'
import { buildTable, type BuildOptions, type LoadNotice, type LoadedTable } from './loadTable'
import { loadDelimitedText } from './loadTable'
import { splitLines } from './readTextFile'
import { looksLikeLog, looksLikeMarkdown } from './textFlavor'
import { PreferTextError, UnsupportedFileError } from './unsupported'
import { vectorFromLists, type VectorColumn } from './vectorColumn'

export { PreferTextError, UnsupportedFileError }

/** JSON 한 덩어리에서 행 배열을 꺼낸다. 흔한 감싼 모양 두어 개까지만 받는다. */
function rowsOfJson(parsed: unknown): Record<string, unknown>[] {
  const candidate = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? ((parsed as Record<string, unknown>)['data'] ??
        (parsed as Record<string, unknown>)['rows'] ??
        (parsed as Record<string, unknown>)['records'])
      : undefined
  if (!Array.isArray(candidate)) return []
  return candidate.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  )
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number')
}

/** JSON 값을 판별기가 보는 문자열로 바꾼다. 객체는 표에 그대로 보여 준다. */
function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * 객체 배열을 자산으로 만든다. 값이 숫자 배열인 컬럼은 네이티브 리스트로 보고
 * 문자열을 거치지 않고 바로 벡터로 정규화한다.
 */
export function loadRecords(
  records: readonly Record<string, unknown>[],
  options: BuildOptions = {},
): LoadedTable {
  const names: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue
      seen.add(key)
      names.push(key)
    }
  }

  const vectorNames = names.filter((name) => records.some((record) => isNumberList(record[name])))
  const vectors: VectorColumn[] = vectorNames.map((name) =>
    vectorFromLists(
      name,
      records.map((record) => (isNumberList(record[name]) ? record[name] : null)),
    ),
  )

  const scalarNames = names.filter((name) => !vectorNames.includes(name))
  const columns = scalarNames.map((name) => records.map((record) => cellText(record[name])))

  const table = buildTable(scalarNames, columns, records.length, {
    ...options,
    nativeVectors: [...(options.nativeVectors ?? []), ...vectors],
  })

  if (vectors.length === 0) return table
  const notices: LoadNotice[] = [
    ...table.notices,
    ...vectors.map((vector) => ({
      level: 'info' as const,
      column: vector.name,
      message:
        vector.missingCount === 0
          ? `'${vector.name}' 컬럼을 ${vector.dimension}차원 임베딩으로 읽었습니다.`
          : `'${vector.name}' 컬럼을 ${vector.dimension}차원 임베딩으로 읽었습니다. 길이가 다르거나 비어 있는 행 ${vector.missingCount}개는 좌표 없음으로 두었습니다.`,
    })),
  ]
  return { ...table, notices }
}

/** JSON Lines — 한 줄에 객체 하나. 빈 줄은 건너뛴다. */
export function loadJsonLines(text: string, options: BuildOptions = {}): LoadedTable {
  const records: Record<string, unknown>[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new UnsupportedFileError('', `${index + 1}번째 줄을 JSON으로 읽지 못했습니다.`)
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      records.push(parsed as Record<string, unknown>)
    }
  }
  return loadRecords(records, options)
}

export function loadJson(text: string, options: BuildOptions = {}): LoadedTable {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new UnsupportedFileError('', 'JSON으로 읽지 못했습니다. 파일이 온전한지 확인해 주세요.')
  }
  const records = rowsOfJson(parsed)
  if (records.length === 0) {
    // 깊게 중첩된 JSON은 표가 아니라 텍스트 패널의 몫이다(설계 문서 6장).
    throw new PreferTextError(
      '',
      '표로 읽을 행을 찾지 못해 글자로 펼쳐 보여 줍니다. 표로 보려면 객체 배열이거나, data·rows·records 안에 객체 배열이어야 합니다.',
    )
  }
  return loadRecords(records, options)
}

/** 확장자가 표인지 글인지 못 박지 않는 것들. 이때만 내용을 보고 갈래를 바꾼다. */
function isAmbiguous(extension: string): boolean {
  return extension === 'txt' || extension === ''
}

/**
 * 표로 읽으려던 파일을 텍스트 패널로 넘길지.
 *
 * `.csv`와 `.tsv`는 사람이 표라고 적어 둔 것이므로 내용을 보지 않는다. 판별을 흔드는
 * 것은 `.txt`와 확장자 없는 파일뿐이고, 이 둘은 로그로 오는 일이 표로 오는 일만큼
 * 흔하다.
 */
export function prefersTextPanel(extension: string, text: string): boolean {
  if (!isAmbiguous(extension)) return false
  const lines = splitLines(text)
  return looksLikeLog(lines) || looksLikeMarkdown(lines)
}

/** 브라우저의 File을 그대로 받는다. 텍스트를 읽는 일만 밖에서 시킨다. */
export type ReadableFile = FileIdentity & {
  text(): Promise<string>
}

export async function readTableFile(
  file: ReadableFile,
  options: BuildOptions = {},
): Promise<LoadedTable> {
  const extension = extensionOf(file.name)
  // 아직 못 읽는 형식은 추측해서 열지 않고 무엇이 필요한지 말한다(형식 표가 문구를 쥔다).
  const planned = plannedMessage(file.name)
  if (planned !== null) throw new UnsupportedFileError(file.name, planned)

  // 파일에서 뽑은 id를 아래로 내려 보낸다. 같은 파일을 다시 열면 같은 값이 나온다.
  const withId: BuildOptions = { ...options, assetId: assetIdOfFile(file) }

  if (extension === 'json') {
    try {
      return loadJson(await file.text(), withId)
    } catch (error) {
      if (error instanceof PreferTextError) throw new PreferTextError(file.name, error.message)
      throw new UnsupportedFileError(
        file.name,
        error instanceof UnsupportedFileError ? error.message : 'JSON으로 읽지 못했습니다.',
      )
    }
  }
  if (extension === 'jsonl' || extension === 'ndjson') {
    try {
      return loadJsonLines(await file.text(), withId)
    } catch (error) {
      throw new UnsupportedFileError(
        file.name,
        error instanceof UnsupportedFileError ? error.message : 'JSON Lines로 읽지 못했습니다.',
      )
    }
  }
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt' || extension === '') {
    const text = await file.text()
    if (prefersTextPanel(extension, text)) {
      throw new PreferTextError(file.name, '표가 아니라 글자로 보입니다. 텍스트 패널로 엽니다.')
    }

    const table = loadDelimitedText(text, withId)
    if (table.columns.length === 0 && table.vectors.length === 0) {
      throw new PreferTextError(
        file.name,
        '읽을 컬럼을 찾지 못해 글자로 펼쳐 보여 줍니다. 표로 보려면 첫 줄이 컬럼 이름이어야 합니다.',
      )
    }
    /*
     * 컬럼이 하나뿐인 `.txt`는 표가 아니라 글이다. 구분자가 없는 산문을 구분자 파서에
     * 넣으면 언제나 한 컬럼짜리 표가 나오는데, 그 표는 첫 줄이 컬럼 이름으로 올라가
     * 있어서 원본보다 읽기 나쁘다. `.csv`는 한 컬럼도 뜻이 있으므로 건드리지 않는다.
     */
    if (table.columns.length === 1 && table.vectors.length === 0 && isAmbiguous(extension)) {
      throw new PreferTextError(file.name, '컬럼이 하나뿐이라 글자로 펼쳐 보여 줍니다.')
    }
    return table
  }

  throw new UnsupportedFileError(
    file.name,
    `.${extension} 파일은 표로 읽지 못합니다. ${supportedLabels().join(', ')}을(를) 받습니다.`,
  )
}
