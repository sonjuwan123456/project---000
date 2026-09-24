/**
 * 3D 모델 형식이 무엇이든 데이터층이 세어 두는 것.
 *
 * 처음에는 glTF만 있어서 `GltfSummary`가 이 자리였다. OBJ와 STL이 들어오면서 형식을
 * 가리지 않는 판을 따로 둔다. 화면과 안내는 이 판만 보고, 버전처럼 glTF에만 있는
 * 값은 `GltfSummary`에 남는다.
 */

import type { GltfFormat } from './gltf'

export type ModelFormat = GltfFormat | 'obj' | 'stl'

export type ModelSummary = {
  readonly format: ModelFormat
  /** 파일에 적힌 만든 도구. 모르면 null. */
  readonly generator: string | null
  readonly nodes: number
  readonly meshes: number
  readonly primitives: number
  readonly materials: number
  readonly textures: number
  readonly animations: number
  /** 삼각형 수. 면을 세어 낸 실제 수다. */
  readonly triangles: number
  /** 바깥 파일을 가리키는 이름. 한 파일에 다 담겼으면 비어 있다. */
  readonly externalResources: readonly string[]
  /** 해제기가 있어야 열리는 것의 사람이 읽을 이름. */
  readonly needsDecoder: readonly string[]
}

/** 사람에게 보일 형식 이름. */
export const MODEL_FORMAT_LABELS: Readonly<Record<ModelFormat, string>> = {
  glb: 'GLB',
  gltf: 'glTF',
  obj: 'OBJ',
  stl: 'STL',
}
