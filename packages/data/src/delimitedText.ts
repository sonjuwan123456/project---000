/**
 * CSV·TSV 파서.
 *
 * 따옴표 안의 구분자와 줄바꿈까지 처리한다(RFC 4180). 값은 문자열 그대로 두고,
 * 종류 판별은 `columnType`이 따로 한다 — 파싱과 해석을 섞으면 "숫자로 보여서 숫자로 읽었다"가
 * 어디서 일어났는지 알 수 없게 된다.
 */

export type DelimitedTable = {
  readonly header: readonly string[]
  /** 컬럼별 문자열 값. 짧은 행은 `null`로 채워 길이를 맞춘다. */
  readonly columns: readonly (readonly (string | null)[])[]
  readonly rowCount: number
  /** 헤더보다 칸이 많았던 행 번호. 넘친 값은 버리지 않고 여기 알린다. */
  readonly overflowRows: readonly number[]
  /**
   * 헤더보다 칸이 적었던 행 번호. 모자란 칸은 빈 값이 된다.
   *
   * 넘친 것과 따로 세는 까닭은 사람이 할 일이 다르기 때문이다. 넘친 행은 값이 잘린
   * 것이고, 모자란 행은 값이 비는 것이다. 통째로 빈 줄은 세지 않는다 — 파일 끝의
   * 빈 줄까지 세면 멀쩡한 파일마다 경고가 뜬다.
   */
  readonly shortRows: readonly number[]
  /**
   * 따옴표가 열린 채 파일이 끝났는지.
   *
   * 이것이 참이면 그 뒤의 줄바꿈과 구분자가 전부 값 안으로 빨려 들어간 것이다. 파일
   * 절반이 한 칸이 되어 버리는데, 파서는 오류를 내지 않으므로 말해 주지 않으면 사람은
   * 자기 행이 어디로 갔는지 알 길이 없다.
   */
  readonly unterminatedQuote: boolean
}

const QUOTE = '"'

/** 헤더 줄에서 구분자를 고른다. 탭이 쉼표보다 많으면 TSV다. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  let comma = 0
  let tab = 0
  let semicolon = 0
  let inQuotes = false
  for (const char of firstLine) {
    if (char === QUOTE) inQuotes = !inQuotes
    else if (inQuotes) continue
    else if (char === ',') comma += 1
    else if (char === '\t') tab += 1
    else if (char === ';') semicolon += 1
  }
  if (tab > comma && tab >= semicolon) return '\t'
  if (semicolon > comma) return ';'
  return ','
}

/**
 * 읽은 글자 수를 알리는 간격.
 *
 * 글자마다 알리면 알리는 값이 파싱보다 커진다. 64K마다면 7MB짜리 파일에서 백 번쯤이고,
 * 그 정도면 막대가 끊겨 보이지 않으면서 값도 눈에 안 띈다.
 */
const SCAN_STEP = 64 * 1024

/** 한 줄씩이 아니라 글자 단위로 읽는다. 따옴표 안의 줄바꿈 때문에 줄 단위로는 못 쪼갠다. */
function splitRows(
  text: string,
  delimiter: string,
  onScan?: (read: number) => void,
): { rows: string[][]; unterminatedQuote: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let touched = false

  const endField = () => {
    row.push(field)
    field = ''
    touched = true
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    touched = false
  }

  for (let index = 0; index < text.length; index += 1) {
    if (onScan !== undefined && index % SCAN_STEP === 0) onScan(index)
    const char = text[index]
    if (inQuotes) {
      if (char === QUOTE) {
        if (text[index + 1] === QUOTE) {
          field += QUOTE
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === QUOTE && field === '') {
      inQuotes = true
      touched = true
      continue
    }
    if (char === delimiter) {
      endField()
      continue
    }
    if (char === '\n') {
      endRow()
      continue
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1
      endRow()
      continue
    }
    field += char
    touched = true
  }
  // 마지막 줄에 줄바꿈이 없을 수 있다. 빈 꼬리는 행으로 세지 않는다.
  if (touched || field !== '') endRow()
  return { rows, unterminatedQuote: inQuotes }
}

export function parseDelimitedText(
  text: string,
  delimiter?: string,
  /** 읽은 글자 수를 알린다. 전체 글자 수는 부르는 쪽이 이미 안다. */
  onScan?: (read: number) => void,
): DelimitedTable {
  // 엑셀이 붙이는 BOM을 떼지 않으면 첫 컬럼 이름이 보이지 않는 글자로 시작한다.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const separator = delimiter ?? detectDelimiter(body)
  const { rows, unterminatedQuote } = splitRows(body, separator, onScan)

  const headerRow = rows[0] ?? []
  const header = headerRow.map((name, index) => {
    const trimmed = name.trim()
    return trimmed === '' ? `컬럼 ${index + 1}` : trimmed
  })

  const rowCount = Math.max(0, rows.length - 1)
  const columns: (string | null)[][] = header.map(() =>
    new Array<string | null>(rowCount).fill(null),
  )
  const overflowRows: number[] = []
  const shortRows: number[] = []

  for (let row = 0; row < rowCount; row += 1) {
    const cells = rows[row + 1] ?? []
    if (cells.length > header.length) overflowRows.push(row)
    // 통째로 빈 줄은 모자란 것이 아니라 없는 줄이다.
    else if (cells.length < header.length && cells.some((cell) => cell !== '')) shortRows.push(row)

    for (let column = 0; column < header.length; column += 1) {
      const cell = cells[column]
      const target = columns[column]
      if (target === undefined) continue
      target[row] = cell === undefined || cell === '' ? null : cell
    }
  }

  return { header, columns, rowCount, overflowRows, shortRows, unterminatedQuote }
}
