/**
 * glTF 2.0 읽기 — three 없이 파일만 본다.
 *
 * 그리는 일은 뷰가 three의 `GLTFLoader`로 하고 여기서는 "이 파일이 무엇인지"만 읽는다.
 * 층을 가르는 까닭이 둘이다. 데이터층은 렌더러를 모르고(설계 문서 3장), 무엇보다
 * 이 판단들이 시험으로 굳어야 한다. WebGL도 브라우저도 없는 자리에서 "바깥 파일을
 * 가리키는 glTF"와 "Draco로 압축된 GLB"를 가려낼 수 있어야, 사람이 빈 화면을 보기
 * 전에 무엇이 모자란지 말해 줄 수 있다.
 *
 * GLB는 단순한 상자다. 12바이트 머리(magic·버전·전체 길이) 뒤에 청크가 이어지고,
 * 첫 청크가 JSON, 그다음이 있으면 BIN이다. 청크는 4바이트 경계에 맞춰 채워진다.
 */

import { UnsupportedFileError } from './unsupported'

/** 'glTF'를 리틀엔디언 uint32로 읽은 값. */
const GLB_MAGIC = 0x46546c67
/** 'JSON' */
const CHUNK_JSON = 0x4e4f534a
/** 'BIN\0' */
const CHUNK_BIN = 0x004e4942
const GLB_HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

export type GltfFormat = 'glb' | 'gltf'

export type GltfChunks = {
  /** 파싱한 glTF JSON. */
  readonly json: GltfDocument
  /** GLB의 BIN 청크. `.gltf`(JSON)에는 없다. */
  readonly binary: Uint8Array | null
}

/**
 * 우리가 들여다보는 만큼의 glTF 문서.
 *
 * 규격 전체를 옮겨 적지 않는다. 세어서 보여 줄 것과, 못 연다고 미리 말해야 하는
 * 것만 본다. 나머지 필드는 three가 읽는다.
 */
export type GltfDocument = {
  readonly asset?: { readonly version?: unknown; readonly generator?: unknown }
  readonly scenes?: readonly unknown[]
  readonly nodes?: readonly unknown[]
  readonly meshes?: readonly GltfMesh[]
  readonly materials?: readonly unknown[]
  readonly textures?: readonly unknown[]
  readonly images?: readonly { readonly uri?: unknown }[]
  readonly buffers?: readonly { readonly uri?: unknown }[]
  readonly animations?: readonly unknown[]
  readonly accessors?: readonly { readonly count?: unknown }[]
  readonly extensionsRequired?: readonly unknown[]
  readonly extensionsUsed?: readonly unknown[]
}

export type GltfMesh = {
  readonly primitives?: readonly GltfPrimitive[]
}

export type GltfPrimitive = {
  readonly mode?: unknown
  readonly indices?: unknown
  readonly attributes?: { readonly POSITION?: unknown }
}

/**
 * 우리가 아직 싣지 않은 해제기가 있어야 열리는 확장들.
 *
 * three의 `GLTFLoader`는 재질 확장 대부분을 그냥 읽지만, 압축은 별도 해제기를
 * 붙여야 한다. 붙이지 않으면 조용히 빈 장면이 뜨는 것이 아니라 예외가 난다.
 * 그러니 파일을 열기 전에 세어서 말해 주는 편이 낫다.
 */
const NEEDS_DECODER: Readonly<Record<string, string>> = {
  KHR_draco_mesh_compression: 'Draco로 압축된 메시',
  EXT_meshopt_compression: 'meshopt으로 압축된 메시',
  KHR_texture_basisu: 'KTX2(Basis)로 압축된 텍스처',
}

export type GltfSummary = {
  readonly format: GltfFormat
  readonly version: string
  readonly generator: string | null
  readonly nodes: number
  readonly meshes: number
  readonly primitives: number
  readonly materials: number
  readonly textures: number
  readonly animations: number
  /** 삼각형 수. 인덱스와 그리기 모드로 센 값이라 어림이 아니라 실제 수다. */
  readonly triangles: number
  /** 바깥 파일을 가리키는 uri. GLB로 내보냈으면 비어 있다. */
  readonly externalResources: readonly string[]
  /** 해제기가 있어야 열리는 확장의 사람이 읽을 이름. */
  readonly needsDecoder: readonly string[]
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * 한 덩어리가 그리는 삼각형 수.
 *
 * 인덱스가 있으면 인덱스 수가, 없으면 좌표 수가 기준이다. 모드를 빠뜨리면 기본값이
 * TRIANGLES(4)이므로, 모드가 없는 덩어리를 0으로 세면 흔한 파일이 전부 0이 된다.
 */
function trianglesOfPrimitive(primitive: GltfPrimitive, document: GltfDocument): number {
  const mode = typeof primitive.mode === 'number' ? primitive.mode : 4
  if (mode !== 4 && mode !== 5 && mode !== 6) return 0

  const accessors = document.accessors ?? []
  const accessorAt = (index: unknown): number =>
    typeof index === 'number' ? asCount(accessors[index]?.count) : 0

  const vertices =
    primitive.indices === undefined
      ? accessorAt(primitive.attributes?.POSITION)
      : accessorAt(primitive.indices)
  if (vertices === 0) return 0

  // 띠와 부채는 꼭짓점 하나가 삼각형 하나를 더 만든다.
  return mode === 4 ? Math.floor(vertices / 3) : Math.max(0, vertices - 2)
}

/** 바깥 파일을 가리키는 uri만 고른다. `data:`로 박아 넣은 것은 한 파일 안에 있다. */
function externalUris(document: GltfDocument): string[] {
  const found: string[] = []
  const collect = (uri: unknown) => {
    if (typeof uri !== 'string' || uri === '') return
    if (uri.startsWith('data:')) return
    if (found.includes(uri)) return
    found.push(uri)
  }
  for (const buffer of document.buffers ?? []) collect(buffer?.uri)
  for (const image of document.images ?? []) collect(image?.uri)
  return found
}

export function summarizeGltf(document: GltfDocument, format: GltfFormat): GltfSummary {
  const meshes = document.meshes ?? []
  let primitives = 0
  let triangles = 0
  for (const mesh of meshes) {
    for (const primitive of mesh?.primitives ?? []) {
      primitives += 1
      triangles += trianglesOfPrimitive(primitive, document)
    }
  }

  /*
   * 필수로 적힌 것만이 아니라 쓴다고 적힌 것도 본다. Draco를 `extensionsUsed`에만
   * 올리고 `extensionsRequired`를 비워 둔 내보내기가 실제로 있고, 그래도 해제기가
   * 없으면 못 연다. 필수 목록만 믿으면 그 파일에서 조용히 실패한다.
   */
  const declared = [...(document.extensionsRequired ?? []), ...(document.extensionsUsed ?? [])]
  const needsDecoder: string[] = []
  for (const name of declared) {
    if (typeof name !== 'string') continue
    const label = NEEDS_DECODER[name]
    if (label !== undefined && !needsDecoder.includes(label)) needsDecoder.push(label)
  }

  const version = document.asset?.version
  const generator = document.asset?.generator

  return {
    format,
    version: typeof version === 'string' ? version : '알 수 없음',
    generator: typeof generator === 'string' && generator !== '' ? generator : null,
    nodes: (document.nodes ?? []).length,
    meshes: meshes.length,
    primitives,
    materials: (document.materials ?? []).length,
    textures: (document.textures ?? []).length,
    animations: (document.animations ?? []).length,
    triangles,
    externalResources: externalUris(document),
    needsDecoder,
  }
}

function parseDocument(text: string): GltfDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new UnsupportedFileError(
      '',
      'glTF의 JSON을 읽지 못했습니다. 파일이 온전한지 확인해 주세요.',
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UnsupportedFileError('', 'glTF로 읽지 못했습니다. 최상위가 객체가 아닙니다.')
  }
  const document = parsed as GltfDocument
  const version = document.asset?.version
  // 1.0은 규격이 통째로 다르다. 2.0 읽개로 열면 엉뚱한 자리에서 실패한다.
  if (typeof version === 'string' && !version.startsWith('2')) {
    throw new UnsupportedFileError(
      '',
      `glTF ${version}은(는) 읽지 못합니다. 2.0으로 내보내 주세요.`,
    )
  }
  return document
}

/** `.gltf` — JSON 한 덩어리. 바깥 파일을 가리킬 수 있다. */
export function readGltfJson(text: string): GltfChunks {
  return { json: parseDocument(text), binary: null }
}

/** `.glb` — 청크로 나뉜 이진 상자. */
export function readGlb(buffer: ArrayBuffer): GltfChunks {
  if (buffer.byteLength < GLB_HEADER_BYTES) {
    throw new UnsupportedFileError('', 'GLB로 읽기에는 파일이 너무 짧습니다.')
  }
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new UnsupportedFileError('', 'GLB 파일이 아닙니다. 파일 앞머리에 glTF 표시가 없습니다.')
  }
  const version = view.getUint32(4, true)
  if (version !== 2) {
    throw new UnsupportedFileError(
      '',
      `GLB 버전 ${version}은(는) 읽지 못합니다. 2로 내보내 주세요.`,
    )
  }

  /*
   * 머리에 적힌 전체 길이를 그대로 믿지 않는다. 잘려서 받은 파일은 길이만 온전하고
   * 내용이 모자라며, 그대로 청크를 자르면 엉뚱한 곳을 읽는다. 실제 바이트 수와
   * 견주어 작은 쪽까지만 본다.
   */
  const declared = view.getUint32(8, true)
  const end = Math.min(declared, buffer.byteLength)

  let json: GltfDocument | null = null
  let binary: Uint8Array | null = null
  let offset = GLB_HEADER_BYTES

  while (offset + CHUNK_HEADER_BYTES <= end) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + CHUNK_HEADER_BYTES
    if (start + length > end) {
      throw new UnsupportedFileError(
        '',
        'GLB가 중간에 잘렸습니다. 내려받다 끊기지 않았는지 확인해 주세요.',
      )
    }
    if (type === CHUNK_JSON && json === null) {
      json = parseDocument(new TextDecoder().decode(new Uint8Array(buffer, start, length)))
    } else if (type === CHUNK_BIN && binary === null) {
      binary = new Uint8Array(buffer, start, length)
    }
    // 청크는 4바이트 경계에 맞춰 채워진다. 채움을 건너뛰지 않으면 다음 머리를 놓친다.
    offset = start + length + ((4 - (length % 4)) % 4)
  }

  if (json === null) {
    throw new UnsupportedFileError('', 'GLB 안에서 glTF 정보를 찾지 못했습니다.')
  }
  return { json, binary }
}

/** 파일 앞머리만 보고 GLB인지 가린다. 확장자가 없거나 틀렸을 때 쓴다. */
export function looksLikeGlb(head: Uint8Array): boolean {
  if (head.byteLength < 4) return false
  return (
    head[0] === 0x67 && // g
    head[1] === 0x6c && // l
    head[2] === 0x54 && // T
    head[3] === 0x46 // F
  )
}
