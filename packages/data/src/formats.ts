/**
 * 형식 표 — "이 파일을 무엇으로 읽나"를 한 자리에서 답한다.
 *
 * 설계 문서 6장이 M1에 둔 로더 레지스트리의 알맹이다. 지금까지는 `readTableFile` 안의
 * 확장자 if문이 그 일을 했는데, 표가 아닌 형식이 들어오는 순간 그 자리가 맞지 않게
 * 된다. 표 읽개가 GLB를 알아야 할 이유가 없다.
 *
 * 표를 하나 더 두는 값은 M4에서 돌아온다. Parquet·XLSX·OBJ·이미지·PDF를 붙이는 일이
 * 여기 줄 하나 더하고 읽개 하나 쓰는 일이 된다. 아직 못 읽는 형식도 등록해 두면
 * "안 됩니다" 대신 무엇이 필요한지 말하게 된다.
 *
 * 읽개 함수는 여기 없다. 이 파일이 읽개를 알면 읽개도 이 파일을 알아야 해서 고리가
 * 생긴다. 고르는 일과 읽는 일을 갈라 두고, 잇는 것은 `loaderRegistry`가 한다.
 */

import { looksLikeGlb } from './gltf'

export type AssetKind = 'table' | 'model' | 'text'

export type FormatEntry = {
  readonly id: string
  /** 사람에게 보일 이름. 받는 형식을 늘어놓을 때 쓴다. */
  readonly label: string
  readonly kind: AssetKind
  readonly extensions: readonly string[]
  /** 확장자로 못 가렸을 때 앞머리 바이트로 맞힌다. */
  readonly sniff?: (head: Uint8Array) => boolean
  /**
   * 아직 못 읽는 형식이면 그 까닭. 등록은 해 두고 열지는 않는다.
   * 추측해서 여는 것보다 무엇이 필요한지 말하는 편이 낫다(설계 문서 6장).
   */
  readonly planned?: string
}

/**
 * 등록된 형식들. 위에서부터 찾으므로 순서가 곧 확장자가 겹칠 때의 우선순위다.
 *
 * `planned`가 달린 줄은 M4가 채울 자리다. 지금 지우면 그 형식을 떨어뜨린 사람이
 * "못 읽습니다" 한 줄만 받는다.
 */
export const FORMATS: readonly FormatEntry[] = [
  { id: 'delimited', label: 'CSV·TSV', kind: 'table', extensions: ['csv', 'tsv', 'txt'] },
  { id: 'json', label: 'JSON', kind: 'table', extensions: ['json'] },
  { id: 'json-lines', label: 'JSON Lines', kind: 'table', extensions: ['jsonl', 'ndjson'] },
  { id: 'gltf-binary', label: 'GLB', kind: 'model', extensions: ['glb'], sniff: looksLikeGlb },
  { id: 'gltf-json', label: 'glTF', kind: 'model', extensions: ['gltf'] },

  // ── 아직 못 읽는 것들. M4 형식 확장이 순서대로 채운다. ──
  {
    id: 'parquet',
    label: 'Parquet',
    kind: 'table',
    extensions: ['parquet'],
    planned: 'Parquet은 아직 읽지 못합니다. CSV로 내보내거나 조금 더 기다려 주세요.',
  },
  {
    id: 'xlsx',
    label: 'XLSX',
    kind: 'table',
    extensions: ['xlsx', 'xls'],
    planned: '엑셀 파일은 아직 읽지 못합니다. CSV로 내보내 주세요.',
  },
  {
    id: 'wavefront',
    label: 'OBJ',
    kind: 'model',
    extensions: ['obj', 'mtl'],
    planned: 'OBJ는 아직 읽지 못합니다. GLB로 내보내면 지금도 열립니다.',
  },
  {
    id: 'filmbox',
    label: 'FBX',
    kind: 'model',
    extensions: ['fbx'],
    planned:
      'FBX는 아직 읽지 못합니다. GLB로 내보내 주세요. FBX는 재질과 애니메이션이 옮겨지다 깨지는 일이 잦아, 나중에 받더라도 GLB를 권합니다.',
  },
  {
    id: 'stl',
    label: 'STL',
    kind: 'model',
    extensions: ['stl'],
    planned: 'STL은 아직 읽지 못합니다. GLB로 내보내면 지금도 열립니다.',
  },
  {
    id: 'blender',
    label: '블렌더',
    kind: 'model',
    extensions: ['blend'],
    planned:
      '블렌더 파일은 브라우저에서 열지 못합니다. 블렌더에서 파일 > 내보내기 > glTF 2.0을 고르고, 형식을 glTF Binary(.glb)로 두면 재질까지 그대로 옵니다.',
  },
  {
    id: 'image',
    label: '이미지',
    kind: 'text',
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    planned: '이미지 패널은 아직 없습니다.',
  },
  {
    id: 'pdf',
    label: 'PDF',
    kind: 'text',
    extensions: ['pdf'],
    planned: '문서 패널은 아직 없습니다.',
  },
]

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 확장자와 앞머리로 형식을 고른다. 못 고르면 null. */
export function resolveFormat(name: string, head?: Uint8Array): FormatEntry | null {
  const extension = extensionOf(name)
  if (extension !== '') {
    const byExtension = FORMATS.find((format) => format.extensions.includes(extension))
    if (byExtension !== undefined) return byExtension
  }

  /*
   * 확장자가 없거나 모르는 것이면 내용을 본다. 확장자가 맞을 때도 늘 보지는 않는
   * 까닭은 값 때문이다. 5만 행짜리 CSV의 앞머리를 떼어 읽는 일을 매번 할 이유가 없다.
   */
  if (head !== undefined) {
    const bySniff = FORMATS.find((format) => format.sniff?.(head) === true)
    if (bySniff !== undefined) return bySniff
  }

  // 확장자가 아예 없으면 표로 본다. 예전부터 그랬고, 이름 없는 내보내기가 대개 그렇다.
  return extension === '' ? (FORMATS.find((format) => format.id === 'delimited') ?? null) : null
}

/** 아직 못 읽는 형식이면 그 까닭. 읽을 수 있거나 모르는 형식이면 null. */
export function plannedMessage(name: string): string | null {
  const extension = extensionOf(name)
  if (extension === '') return null
  const format = FORMATS.find((one) => one.extensions.includes(extension))
  return format?.planned ?? null
}

/** 사람에게 보여 줄 "받는 형식" 목록. 아직 못 읽는 것은 빼고 센다. */
export function supportedLabels(): readonly string[] {
  const labels: string[] = []
  for (const format of FORMATS) {
    if (format.planned !== undefined) continue
    if (!labels.includes(format.label)) labels.push(format.label)
  }
  return labels
}
