/**
 * 파일 하나를 텍스트 자산으로 읽는다 — 설계 문서 2장의 다섯 자산 중 둘째.
 *
 * 표와 모델 사이 어디쯤이다. 표처럼 내용을 우리 모양으로 바꾸지만(줄로 자르고 로그
 * 레벨을 센다) 모델처럼 원본 바이트도 들고 있는다. 바이트를 드는 까닭은 인코딩
 * 때문이다. 감지가 빗나갔을 때 사람이 인코딩을 바꿔 고르면 파일을 다시 읽지 않고
 * 그 자리에서 다시 풀 수 있어야 한다.
 *
 * 줄을 미리 잘라 두는 것은 패널이 가상 스크롤을 하기 때문이다. 스크롤할 때마다
 * 100MB짜리 로그를 다시 자를 수는 없다.
 */

import { assetIdOfFile, type FileIdentity } from './assetId'
import { decodeText, ENCODING_LABELS, trimToUtf8Boundary, type DetectedEncoding } from './encoding'
import type { LoadNotice } from './loadTable'
import { UnsupportedFileError } from './unsupported'
import { LOG_LEVELS, flavorOf, parseLogLevel, type LogLevel, type TextFlavor } from './textFlavor'

/**
 * 한 번에 푸는 최대 바이트.
 *
 * 로그는 기가바이트로 자란다. 전부 글자로 푸는 순간 원본의 두 배가 메모리에 얹히고
 * (자바스크립트 문자열은 UTF-16이다) 줄 배열이 또 얹힌다. 앞 32MB면 사람이 훑어보기
 * 에는 충분하고, 모자라면 잘랐다고 말해 준다.
 */
export const TEXT_BYTE_LIMIT = 32 * 1024 * 1024

export type LoadedText = {
  readonly assetId: string
  readonly name: string
  readonly flavor: TextFlavor
  readonly encoding: DetectedEncoding
  /** 인코딩을 추측으로 골랐는지. 패널이 "바꿔 볼까요?"를 띄울지 정한다. */
  readonly guessed: boolean
  readonly text: string
  readonly lines: readonly string[]
  /**
   * 줄마다의 로그 레벨. 로그가 아니면 비어 있다.
   *
   * `LogLevel[]`이 아니라 바이트 배열인 까닭은 크기다. 50만 줄짜리 로그에서 문자열
   * 배열은 포인터만 4MB인데, 여기서는 500KB다. 값은 `LOG_LEVELS`의 자리 + 1이고
   * 0은 레벨 없음이다.
   */
  readonly levels: Uint8Array
  /** 원본 바이트. 인코딩을 바꿔 고를 때 다시 푼다. */
  readonly bytes: ArrayBuffer
  readonly byteLength: number
  readonly truncated: boolean
  readonly notices: readonly LoadNotice[]
}

/** 브라우저의 File이 그대로 들어맞는다. */
export type ReadableTextFile = FileIdentity & {
  arrayBuffer(): Promise<ArrayBuffer>
  /**
   * 앞부분만 떼어 온다. `File.slice`가 그대로 맞는다.
   *
   * 없어도 읽기는 하지만, 있으면 큰 파일을 통째로 메모리에 올리지 않는다. 그 차이가
   * 파일 크기 안전장치에서 글자 파일만 크기를 따지지 않는 까닭이다.
   */
  slice?(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

const count = (value: number) => value.toLocaleString('ko-KR')

/**
 * 줄로 자른다.
 *
 * `\r\n`과 `\r`을 `\n`과 같게 본다. 윈도우에서 만든 로그를 그냥 자르면 줄마다 끝에
 * 보이지 않는 `\r`이 남아서, 검색이 줄 끝 글자에서 조용히 빗나간다.
 *
 * 끝의 빈 줄 하나는 버린다. 파일이 줄바꿈으로 끝나는 것이 보통인데, 그대로 두면
 * 모든 파일의 마지막에 빈 줄이 하나씩 더 보인다.
 */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 줄마다 레벨을 재서 바이트 배열로. 로그가 아니면 빈 배열. */
export function levelsOfLines(lines: readonly string[], flavor: TextFlavor): Uint8Array {
  if (flavor !== 'log') return new Uint8Array(0)
  const levels = new Uint8Array(lines.length)
  for (let index = 0; index < lines.length; index += 1) {
    const level = parseLogLevel(lines[index] ?? '')
    levels[index] = level === null ? 0 : LOG_LEVELS.indexOf(level) + 1
  }
  return levels
}

/** 바이트 배열의 한 자리를 다시 레벨로. 자리가 없거나 0이면 null. */
export function levelAt(levels: Uint8Array, index: number): LogLevel | null {
  const value = levels[index] ?? 0
  return value === 0 ? null : (LOG_LEVELS[value - 1] ?? null)
}

/** 레벨별 줄 수. 필터 단추 옆의 숫자가 이것이다. */
export function countByLevel(levels: Uint8Array): Record<LogLevel, number> {
  const counts = { error: 0, warn: 0, info: 0, debug: 0, trace: 0 }
  for (let index = 0; index < levels.length; index += 1) {
    const level = levelAt(levels, index)
    if (level !== null) counts[level] += 1
  }
  return counts
}

function noticesOfText(loaded: {
  encoding: DetectedEncoding
  guessed: boolean
  lines: readonly string[]
  levels: Uint8Array
  truncated: boolean
  byteLength: number
}): LoadNotice[] {
  const notices: LoadNotice[] = [
    { level: 'info', message: `${count(loaded.lines.length)}줄을 읽었습니다.` },
  ]

  if (loaded.guessed && loaded.encoding !== 'utf-8') {
    notices.push({
      level: 'warning',
      message:
        `글자 인코딩이 적혀 있지 않아 ${ENCODING_LABELS[loaded.encoding]}(으)로 읽었습니다. ` +
        '글자가 깨져 보이면 위에서 다른 인코딩을 골라 주세요.',
    })
  }

  if (loaded.truncated) {
    notices.push({
      level: 'warning',
      message:
        `파일이 ${count(Math.round(loaded.byteLength / (1024 * 1024)))}MB라 앞 ` +
        `${count(TEXT_BYTE_LIMIT / (1024 * 1024))}MB만 열었습니다.`,
    })
  }

  const errors = countByLevel(loaded.levels).error
  if (errors > 0) {
    notices.push({ level: 'warning', message: `오류 줄이 ${count(errors)}개 있습니다.` })
  }

  return notices
}

/** 이미 읽은 바이트를 텍스트 자산으로 맞춘다. 인코딩을 바꿔 고를 때도 이 길로 온다. */
export function buildText(
  identity: { assetId: string; name: string },
  bytes: ArrayBuffer,
  options: { forcedEncoding?: DetectedEncoding; byteLength?: number } = {},
): LoadedText {
  const byteLength = options.byteLength ?? bytes.byteLength
  const truncated = byteLength > bytes.byteLength
  const decoded = decodeText(bytes, options.forcedEncoding)
  const lines = splitLines(decoded.text)
  const flavor = flavorOf(identity.name, lines)
  const levels = levelsOfLines(lines, flavor)

  return {
    assetId: identity.assetId,
    name: identity.name,
    flavor,
    encoding: decoded.encoding,
    guessed: decoded.guessed,
    text: decoded.text,
    lines,
    levels,
    bytes,
    byteLength,
    truncated,
    notices: noticesOfText({
      encoding: decoded.encoding,
      guessed: decoded.guessed,
      lines,
      levels,
      truncated,
      byteLength,
    }),
  }
}

export async function readTextFile(
  file: ReadableTextFile,
  options: { forcedEncoding?: DetectedEncoding } = {},
): Promise<LoadedText> {
  /*
   * 한계보다 큰 것이 이미 확실하면 앞부분만 떼어 온다. 통째로 올린 뒤에 자르면
   * 자르기 전에 이미 기가바이트가 메모리에 얹혀서, 자르는 일 자체가 탭을 죽인다.
   */
  const known = file.size
  const slice = typeof file.slice === 'function' ? file.slice.bind(file) : null
  const headOnly = known !== undefined && known > TEXT_BYTE_LIMIT && slice !== null

  let read: ArrayBuffer
  try {
    read =
      headOnly && slice !== null
        ? await slice(0, TEXT_BYTE_LIMIT).arrayBuffer()
        : await file.arrayBuffer()
  } catch {
    throw new UnsupportedFileError(file.name, `'${file.name}'을(를) 읽지 못했습니다.`)
  }

  // 앞부분만 떼어 왔으면 원본 크기는 파일이 말해 준 값이다. 잘렸다는 안내가 거기서 나온다.
  const byteLength = headOnly ? (known ?? read.byteLength) : read.byteLength

  let bytes = read
  if (read.byteLength > TEXT_BYTE_LIMIT || headOnly) {
    // 자르는 자리가 글자 가운데면 UTF-8 감지가 통째로 빗나간다. 끊긴 꼬리를 먼저 뗀다.
    const limit = Math.min(read.byteLength, TEXT_BYTE_LIMIT)
    const head = trimToUtf8Boundary(new Uint8Array(read, 0, limit))
    if (head.byteLength < read.byteLength) bytes = read.slice(0, head.byteLength)
  }
  return buildText({ assetId: assetIdOfFile(file), name: file.name }, bytes, {
    ...options,
    byteLength,
  })
}
