import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_LINE_LIMIT, canHighlight, highlightLines, styleOf } from './highlight'

const textOf = (tokens: { text: string }[][]) =>
  tokens.map((line) => line.map((t) => t.text).join(''))

describe('canHighlight', () => {
  it('코드로 치는 확장자에 규칙이 붙어 있다', () => {
    for (const extension of ['ts', 'tsx', 'py', 'rs', 'go', 'sql', 'yaml', 'css']) {
      expect(canHighlight(extension)).toBe(true)
    }
  })

  it('대소문자를 가리지 않는다 — 윈도에서 온 파일이 .TS다', () => {
    expect(canHighlight('TS')).toBe(true)
  })

  it('규칙이 없는 것은 거짓', () => {
    expect(canHighlight('txt')).toBe(false)
    expect(canHighlight('')).toBe(false)
  })
})

describe('highlightLines', () => {
  /*
   * 색깔 자체는 테마가 정하므로 여기서 값을 못박지 않는다. 대신 **글자가 하나도
   * 축나지 않았는지**를 본다. 색칠은 줄을 조각으로 자르는 일이라, 자르다 흘리면
   * 화면에서 글자가 사라지는데 오류는 나지 않는다.
   */
  it('줄과 글자를 그대로 둔다', async () => {
    const lines = [
      'const 이름 = "홍길동" // 주석',
      '',
      'function 더하기(a: number) {',
      '  return a + 1',
      '}',
    ]
    const tokens = await highlightLines(lines, 'ts')
    expect(tokens).not.toBeNull()
    expect(textOf(tokens!)).toEqual(lines)
  })

  it('실제로 나눈다 — 한 줄이 한 덩어리로 오면 색칠한 것이 아니다', async () => {
    const tokens = await highlightLines(['const x = "여기"'], 'ts')
    expect(tokens![0]!.length).toBeGreaterThan(1)
    expect(tokens![0]!.some((token) => token.color !== undefined)).toBe(true)
  })

  it('키워드와 글자에 다른 색이 붙는다', async () => {
    const [line] = (await highlightLines(['const x = "여기"'], 'ts'))!
    const colorOf = (text: string) => line!.find((token) => token.text.includes(text))?.color
    expect(colorOf('const')).toBeDefined()
    expect(colorOf('여기')).toBeDefined()
    expect(colorOf('const')).not.toBe(colorOf('여기'))
  })

  it('언어마다 규칙이 다르다 — 파이썬의 def는 타입스크립트에서 키워드가 아니다', async () => {
    const [asPython] = (await highlightLines(['def 더하기(a):'], 'py'))!
    const [asTypescript] = (await highlightLines(['def 더하기(a):'], 'ts'))!
    expect(asPython![0]?.color).not.toBe(asTypescript![0]?.color)
  })

  it('같은 언어를 두 번 불러도 같은 답이 온다 — 규칙을 다시 받지 않는다', async () => {
    const once = await highlightLines(['const x = 1'], 'ts')
    const twice = await highlightLines(['const x = 1'], 'ts')
    expect(twice).toEqual(once)
  })

  /*
   * 문법은 앞줄을 봐야 알 수 있다. 여러 줄 주석 안의 `const`는 키워드가 아니고,
   * 줄 하나씩 따로 색칠하면 그것을 못 가린다.
   */
  it('앞줄을 이어서 본다 — 여러 줄 주석 안은 주석이다', async () => {
    const tokens = await highlightLines(['/*', 'const x = 1', '*/'], 'ts')
    const inside = tokens![1]![0]
    const outside = (await highlightLines(['const x = 1'], 'ts'))![0]![0]
    expect(inside?.color).not.toBe(outside?.color)
  })

  it('규칙이 없는 확장자는 null', async () => {
    expect(await highlightLines(['그냥 글'], 'txt')).toBeNull()
  })

  /*
   * 상한이 없으면 5만 줄짜리 파일을 열 때 화면이 몇 초 굳는다. 색칠을 포기하는 것이
   * 파일이 안 열리는 것보다 낫다.
   */
  it('너무 긴 파일은 색칠하지 않는다', async () => {
    const many = Array.from({ length: HIGHLIGHT_LINE_LIMIT + 1 }, () => 'const x = 1')
    expect(await highlightLines(many, 'ts')).toBeNull()
  })
})

describe('styleOf', () => {
  const token = (color: string | undefined, fontStyle: number | undefined) => ({
    text: 'x',
    color,
    fontStyle,
  })

  it('색만 있으면 색만 낸다', () => {
    expect(styleOf(token('#abcdef', 0))).toEqual({ color: '#abcdef' })
  })

  it('비트를 하나씩 푼다 — 1 기울임, 2 굵게, 4 밑줄', () => {
    expect(styleOf(token(undefined, 1))).toEqual({ fontStyle: 'italic' })
    expect(styleOf(token(undefined, 2))).toEqual({ fontWeight: 700 })
    expect(styleOf(token(undefined, 4))).toEqual({ textDecoration: 'underline' })
  })

  it('비트가 겹치면 겹쳐서 낸다', () => {
    expect(styleOf(token('#fff', 3))).toEqual({
      color: '#fff',
      fontStyle: 'italic',
      fontWeight: 700,
    })
  })

  /*
   * `toStrictEqual`이라야 뜻이 산다. `toEqual`은 `{ color: undefined }`를 빈 것과
   * 같게 보아서, 없는 속성을 undefined로 채우는 구현이 그대로 통과한다.
   */
  it('아무것도 없으면 빈 것 — 없는 속성을 undefined로 넣지 않는다', () => {
    expect(styleOf(token(undefined, undefined))).toStrictEqual({})
  })
})
