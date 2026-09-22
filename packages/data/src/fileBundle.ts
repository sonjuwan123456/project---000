/**
 * 파일 묶음 — 폴더나 zip 하나를 자산 하나로 여는 자리 (설계 문서 6장 M1).
 *
 * 폴더를 받는 까닭은 "여러 개를 한꺼번에 열려고"가 아니다. 설계 문서 6장이 적은
 * 이유는 하나다 — **모델과 텍스처가 갈라진 glTF·OBJ**. `scene.gltf`는 자기 안에
 * 기하를 들고 있지 않고 `scene.bin`과 그림 파일들을 상대 경로로 가리킨다. 그 파일
 * 하나만 떨어뜨리면 지금은 "바깥 파일 N개가 필요합니다"라는 안내만 뜬다.
 *
 * 그래서 묶음은 **경로 → 파일**의 표다. 여는 것은 그중 하나(`pickPrimary`)이고,
 * 나머지는 그 하나가 가리킬 때 찾아 주는 재료로 남는다.
 *
 * 경로를 맞추는 일이 이 파일의 대부분인데, 그럴 만한 까닭이 있다. glTF의 uri는
 * URL 규칙을 따라서 공백이 `%20`으로 적히고, 내보낸 도구에 따라 `./`나 `../`가
 * 붙고, 윈도에서 만든 파일은 대소문자가 어긋난다. 한 글자만 안 맞아도 텍스처가
 * 통째로 빠진 채 회색 덩어리가 뜬다.
 */

import { resolveFormat, type AssetKind } from './formats'

/**
 * 묶음에 든 파일 하나. 브라우저의 File이 그대로 들어맞는다.
 *
 * `text`까지 있어야 하는 까닭은 묶음에서 고른 파일이 그대로 읽개로 넘어가기 때문이다.
 * 표 읽개는 글자를 달라고 하고 모델 읽개는 바이트를 달라고 하는데, 무엇을 고를지는
 * 열어 보기 전에는 모른다. zip 항목처럼 바이트밖에 없는 자리에서도 바이트에서 글자를
 * 만드는 일은 한 줄이라, 여기서 요구하는 편이 읽개마다 갈라지는 것보다 낫다.
 */
export type BundleFile = {
  readonly name: string
  readonly size?: number
  readonly lastModified?: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export type FileBundle = {
  /** 사람에게 보일 묶음 이름. 폴더 이름이나 zip 파일 이름. */
  readonly label: string
  /** 상대 경로 → 파일. 키는 `normalizePath`를 거친 것이다. */
  readonly files: ReadonlyMap<string, BundleFile>
}

/**
 * 한 묶음에서 받을 파일 수의 상한.
 *
 * 폴더를 통째로 끌어다 놓는 일이 흔하고, 홈 디렉터리를 놓는 실수도 흔하다. 수만
 * 개를 훑기 시작하면 놓은 사람은 아무 소식 없이 굳은 화면만 본다. 모델 하나에
 * 딸린 텍스처는 많아야 수십 개이므로 이 수는 넉넉하다.
 */
export const MAX_BUNDLE_FILES = 2000

/** 묶음에서 빼는 것들. 압축·동기화 도구가 남기는 부스러기다. */
function isJunk(path: string): boolean {
  if (path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) return true
  const base = path.slice(path.lastIndexOf('/') + 1)
  if (base === '' || base.startsWith('.')) return true
  return base === 'Thumbs.db' || base === 'desktop.ini'
}

/**
 * 경로를 견줄 수 있는 모양으로 맞춘다.
 *
 * `%20`을 풀고, 물음표 뒤를 떼고, `.`과 `..`을 접고, 앞의 `/`를 버린다. 역슬래시도
 * 슬래시로 본다 — 윈도에서 만든 zip에 그렇게 들어 있는 것이 있다.
 */
export function normalizePath(path: string): string {
  let text = path.replace(/\\/g, '/')
  const cut = text.search(/[?#]/)
  if (cut !== -1) text = text.slice(0, cut)
  try {
    text = decodeURIComponent(text)
  } catch {
    // 성한 퍼센트 표기가 아니면 적힌 그대로 쓴다. 고쳐 쓰는 것보다 낫다.
  }

  const parts: string[] = []
  for (const piece of text.split('/')) {
    if (piece === '' || piece === '.') continue
    if (piece === '..') {
      parts.pop()
      continue
    }
    parts.push(piece)
  }
  return parts.join('/')
}

/** 묶음을 만든다. 부스러기는 버리고, 상한을 넘으면 거기서 끊는다. */
export function bundleOf(
  label: string,
  entries: Iterable<readonly [string, BundleFile]>,
): FileBundle {
  const files = new Map<string, BundleFile>()
  for (const [path, file] of entries) {
    if (files.size >= MAX_BUNDLE_FILES) break
    const key = normalizePath(path)
    if (key === '' || isJunk(key)) continue
    if (!files.has(key)) files.set(key, file)
  }
  return { label, files }
}

/**
 * 묶음에서 파일 하나를 찾는다.
 *
 * 적힌 그대로 먼저 보고, 없으면 대소문자를 무시하고 한 번 더 본다. 윈도에서 만든
 * glTF가 `Texture.PNG`라고 적어 두고 파일은 `texture.png`인 일이 흔하다. 거기서
 * 포기하면 텍스처 없는 회색 덩어리가 뜨는데, 사람은 그것을 파일 탓이라고 읽지
 * 않고 우리 탓이라고 읽는다.
 *
 * 마지막으로 파일 이름만 견준다. 어떤 도구는 내보낼 때 자기 컴퓨터의 폴더 경로를
 * 통째로 적어 둔다. 이름이 묶음에 하나뿐일 때만 그렇게 잇는다 — 둘 이상이면
 * 어느 것인지 알 수 없으므로 잇지 않는다.
 */
export function findInBundle(bundle: FileBundle, uri: string): BundleFile | null {
  const key = normalizePath(uri)
  if (key === '') return null

  const exact = bundle.files.get(key)
  if (exact !== undefined) return exact

  const lowered = key.toLowerCase()
  let caseless: BundleFile | null = null
  const base = lowered.slice(lowered.lastIndexOf('/') + 1)
  let byName: BundleFile | null = null
  let byNameCount = 0

  for (const [path, file] of bundle.files) {
    const candidate = path.toLowerCase()
    if (caseless === null && candidate === lowered) caseless = file
    if (candidate.slice(candidate.lastIndexOf('/') + 1) === base) {
      byName = file
      byNameCount += 1
    }
  }

  if (caseless !== null) return caseless
  return byNameCount === 1 ? byName : null
}

/** 묶음에 든 바이트의 합. 크기 안전장치가 보는 값이다. 모르는 파일은 0으로 센다. */
export function bundleBytes(bundle: FileBundle): number {
  let total = 0
  for (const file of bundle.files.values()) total += file.size ?? 0
  return total
}

/**
 * 종류별 우선순위. 작을수록 먼저다.
 *
 * 모델이 제일 앞인 까닭은 묶음이 존재하는 이유 자체가 갈라진 모델이기 때문이다.
 * 표가 그다음이고, 글자는 맨 뒤다 — 모델 폴더에는 README가 거의 언제나 같이 있고,
 * 그것을 열어 주면 사람이 기대한 것과 가장 멀다.
 */
const KIND_ORDER: Readonly<Record<AssetKind, number>> = { model: 0, table: 1, text: 2 }

type Candidate = { readonly path: string; readonly file: BundleFile; readonly kind: AssetKind }

/**
 * 묶음에서 무엇을 열지 고른다. 열 만한 것이 없으면 null.
 *
 * 규칙은 셋이고 순서대로 본다. 종류(모델 → 표 → 글자), 얕은 경로, 이름순. 마지막
 * 둘은 정하기 위한 규칙이다 — 어느 쪽이 더 옳아서가 아니라, **같은 폴더를 두 번
 * 열면 같은 것이 떠야** 하기 때문이다.
 *
 * 아직 못 읽는 형식(`planned`)은 고르지 않는다. 폴더에 Parquet이 하나 들어 있다고
 * 해서 "아직 못 읽습니다"를 띄우고 끝내면, 같이 든 CSV는 열어 보지도 못한다.
 */
export function pickPrimary(bundle: FileBundle): { path: string; file: BundleFile } | null {
  const candidates: Candidate[] = []
  for (const [path, file] of bundle.files) {
    const format = resolveFormat(path)
    if (format === null || format.planned !== undefined) continue
    candidates.push({ path, file, kind: format.kind })
  }
  if (candidates.length === 0) return null

  const depthOf = (path: string) => path.split('/').length
  candidates.sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    if (byKind !== 0) return byKind
    const byDepth = depthOf(left.path) - depthOf(right.path)
    if (byDepth !== 0) return byDepth
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  })

  const best = candidates[0]
  return best === undefined ? null : { path: best.path, file: best.file }
}

/** 묶음에서 그 uri들을 찾아 바이트로 푼다. 못 찾은 것은 `missing`에 남는다. */
export async function resolveResources(
  bundle: FileBundle,
  uris: readonly string[],
): Promise<{ found: Map<string, ArrayBuffer>; missing: string[] }> {
  const found = new Map<string, ArrayBuffer>()
  const missing: string[] = []
  for (const uri of uris) {
    const file = findInBundle(bundle, uri)
    if (file === null) {
      missing.push(uri)
      continue
    }
    try {
      found.set(uri, await file.arrayBuffer())
    } catch {
      missing.push(uri)
    }
  }
  return { found, missing }
}
