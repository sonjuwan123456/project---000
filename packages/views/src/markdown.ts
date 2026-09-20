/**
 * 마크다운을 그릴 수 있는 모양으로 바꾼다 — 텍스트 패널의 마크다운 갈래.
 *
 * 설계 문서 6장은 "마크다운 렌더러 + DOMPurify"라고 적었다. 그 조합이 필요한 까닭은
 * 흔한 렌더러가 HTML 문자열을 내놓고, 그 문자열을 `innerHTML`로 넣기 때문이다. 파일
 * 속에 `<script>`가 있으면 그대로 돈다. 그래서 넣기 전에 한 번 씻어 낸다.
 *
 * 여기서는 HTML 문자열을 아예 만들지 않는다. 이 파일은 글을 블록과 조각으로 나누기만
 * 하고, 그것을 React 원소로 바꾸는 것은 패널이 한다. React가 글자를 텍스트 노드로
 * 넣으므로 파일 속 `<script>`는 화면에 `<script>`라고 보일 뿐 돌지 않는다. 씻어 낼
 * 일이 없으면 씻는 것을 잊을 일도 없다. 라이브러리 둘도 줄어든다.
 *
 * 대신 받는 것은 마크다운의 일부다. 제목, 문단, 목록, 인용, 코드 울타리, 구분선,
 * 표, 그리고 줄 안의 굵게·기울임·코드·링크. 이 프로젝트의 문서들이 쓰는 것이 이만큼
 * 이고, 각주나 정의 목록이 필요해지면 그때 늘린다.
 *
 * 링크만 한 군데 손을 본다. `javascript:`로 시작하는 주소는 React도 막아 주지 않아서
 * 여기서 뗀다.
 */

export type MarkdownSpan =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly spans: readonly MarkdownSpan[] }
  | { readonly kind: 'paragraph'; readonly spans: readonly MarkdownSpan[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly items: readonly (readonly MarkdownSpan[])[]
    }
  | { readonly kind: 'quote'; readonly spans: readonly MarkdownSpan[] }
  | { readonly kind: 'code'; readonly language: string; readonly lines: readonly string[] }
  | { readonly kind: 'rule' }
  | {
      readonly kind: 'table'
      readonly header: readonly (readonly MarkdownSpan[])[]
      readonly rows: readonly (readonly (readonly MarkdownSpan[])[])[]
    }

/**
 * 링크 주소를 받아도 되는지 본다.
 *
 * `javascript:`와 `data:`만 막는다. React는 `href`에 무엇이 들어오든 그대로 넣기
 * 때문에, 마크다운 파일 하나로 누르면 코드가 도는 링크를 만들 수 있다. 나머지
 * 스킴(mailto, tel, 상대 경로, 문서 안 앵커)은 그대로 둔다.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  // 스킴 안에 공백이나 제어 문자를 끼워 넣어 검사를 피하는 수가 있다. 먼저 걷어 낸다.
  // eslint-disable-next-line no-control-regex -- 제어 문자를 걷어 내는 것이 이 줄의 일이다.
  const bare = trimmed.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
  if (bare.startsWith('javascript:') || bare.startsWith('data:') || bare.startsWith('vbscript:')) {
    return null
  }
  return trimmed
}

const INLINE = /(`[^`]+`)|(\[[^\]]*\]\([^)\s]*\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/

/** 한 줄 안의 굵게·기울임·코드·링크를 조각으로 나눈다. */
export function parseInline(line: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = []
  let rest = line

  while (rest !== '') {
    const match = INLINE.exec(rest)
    if (match === null || match.index === undefined) break

    if (match.index > 0) spans.push({ kind: 'text', text: rest.slice(0, match.index) })
    const token = match[0]

    if (token.startsWith('`')) {
      spans.push({ kind: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const text = token.slice(1, split)
      const href = safeHref(token.slice(split + 2, -1))
      // 막은 주소는 링크를 떼고 글자만 남긴다. 조용히 사라지면 사람이 뭔가를 놓친다.
      spans.push(href === null ? { kind: 'text', text } : { kind: 'link', text, href })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      spans.push({ kind: 'strong', text: token.slice(2, -2) })
    } else {
      spans.push({ kind: 'em', text: token.slice(1, -1) })
    }

    rest = rest.slice(match.index + token.length)
  }

  if (rest !== '') spans.push({ kind: 'text', text: rest })
  return spans
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

const isTableDivider = (line: string): boolean =>
  /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes('-')

/** 글을 블록으로 나눈다. 줄 배열을 받는 까닭은 부르는 쪽이 이미 잘라 두었기 때문이다. */
export function parseMarkdown(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let index = 0

  const at = (offset: number): string => lines[offset] ?? ''

  while (index < lines.length) {
    const line = at(index)

    if (line.trim() === '') {
      index += 1
      continue
    }

    // 코드 울타리. 닫는 울타리가 없으면 끝까지가 코드다.
    const fence = /^\s*(```|~~~)\s*(\S*)/.exec(line)
    if (fence !== null) {
      const mark = fence[1] ?? '```'
      const language = fence[2] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !at(index).trimStart().startsWith(mark)) {
        body.push(at(index))
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', language, lines: body })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: parseInline(heading[2] ?? ''),
      })
      index += 1
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    // 표. 둘째 줄이 구분선이어야 표다. 아니면 그냥 세로 막대가 든 글이다.
    if (line.includes('|') && isTableDivider(at(index + 1))) {
      const header = cells(line).map(parseInline)
      index += 2
      const rows: (readonly MarkdownSpan[])[][] = []
      while (index < lines.length && at(index).includes('|') && at(index).trim() !== '') {
        rows.push(cells(at(index)).map(parseInline))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet !== null) {
      const ordered = /\d/.test(bullet[1] ?? '')
      const items: MarkdownSpan[][] = []
      while (index < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(at(index))
        if (next === null) break
        // 번호와 글머리표가 섞이면 목록이 바뀐 것이다.
        if (/\d/.test(next[1] ?? '') !== ordered) break
        items.push(parseInline(next[2] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(at(index))) {
        body.push(at(index).replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', spans: parseInline(body.join(' ')) })
      continue
    }

    // 문단. 빈 줄이나 다른 블록이 시작될 때까지 이어 붙인다.
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = at(index)
      if (current.trim() === '') break
      if (/^(#{1,6})\s+/.test(current) || /^\s*(```|~~~)/.test(current)) break
      if (/^\s*([-*+]|\d+[.)])\s+/.test(current) || /^\s*>\s?/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) })
  }

  return blocks
}
