import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ENCODING_LABELS,
  LOG_LEVELS,
  LOG_LEVEL_LABELS,
  SELECTABLE_ENCODINGS,
  countByLevel,
  extensionOf,
  levelAt,
  type DetectedEncoding,
  type LoadedText,
  type LogLevel,
} from '@holo/data'
import { highlightLines, styleOf, type CodeToken } from './highlight'
import { parseMarkdown, type MarkdownBlock, type MarkdownSpan } from './markdown'

/**
 * 텍스트 패널 — 설계 문서 5장의 뷰 표에서 텍스트 자산을 맡는 뷰.
 *
 * 한 패널이 네 갈래(평문·로그·마크다운·코드)를 다 그린다. 갈래마다 뷰를 따로 두지
 * 않는 까닭은 사람이 하는 일의 팔 할이 같아서다 — 줄 번호를 보고, 찾고, 스크롤한다.
 * 다른 것은 마크다운을 그려 주느냐와 로그 레벨로 걸러 주느냐뿐이라, 그 둘만 갈린다.
 *
 * 선택 연동에는 참여하지 않는다(요구사항 2.1). 표 데이터가 아니라서 행이라는 것이
 * 없고, 다른 뷰가 고른 것과 이을 자리가 없다.
 *
 * 만 줄을 DOM에 그대로 올리면 스크롤이 끊기므로 표 뷰와 같은 방식으로 보이는 구간만
 * 만든다. 마크다운은 다르다. 블록마다 높이가 달라 자리를 미리 셀 수 없어서 통째로
 * 그리고, 대신 아주 긴 마크다운은 줄 모드로 보라고 말한다.
 *
 * 코드는 줄 모드 그대로 두고 색만 입힌다. 문법 규칙은 파일을 연 뒤에 붙으므로,
 * 색이 오기 전에도 글자는 이미 떠 있다. 색칠을 못 하는 파일(규칙이 없거나 너무 긴
 * 파일)도 마찬가지로 그냥 열린다 — 색은 있으면 좋은 것이지 여는 조건이 아니다.
 */

export type TextPanelProps = {
  text: LoadedText
  /** 사람이 인코딩을 바꿔 고르면 알린다. 파일을 다시 읽지 않고 바이트만 다시 푼다. */
  onEncodingChange?: (encoding: DetectedEncoding) => void
}

const LINE_HEIGHT = 22
const OVERSCAN = 8
/** 이보다 긴 마크다운은 그리지 않고 줄 모드로 연다. 블록 수만 줄에 비례해 늘어난다. */
const MARKDOWN_LINE_LIMIT = 5_000

/**
 * 한 줄을 그린다. 색칠한 조각이 있으면 그 위에 찾은 글자를 덧칠한다.
 *
 * 두 가지가 같은 글자를 서로 다르게 자르는 자리다. 문법은 `const`와 `"여기"`로 자르고,
 * 찾기는 사람이 친 글자로 자른다. 조각마다 찾기를 한 번 더 돌리면 둘이 포개진다 —
 * 어느 한쪽을 포기하지 않아도 된다.
 */
function LineText({
  line,
  tokens,
  query,
}: {
  line: string
  tokens: readonly CodeToken[] | undefined
  query: string
}) {
  const pieces: readonly { text: string; style?: ReturnType<typeof styleOf> }[] =
    tokens === undefined
      ? [{ text: line }]
      : tokens.map((one) => ({ text: one.text, style: styleOf(one) }))

  return (
    <>
      {pieces.map((piece, index) => (
        <span key={index} style={piece.style}>
          {splitByQuery(piece.text, query).map((part, at) =>
            part.hit ? <mark key={at}>{part.text}</mark> : <span key={at}>{part.text}</span>,
          )}
        </span>
      ))}
    </>
  )
}

const FLAVOR_LABELS = {
  plain: '글',
  log: '로그',
  markdown: '마크다운',
  code: '코드',
} as const

const count = (value: number) => value.toLocaleString('ko-KR')

/** 찾은 글자를 앞·맞은 곳·뒤로 나눈다. 대소문자를 가리지 않는다. */
function splitByQuery(line: string, query: string): { text: string; hit: boolean }[] {
  if (query === '') return [{ text: line, hit: false }]
  const parts: { text: string; hit: boolean }[] = []
  const haystack = line.toLowerCase()
  const needle = query.toLowerCase()
  let at = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found === -1) break
    if (found > at) parts.push({ text: line.slice(at, found), hit: false })
    parts.push({ text: line.slice(found, found + needle.length), hit: true })
    at = found + needle.length
  }
  if (at < line.length) parts.push({ text: line.slice(at), hit: false })
  return parts
}

function Spans({ spans }: { spans: readonly MarkdownSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${span.kind}-${index}`
        if (span.kind === 'strong') return <strong key={key}>{span.text}</strong>
        if (span.kind === 'em') return <em key={key}>{span.text}</em>
        if (span.kind === 'code') return <code key={key}>{span.text}</code>
        if (span.kind === 'link') {
          // 주소는 이미 걸러진 것만 온다(markdown.ts의 safeHref).
          return (
            <a key={key} href={span.href} target="_blank" rel="noreferrer noopener">
              {span.text}
            </a>
          )
        }
        return <span key={key}>{span.text}</span>
      })}
    </>
  )
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(6, block.level)}` as 'h1'
      return (
        <Tag>
          <Spans spans={block.spans} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      )
    case 'quote':
      return (
        <blockquote>
          <Spans spans={block.spans} />
        </blockquote>
      )
    case 'rule':
      return <hr />
    case 'code':
      return (
        <pre>
          <code>{block.lines.join('\n')}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map((spans, index) => (
        <li key={index}>
          <Spans spans={spans} />
        </li>
      ))
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((spans, index) => (
                <th key={index}>
                  <Spans spans={spans} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((spans, cellIndex) => (
                  <td key={cellIndex}>
                    <Spans spans={spans} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

export function TextPanel({ text, onEncodingChange }: TextPanelProps) {
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<readonly LogLevel[]>([])
  const [raw, setRaw] = useState(false)

  const scroller = useRef<HTMLDivElement>(null)
  const [first, setFirst] = useState(0)
  const [window_, setWindow] = useState(40)

  // 파일이 바뀌면 찾던 것과 걸러 둔 것을 비운다. 앞 파일의 조건이 남으면 빈 화면이 뜬다.
  useEffect(() => {
    setQuery('')
    setHidden([])
    setRaw(false)
    setFirst(0)
    if (scroller.current) scroller.current.scrollTop = 0
  }, [text.assetId])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setWindow(Math.ceil(element.clientHeight / LINE_HEIGHT) + OVERSCAN * 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const counts = useMemo(() => countByLevel(text.levels), [text.levels])

  /** 보이는 줄의 원래 번호. 찾기와 레벨 거르기를 함께 건다. */
  const visible = useMemo(() => {
    const needle = query.toLowerCase()
    const rows: number[] = []
    for (let index = 0; index < text.lines.length; index += 1) {
      const line = text.lines[index] ?? ''
      if (needle !== '' && !line.toLowerCase().includes(needle)) continue
      if (hidden.length > 0) {
        const level = levelAt(text.levels, index)
        if (level !== null && hidden.includes(level)) continue
      }
      rows.push(index)
    }
    return rows
  }, [text.lines, text.levels, query, hidden])

  // 조건이 바뀌면 보이는 줄 자체가 달라진다. 스크롤 위치를 그대로 두면 엉뚱한 곳을 본다.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
    setFirst(0)
  }, [query, hidden])

  /*
   * 문법 규칙은 코드 파일을 열 때만 받는다(설계 문서 6장). 그래서 여기가 기다리는
   * 자리이고, 오는 동안에도 글자는 떠 있다. 파일이 바뀌면 먼저 비워서 지난 파일의
   * 색이 새 글자에 얹히지 않게 한다.
   */
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null)
  useEffect(() => {
    setTokens(null)
    if (text.flavor !== 'code') return
    let alive = true
    void highlightLines(text.lines, extensionOf(text.name)).then((made) => {
      if (alive) setTokens(made)
    })
    return () => {
      alive = false
    }
  }, [text.flavor, text.lines, text.name])

  const tooLongToRender = text.lines.length > MARKDOWN_LINE_LIMIT

  const rendered = text.flavor === 'markdown' && !raw && query === '' && !tooLongToRender
  const blocks = useMemo(() => (rendered ? parseMarkdown(text.lines) : []), [rendered, text.lines])

  const toggleLevel = useCallback((level: LogLevel) => {
    setHidden((current) =>
      current.includes(level) ? current.filter((one) => one !== level) : [...current, level],
    )
  }, [])

  const start = Math.max(0, first - OVERSCAN)
  const end = Math.min(visible.length, start + window_)
  const slice: number[] = []
  for (let index = start; index < end; index += 1) slice.push(visible[index] ?? 0)

  const warnings = text.notices.filter((notice) => notice.level === 'warning')
  const filtered = query !== '' || hidden.length > 0

  return (
    <section className="holo-text" aria-label={`${text.name} 텍스트`}>
      <header className="holo-text-bar">
        <span className="holo-text-name" title={text.name}>
          {text.name}
        </span>
        <span className="holo-text-fact">
          {FLAVOR_LABELS[text.flavor]} · {count(text.lines.length)}줄
          {filtered ? ` (${count(visible.length)}줄 보임)` : ''}
        </span>

        <label className="holo-text-encoding">
          <span className="holo-text-encoding-label">인코딩</span>
          <select
            value={SELECTABLE_ENCODINGS.includes(text.encoding) ? text.encoding : 'utf-8'}
            onChange={(event) => onEncodingChange?.(event.target.value as DetectedEncoding)}
            disabled={onEncodingChange === undefined}
          >
            {SELECTABLE_ENCODINGS.map((encoding) => (
              <option key={encoding} value={encoding}>
                {ENCODING_LABELS[encoding]}
              </option>
            ))}
          </select>
        </label>

        {text.flavor === 'markdown' && !tooLongToRender ? (
          <button
            type="button"
            className={'holo-chip' + (raw ? ' is-on' : '')}
            onClick={() => setRaw((one) => !one)}
            aria-pressed={raw}
          >
            원본 보기
          </button>
        ) : null}

        <input
          type="search"
          className="holo-text-search"
          value={query}
          placeholder="찾기"
          aria-label="파일 안에서 찾기"
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      {text.flavor === 'log' ? (
        <div className="holo-text-levels" role="group" aria-label="로그 레벨 거르기">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={
                `holo-chip holo-level is-${level}` + (hidden.includes(level) ? ' is-off' : '')
              }
              aria-pressed={!hidden.includes(level)}
              onClick={() => toggleLevel(level)}
            >
              {LOG_LEVEL_LABELS[level]} {count(counts[level])}
            </button>
          ))}
        </div>
      ) : null}

      {warnings.map((notice) => (
        <p key={notice.message} className="holo-text-notice">
          {notice.message}
        </p>
      ))}

      {rendered ? (
        <div className="holo-text-body is-rendered" ref={scroller}>
          <article className="holo-markdown">
            {blocks.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </article>
        </div>
      ) : (
        <div
          className="holo-text-body"
          ref={scroller}
          onScroll={(event) => setFirst(Math.floor(event.currentTarget.scrollTop / LINE_HEIGHT))}
        >
          {visible.length === 0 ? (
            <p className="holo-text-empty">찾는 글자가 없습니다.</p>
          ) : (
            <div style={{ height: visible.length * LINE_HEIGHT, position: 'relative' }}>
              <div style={{ transform: `translateY(${start * LINE_HEIGHT}px)` }}>
                {slice.map((row) => {
                  const level = levelAt(text.levels, row)
                  return (
                    <div
                      key={row}
                      className={'holo-text-line' + (level === null ? '' : ` is-${level}`)}
                      style={{ height: LINE_HEIGHT }}
                    >
                      <span className="holo-text-number" aria-hidden="true">
                        {row + 1}
                      </span>
                      <span className="holo-text-content">
                        <LineText
                          line={text.lines[row] ?? ''}
                          tokens={tokens?.[row]}
                          query={query}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
