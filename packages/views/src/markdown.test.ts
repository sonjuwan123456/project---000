import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref, type MarkdownBlock } from './markdown'

const lines = (text: string) => text.split('\n')
const kinds = (blocks: readonly MarkdownBlock[]) => blocks.map((block) => block.kind)

describe('safeHref', () => {
  it('보통 주소는 그대로 둔다', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com')
    expect(safeHref('#5장')).toBe('#5장')
    expect(safeHref('./다른문서.md')).toBe('./다른문서.md')
  })

  /*
   * 이것이 DOMPurify를 대신하는 유일한 자리다. React는 글자를 텍스트로 넣어 주지만
   * href만은 준 대로 넣는다. 마크다운 파일 하나로 "누르면 코드가 도는 링크"를
   * 만들 수 있다.
   */
  it('누르면 코드가 도는 주소를 막는다', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHref('vbscript:msgbox')).toBeNull()
  })

  it('스킴 사이에 공백·제어 문자를 끼워 넣어도 막는다', () => {
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeHref('  java script : alert(1)')).toBeNull()
    expect(safeHref('java\u0000script:alert(1)')).toBeNull()
  })
})

describe('parseInline', () => {
  it('굵게·기울임·코드를 가른다', () => {
    expect(parseInline('보통 **굵게** 그리고 *기울임* 과 `코드`')).toEqual([
      { kind: 'text', text: '보통 ' },
      { kind: 'strong', text: '굵게' },
      { kind: 'text', text: ' 그리고 ' },
      { kind: 'em', text: '기울임' },
      { kind: 'text', text: ' 과 ' },
      { kind: 'code', text: '코드' },
    ])
  })

  it('굵게를 기울임 둘로 읽지 않는다', () => {
    expect(parseInline('**둘**')).toEqual([{ kind: 'strong', text: '둘' }])
  })

  it('링크를 글자와 주소로 가른다', () => {
    expect(parseInline('[설계 문서](./설계.md)를 보세요')).toEqual([
      { kind: 'link', text: '설계 문서', href: './설계.md' },
      { kind: 'text', text: '를 보세요' },
    ])
  })

  it('막은 주소는 링크를 떼고 글자만 남긴다', () => {
    // 통째로 지우면 사람은 뭔가가 있었다는 것조차 모른다.
    expect(parseInline('[눌러 보세요](javascript:danger)')).toEqual([
      { kind: 'text', text: '눌러 보세요' },
    ])
    // 주소에 괄호가 들어 있어 조각이 더 나뉘어도, 링크는 하나도 남지 않는다.
    const messy = parseInline('[눌러 보세요](javascript:alert(1))')
    expect(messy.some((span) => span.kind === 'link')).toBe(false)
  })

  it('표시가 없으면 글자 한 조각이다', () => {
    expect(parseInline('그냥 한 줄')).toEqual([{ kind: 'text', text: '그냥 한 줄' }])
    expect(parseInline('')).toEqual([])
  })

  it('코드 안의 별표는 굵게가 아니다', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }])
  })
})

describe('parseMarkdown', () => {
  it('제목의 깊이를 센다', () => {
    const blocks = parseMarkdown(lines('# 하나\n\n### 셋'))
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 3 })
  })

  it('#만 있고 글자가 없으면 제목이 아니다', () => {
    expect(kinds(parseMarkdown(lines('#태그')))).toEqual(['paragraph'])
  })

  it('글머리표 목록과 번호 목록을 가른다', () => {
    const blocks = parseMarkdown(lines('- 하나\n- 둘\n\n1. 첫째\n2. 둘째'))
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true })
    expect(blocks[0]).toMatchObject({ items: [[{ text: '하나' }], [{ text: '둘' }]] })
  })

  it('번호와 글머리표가 붙어 있으면 목록 둘이다', () => {
    const blocks = parseMarkdown(lines('- 하나\n1. 첫째'))
    expect(kinds(blocks)).toEqual(['list', 'list'])
  })

  it('코드 울타리 안은 마크다운으로 읽지 않는다', () => {
    const blocks = parseMarkdown(lines('```ts\n# 주석이 아니다\n- 목록도 아니다\n```'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      kind: 'code',
      language: 'ts',
      lines: ['# 주석이 아니다', '- 목록도 아니다'],
    })
  })

  it('닫지 않은 울타리는 끝까지가 코드다', () => {
    const blocks = parseMarkdown(lines('```\n한 줄\n또 한 줄'))
    expect(blocks[0]).toMatchObject({ kind: 'code', lines: ['한 줄', '또 한 줄'] })
  })

  it('표를 읽는다', () => {
    const blocks = parseMarkdown(lines('| 이름 | 값 |\n| --- | --- |\n| 가 | 1 |\n| 나 | 2 |'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'table',
      header: [[{ text: '이름' }], [{ text: '값' }]],
      rows: [
        [[{ text: '가' }], [{ text: '1' }]],
        [[{ text: '나' }], [{ text: '2' }]],
      ],
    })
  })

  it('구분선이 없으면 표가 아니다', () => {
    // 세로 막대가 든 문장까지 표로 읽으면 글이 깨진다.
    expect(kinds(parseMarkdown(lines('a | b 처럼 쓰기도 한다')))).toEqual(['paragraph'])
  })

  it('인용과 구분선을 읽는다', () => {
    const blocks = parseMarkdown(lines('> 인용 한 줄\n> 이어지는 줄\n\n---\n\n끝'))
    expect(kinds(blocks)).toEqual(['quote', 'rule', 'paragraph'])
  })

  it('문단은 빈 줄까지 이어 붙이고, 다른 블록에서 끊는다', () => {
    const blocks = parseMarkdown(lines('첫 줄\n둘째 줄\n# 제목'))
    expect(kinds(blocks)).toEqual(['paragraph', 'heading'])
    expect(blocks[0]).toMatchObject({ spans: [{ kind: 'text', text: '첫 줄 둘째 줄' }] })
  })

  it('빈 글은 블록이 없다', () => {
    expect(parseMarkdown([])).toEqual([])
    expect(parseMarkdown(['', '  '])).toEqual([])
  })

  it('파일 속 HTML은 글자로 남는다', () => {
    // React가 텍스트 노드로 넣으므로 화면에는 이 글자 그대로 보인다.
    const blocks = parseMarkdown(lines('<script>alert(1)</script>'))
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      spans: [{ kind: 'text', text: '<script>alert(1)</script>' }],
    })
  })
})
