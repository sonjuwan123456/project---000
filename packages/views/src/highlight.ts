/**
 * 코드 문법 강조 — 설계 문서 6장이 Shiki로 못 박은 자리.
 *
 * 문서가 적은 것은 "VS Code와 같은 문법 규칙. **코드 파일을 열 때만 불러옴**"이다.
 * 뒤쪽이 이 파일 구조의 거의 전부다. Shiki는 언어마다 문법 규칙을 따로 들고 있어서,
 * 한 번에 다 담으면 코드 파일을 열지 않는 사람까지 수 메가바이트를 받는다.
 *
 * 그래서 **확장자마다 그 언어 하나만 가져오는 줄을 손으로 적어 둔다.** 경로를 문자열로
 * 지어 `import(\`.../${이름}.mjs\`)` 하면 번들러가 어느 것이 쓰일지 몰라 720개를 전부
 * 담는다. 줄을 손으로 적는 대가로 코드 파일 하나를 열 때 그 언어 하나만 받는다.
 *
 * **HTML 문자열을 받지 않는다.** Shiki는 색칠한 HTML도 내주지만, 이 프로젝트는 글자를
 * 화면에 넣을 때 HTML 문자열을 거치지 않기로 했다(마크다운 패널과 같은 결정). 토큰만
 * 받아서 패널이 직접 React 조각으로 그린다. 줄 단위로 오기 때문에 가상 스크롤과도
 * 그대로 맞물린다.
 */

import type { HighlighterCore } from 'shiki/core'

/** 무대가 어두우므로 어두운 테마 하나만 쓴다. 밝은 테마는 쓸 자리가 없다. */
const THEME = 'vitesse-dark'

/**
 * 확장자 → 문법 규칙 한 덩어리.
 *
 * 값이 함수인 까닭은 부를 때까지 받지 않기 위해서다. `@holo/data`의 `textFlavor`가
 * `code`로 치는 확장자를 그대로 덮는다. 거기에 확장자를 더하면 여기도 한 줄 는다.
 */
const LANGUAGES: Readonly<Record<string, () => Promise<unknown>>> = {
  ts: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  mjs: () => import('shiki/langs/javascript.mjs'),
  cjs: () => import('shiki/langs/javascript.mjs'),
  py: () => import('shiki/langs/python.mjs'),
  rs: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kt: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  rb: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  h: () => import('shiki/langs/c.mjs'),
  cc: () => import('shiki/langs/cpp.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  hpp: () => import('shiki/langs/cpp.mjs'),
  cs: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  sh: () => import('shiki/langs/bash.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  zsh: () => import('shiki/langs/bash.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yml: () => import('shiki/langs/yaml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  // .gitignore에는 맞는 문법 규칙이 없다. ini가 주석과 글자를 그럭저럭 갈라 준다.
  gitignore: () => import('shiki/langs/ini.mjs'),
}

/** 색칠한 글자 한 조각. 화면에 그릴 때 필요한 것만 남겼다. */
export type CodeToken = {
  readonly text: string
  readonly color: string | undefined
  /** 기울임·굵게 같은 것. Shiki의 비트 값을 그대로 쓴다. */
  readonly fontStyle: number | undefined
}

/**
 * 한 파일에 색칠할 수 있는 줄 수의 상한.
 *
 * 문법 규칙은 줄을 앞에서부터 이어서 읽어야 한다. 여러 줄 주석이나 따옴표가 어디서
 * 열렸는지 앞을 봐야 알기 때문에, 보이는 줄만 골라 색칠할 수가 없다. 그래서 파일이
 * 크면 통째로 훑는 값을 치러야 하고, 그 값이 기다릴 만하지 않은 자리에서 멈춘다.
 * 5만 줄짜리 파일도 열리기는 해야 하므로, 색칠을 포기하고 글자로 보여 준다.
 */
export const HIGHLIGHT_LINE_LIMIT = 20000

/**
 * 조각 하나에 입힐 꾸밈.
 *
 * Shiki는 굵게·기울임·밑줄을 비트 하나에 담아 준다(1 기울임, 2 굵게, 4 밑줄). 그 셈을
 * 그리는 쪽에 흘리지 않으려고 여기서 푼다. React를 쓰지 않는 보통 객체라 시험하기도 쉽다.
 */
export function styleOf(token: CodeToken): {
  color?: string
  fontStyle?: 'italic'
  fontWeight?: 700
  textDecoration?: 'underline'
} {
  const bits = token.fontStyle ?? 0
  return {
    ...(token.color === undefined ? {} : { color: token.color }),
    ...((bits & 1) === 0 ? {} : { fontStyle: 'italic' as const }),
    ...((bits & 2) === 0 ? {} : { fontWeight: 700 as const }),
    ...((bits & 4) === 0 ? {} : { textDecoration: 'underline' as const }),
  }
}

/** 이 확장자에 붙일 문법 규칙이 있는지. 화면이 시도 전에 묻는다. */

export function canHighlight(extension: string): boolean {
  return LANGUAGES[extension.toLowerCase()] !== undefined
}

/**
 * 규칙을 하나 받아 둔 뒤로는 다시 받지 않는다.
 *
 * 색칠기는 만드는 값이 비싸고(테마와 정규식 엔진), 같은 언어의 파일을 이어서 여는 일이
 * 흔하다. 언어는 필요할 때마다 얹는다.
 */
let core: Promise<HighlighterCore> | null = null
const loaded = new Set<string>()

/**
 * 색칠기 자체도 코드 파일을 열 때 받는다.
 *
 * `shiki/core`와 정규식 엔진을 위에서 그냥 `import` 하면 첫 화면 꾸러미에 170KB가
 * 붙는다. 표 하나를 보려고 온 사람이 그 값을 치를 까닭이 없다. 타입만 위에서 가져오고
 * (빌드 때 지워진다) 실물은 여기서 받는다.
 */
async function makeCore(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ])
  return await createHighlighterCore({
    themes: [import('shiki/themes/vitesse-dark.mjs')],
    langs: [],
    // 정규식을 자바스크립트로 돈다. oniguruma를 쓰면 .wasm 한 덩어리가 따라온다.
    engine: createJavaScriptRegexEngine(),
  })
}

async function highlighterFor(language: string, load: () => Promise<unknown>) {
  core ??= makeCore()
  const made = await core

  if (!loaded.has(language)) {
    await made.loadLanguage((await load()) as Parameters<HighlighterCore['loadLanguage']>[0])
    loaded.add(language)
  }
  return made
}

/**
 * 줄마다 색칠한 조각을 낸다. 붙일 규칙이 없거나 너무 길면 null.
 *
 * null은 실패가 아니라 "색칠하지 않는다"는 답이다. 부르는 쪽은 그대로 글자로 그리면
 * 된다 — 색이 없을 뿐 파일은 열린다.
 */
export async function highlightLines(
  lines: readonly string[],
  extension: string,
): Promise<CodeToken[][] | null> {
  const key = extension.toLowerCase()
  const load = LANGUAGES[key]
  if (load === undefined || lines.length > HIGHLIGHT_LINE_LIMIT) return null

  try {
    const highlighter = await highlighterFor(key, load)
    const tokens = highlighter.codeToTokensBase(lines.join('\n'), {
      lang: key,
      theme: THEME,
    })
    return tokens.map((line) =>
      line.map((token) => ({
        text: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      })),
    )
  } catch {
    // 규칙을 못 받았거나 파싱이 막혔으면 색 없이 보여 준다. 파일을 못 여는 것보다 낫다.
    return null
  }
}
