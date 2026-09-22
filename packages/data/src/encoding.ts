/**
 * 글자 인코딩 감지 — 설계 문서 6장의 로더 공통 기능, M1 완료 기준의 절반.
 *
 * "깨진 파일과 EUC-KR 파일을 넣어도 이해할 수 있는 결과가 나옴"이 M1 완료 기준이다.
 * 한국에서 만든 CSV는 아직도 EUC-KR(정확히는 CP949)인 것이 흔하다. 엑셀이 "CSV
 * (쉼표로 분리)"로 저장하면 그렇게 나온다. UTF-8로 읽으면 글자가 전부 깨지는데,
 * 그 상태로도 파싱은 성공해서 표가 뜬다 — 컬럼 이름이 "�̸�"인 표가.
 *
 * 그래서 감지를 파싱 앞에 둔다. 판별은 세 걸음이다.
 *
 * 1. BOM이 있으면 그게 답이다. 적어 둔 것을 두고 추측할 이유가 없다.
 * 2. 엄격한 UTF-8 해독을 해 본다. UTF-8은 아무 바이트 열이나 통과하지 못하는
 *    구조라, 통과하면 거의 확실히 UTF-8이다. EUC-KR로 쓴 한국어가 우연히 UTF-8로도
 *    유효할 확률은 매우 낮다 — 한글 한 글자가 0xB0~0xC8대 두 바이트인데, UTF-8에서
 *    그 범위의 선두 바이트는 뒤에 0x80~0xBF를 요구하고 EUC-KR 둘째 바이트는 대개
 *    0xA1~0xFE라 어긋난다.
 * 3. 실패하면 CP949로 본다. 한국어 파일에서 UTF-8이 아닌 것의 사실상 전부다.
 *
 * `windows-949`를 쓰고 `euc-kr`을 쓰지 않는다. 웹 표준에서 두 이름은 같은 해독기를
 * 가리키지만(둘 다 CP949로 확장된 표), 이름을 CP949 쪽으로 적어 두는 편이 "확장 한글
 * 8,822자도 읽는다"는 뜻을 코드에서 바로 읽히게 한다.
 *
 * 다만 그 확장 영역은 **브라우저에서만** 보장된다. Node의 해독기는 빌드에 따라 완성형
 * 범위까지만 읽고 확장 영역을 두 바이트로 보지 않는 것이 있어서, 그 부분은 단위 시험이
 * 아니라 브라우저로 확인했다.
 */

export type DetectedEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'cp949'

export type DecodedText = {
  readonly text: string
  readonly encoding: DetectedEncoding
  /**
   * 추측으로 고른 것인지. BOM이 있었으면 거짓이다.
   *
   * 화면이 이 값으로 "인코딩을 바꿔 볼까요?"를 띄울지 정한다. 적혀 있던 것을 읽은
   * 경우까지 물으면 시끄럽기만 하다.
   */
  readonly guessed: boolean
}

/** 사람에게 보여 줄 이름. */
export const ENCODING_LABELS: Readonly<Record<DetectedEncoding, string>> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 (BOM)',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  cp949: '한국어 (CP949/EUC-KR)',
}

/** 사용자가 손으로 고를 수 있는 것들. 화면의 선택 목록이 이 순서를 쓴다. */
export const SELECTABLE_ENCODINGS: readonly DetectedEncoding[] = [
  'utf-8',
  'cp949',
  'utf-16le',
  'utf-16be',
]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

/** BOM을 보고 인코딩과 건너뛸 바이트 수를 낸다. 없으면 null. */
export function readBom(bytes: Uint8Array): { encoding: DetectedEncoding; skip: number } | null {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { encoding: 'utf-8-bom', skip: 3 }
  // UTF-32도 FF FE로 시작하므로 넷을 먼저 본다. 셋만 보면 UTF-32LE를 UTF-16LE로 읽는다.
  if (startsWith(bytes, [0xff, 0xfe, 0x00, 0x00])) return null
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: 'utf-16le', skip: 2 }
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: 'utf-16be', skip: 2 }
  return null
}

/** 그 인코딩으로 읽으면 글자가 되는지. 되면 글자를, 안 되면 null. */
function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 바이트를 글자로 바꾼다. 인코딩을 지정하면 그대로 쓰고, 아니면 감지한다.
 *
 * 감지에 실패하는 일은 없다. 마지막에 CP949로 물러서고, CP949 해독기는 어떤 바이트
 * 열이든 받는다. 대신 무엇으로 읽었는지와 추측이었는지를 같이 돌려주어, 화면이
 * 사람에게 바꿀 기회를 줄 수 있게 한다.
 */
export function decodeText(buffer: ArrayBuffer, forced?: DetectedEncoding): DecodedText {
  const bytes = new Uint8Array(buffer)

  if (forced !== undefined) {
    const bom = readBom(bytes)
    // 손으로 고른 것이 BOM과 같으면 BOM은 글자가 아니므로 떼어 낸다.
    const body = bom !== null && bom.encoding === forced ? bytes.subarray(bom.skip) : bytes
    return {
      text: new TextDecoder(labelOf(forced)).decode(body),
      encoding: forced,
      guessed: false,
    }
  }

  const bom = readBom(bytes)
  if (bom !== null) {
    return {
      text: new TextDecoder(labelOf(bom.encoding)).decode(bytes.subarray(bom.skip)),
      encoding: bom.encoding,
      guessed: false,
    }
  }

  const utf8 = tryDecode(bytes, 'utf-8')
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8', guessed: true }

  return {
    text: new TextDecoder('windows-949').decode(bytes),
    encoding: 'cp949',
    guessed: true,
  }
}

function labelOf(encoding: DetectedEncoding): string {
  switch (encoding) {
    case 'utf-8':
    case 'utf-8-bom':
      return 'utf-8'
    case 'utf-16le':
      return 'utf-16le'
    case 'utf-16be':
      return 'utf-16be'
    case 'cp949':
      return 'windows-949'
  }
}

/**
 * 잘라 낸 바이트의 끝에서, 도중에 끊긴 UTF-8 글자 한 개분을 떼어 낸다.
 *
 * 큰 파일의 앞부분만 풀 때 필요하다. 자르는 자리가 한글 한 글자(UTF-8로 세 바이트)의
 * 가운데면 엄격한 UTF-8 해독이 실패하고, 그러면 감지가 CP949로 물러선다. 마지막 한
 * 글자 때문에 파일 전체가 깨져 보이는 것이다. 끊긴 꼬리를 미리 떼면 그 일이 없다.
 *
 * CP949로 자른 자리는 이렇게 고치지 않는다. 두 바이트 중 하나가 잘려도 그 한 글자만
 * 이상해질 뿐 나머지 판단을 흔들지 않아서, 들일 값에 비해 얻는 것이 없다.
 */
export function trimToUtf8Boundary(bytes: Uint8Array): Uint8Array {
  const isContinuation = (byte: number) => (byte & 0xc0) === 0x80
  // UTF-8 글자는 최대 네 바이트다. 이어짐 바이트를 셋보다 많이 거슬러 갈 일은 없다.
  let index = bytes.byteLength - 1
  let trailing = 0
  while (index >= 0 && trailing < 3 && isContinuation(bytes[index] ?? 0)) {
    index -= 1
    trailing += 1
  }
  if (index < 0) return bytes

  const lead = bytes[index] ?? 0
  const needed =
    lead < 0x80
      ? 1
      : (lead & 0xe0) === 0xc0
        ? 2
        : (lead & 0xf0) === 0xe0
          ? 3
          : (lead & 0xf8) === 0xf0
            ? 4
            : 0
  // 선두 바이트가 아니거나(0) 필요한 만큼 다 있으면 건드리지 않는다.
  if (needed === 0 || trailing + 1 >= needed) return bytes
  return bytes.subarray(0, index)
}
