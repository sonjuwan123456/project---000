/**
 * 텍스트 자산의 갈래를 가린다 — M2 텍스트 패널이 무엇을 그릴지 정하는 자리.
 *
 * 설계 문서 6장의 형식별 처리 표가 텍스트를 하나로 묶지 않고 셋으로 갈라 두었다.
 * 로그는 레벨별 색상과 필터, 마크다운은 렌더링, 코드는 문법 강조. 셋 다 "줄이 있는
 * 글자"인데 사람이 하려는 일이 달라서, 한 패널이 갈래를 보고 다르게 그린다.
 *
 * 확장자만으로는 부족하다. 로그 파일이 `.txt`로 오는 일이 `.log`로 오는 일만큼
 * 흔하고, `app.log`라고 적힌 설정 파일도 있다. 그래서 확장자가 분명할 때는 그것을
 * 믿고, 애매할 때만 내용을 본다.
 *
 * 내용 판별은 앞쪽 몇백 줄만 본다. 100MB짜리 로그의 끝까지 읽어 봐야 앞에서 이미
 * 알 수 있던 것을 다시 확인할 뿐이다.
 */

export type TextFlavor = 'plain' | 'log' | 'markdown' | 'code'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

/** 사람에게 보여 줄 이름. 패널의 필터 단추가 이 순서를 쓴다. */
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace']

export const LOG_LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
  error: '오류',
  warn: '경고',
  info: '정보',
  debug: '디버그',
  trace: '추적',
}

/** 확장자 → 갈래. 여기 있으면 내용을 보지 않는다. */
const FLAVOR_BY_EXTENSION: Readonly<Record<string, TextFlavor>> = {
  log: 'log',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  java: 'code',
  kt: 'code',
  swift: 'code',
  rb: 'code',
  php: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  xml: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',
  yml: 'code',
  yaml: 'code',
  toml: 'code',
  ini: 'code',
  gitignore: 'code',
}

/** 이 갈래로 못 박힌 확장자들. 형식 표가 받는 확장자 목록으로 그대로 쓴다. */
export function extensionsOfFlavor(flavor: TextFlavor): readonly string[] {
  return Object.keys(FLAVOR_BY_EXTENSION).filter((one) => FLAVOR_BY_EXTENSION[one] === flavor)
}

export function flavorOfExtension(extension: string): TextFlavor | null {
  return FLAVOR_BY_EXTENSION[extension.toLowerCase()] ?? null
}

/*
 * 레벨을 읽는 규칙 셋. 느슨하게 잡으면 산문의 "error"가 전부 걸리고, 빡빡하게 잡으면
 * 형식마다 다른 로그를 놓친다. 그래서 "로그답게 적힌 자리"만 본다.
 *
 *   [ERROR]  (ERROR)  <ERROR>   — 감싼 것. 대소문자를 가리지 않는다.
 *   ERROR                        — 맨 대문자. 산문에서는 잘 쓰지 않는다.
 *   error:                       — 줄 앞머리에 붙은 것.
 *
 * 어느 규칙이든 줄 앞쪽에서만 찾는다. 시각과 스레드 이름이 앞에 붙는 것까지 감안해
 * 앞 120자를 본다. 뒤쪽의 "error"는 대개 메시지 본문이다.
 */
const HEAD_CHARS = 120

const WORDS: Readonly<Record<string, LogLevel>> = {
  TRACE: 'trace',
  FINEST: 'trace',
  DEBUG: 'debug',
  FINE: 'debug',
  VERBOSE: 'debug',
  INFO: 'info',
  INFORMATION: 'info',
  NOTICE: 'info',
  WARN: 'warn',
  WARNING: 'warn',
  ERROR: 'error',
  ERR: 'error',
  SEVERE: 'error',
  FATAL: 'error',
  CRITICAL: 'error',
  CRIT: 'error',
}

const WORD_PATTERN = Object.keys(WORDS).join('|')
const BRACKETED = new RegExp(`[[(<](${WORD_PATTERN})[\\])>]`, 'i')
const BARE_UPPER = new RegExp(`\\b(${WORD_PATTERN})\\b`)
const LEADING = new RegExp(`^\\s*(${WORD_PATTERN})\\s*[:-]`, 'i')

/** 한 줄의 로그 레벨. 로그처럼 적힌 자리가 없으면 null. */
export function parseLogLevel(line: string): LogLevel | null {
  const head = line.slice(0, HEAD_CHARS)
  const match = LEADING.exec(head) ?? BRACKETED.exec(head) ?? BARE_UPPER.exec(head)
  if (match === null) return null
  return WORDS[(match[1] ?? '').toUpperCase()] ?? null
}

/** 2026-09-20T12:01:35, 2026/09/20 12:01, 12:01:35.123 — 로그 앞머리의 흔한 모양들. */
const TIMESTAMP =
  /^\s*[[(]?\s*(\d{4}[-/]\d{2}[-/]\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?|\d{2}:\d{2}:\d{2}(\.\d+)?)/

export function hasLogTimestamp(line: string): boolean {
  return TIMESTAMP.test(line)
}

/** 내용 판별에 볼 줄 수. 앞쪽만 봐도 갈래는 드러난다. */
const SCAN_LINES = 400

/**
 * 내용이 로그처럼 보이는지.
 *
 * 레벨이나 시각이 붙은 줄이 비어 있지 않은 줄의 3할을 넘으면 로그로 본다. 3할인
 * 까닭은 스택 트레이스 때문이다. 예외 하나가 스무 줄을 차지하는데 그중 레벨이 붙은
 * 것은 첫 줄뿐이라, 절반을 기준으로 두면 예외가 많은 로그가 통째로 빠진다.
 */
export function looksLikeLog(lines: readonly string[]): boolean {
  const scanned = lines.slice(0, SCAN_LINES).filter((line) => line.trim() !== '')
  if (scanned.length < 5) return false
  const marked = scanned.filter(
    (line) => parseLogLevel(line) !== null || hasLogTimestamp(line),
  ).length
  return marked / scanned.length >= 0.3
}

/** 내용이 마크다운처럼 보이는지. 제목·목록·울타리 중 둘 이상이 있으면 그렇게 본다. */
export function looksLikeMarkdown(lines: readonly string[]): boolean {
  const scanned = lines.slice(0, SCAN_LINES)
  const signs = [
    scanned.some((line) => /^#{1,6}\s+\S/.test(line)),
    scanned.some((line) => /^\s*([-*+]|\d+\.)\s+\S/.test(line)),
    scanned.some((line) => /^\s*```/.test(line)),
    scanned.some((line) => /^\s*>\s+\S/.test(line)),
    scanned.some((line) => /\[[^\]]+\]\([^)]+\)/.test(line)),
  ].filter(Boolean).length
  return signs >= 2
}

/**
 * 파일 이름과 내용으로 갈래를 고른다.
 *
 * 확장자가 갈래를 못 박는 것이면 그대로 쓴다. `.md`를 열었는데 마크다운 표시가
 * 하나도 없다고 평문으로 돌리면, 제목만 있는 메모가 평문으로 뜬다.
 */
export function flavorOf(name: string, lines: readonly string[]): TextFlavor {
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  const byExtension = flavorOfExtension(extension)
  if (byExtension !== null) return byExtension

  if (looksLikeLog(lines)) return 'log'
  if (looksLikeMarkdown(lines)) return 'markdown'
  return 'plain'
}
