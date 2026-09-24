/**
 * STL 읽기 — three 없이 바이트만 본다.
 *
 * STL은 삼각형만 늘어놓은 형식이다. 색도 재질도 이름 붙은 덩어리도 거의 없고, 3D
 * 프린터와 CAD가 주고받는 데 쓴다. 이진판과 글자판 두 가지가 있다.
 *
 * - 이진판: 80바이트 머리, 삼각형 수(uint32), 그 뒤로 삼각형마다 50바이트.
 * - 글자판: `solid 이름` … `facet normal` … `endfacet` … `endsolid`.
 *
 * 둘을 가리는 규칙은 three의 `STLLoader`를 그대로 따른다. 이진판인데 머리 80바이트를
 * "solid"로 시작하게 적는 내보내기가 흔해서, 앞머리만 보면 틀린다. 크기가 이진판
 * 공식에 딱 맞으면 이진판이고, 아니면 그때 "solid"를 본다.
 */

import type { ModelSummary } from './modelSummary'
import { UnsupportedFileError } from './unsupported'

const HEADER_BYTES = 80
const COUNT_BYTES = 4
/** 법선 3개, 꼭짓점 3개(각 float 3개), 속성 2바이트. */
const FACE_BYTES = 12 + 36 + 2

/** "solid"가 앞머리 다섯 자리 안에서 시작하는지. BOM이 앞에 붙는 파일이 있다. */
function startsWithSolid(bytes: Uint8Array): boolean {
  const solid = [0x73, 0x6f, 0x6c, 0x69, 0x64]
  for (let offset = 0; offset < 5; offset += 1) {
    if (solid.every((code, index) => bytes[offset + index] === code)) return true
  }
  return false
}

/** 이진판인지. `STLLoader.isBinary`와 같은 판단이다. */
export function isBinaryStl(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if (buffer.byteLength >= HEADER_BYTES + COUNT_BYTES) {
    const faces = new DataView(buffer).getUint32(HEADER_BYTES, true)
    if (HEADER_BYTES + COUNT_BYTES + faces * FACE_BYTES === buffer.byteLength) return true
  }
  return !startsWithSolid(bytes)
}

/**
 * 요약 한 장. 메시는 언제나 하나다 — `STLLoader`는 글자판에 `solid`가 여럿이어도
 * 한 도형에 묶음(group)으로 담는다. 몇 덩어리였는지는 `primitives`에 남긴다.
 */
function summaryOf(solids: number, triangles: number): ModelSummary {
  const meshes = triangles > 0 ? 1 : 0
  return {
    format: 'stl',
    generator: null,
    nodes: meshes,
    meshes,
    primitives: solids,
    materials: 0,
    textures: 0,
    animations: 0,
    triangles,
    externalResources: [],
    needsDecoder: [],
  }
}

/**
 * STL을 세어 요약을 낸다.
 *
 * 글자판은 `STLLoader`와 같은 정규식으로 센다. `endsolid`가 없는 글자판(중간에 잘린
 * 파일)은 three가 면을 하나도 못 찾으므로 여기서도 0으로 센다 — 센 것과 그려진
 * 것이 같아야 한다.
 */
export function summarizeStl(buffer: ArrayBuffer): ModelSummary {
  if (isBinaryStl(buffer)) {
    if (buffer.byteLength < HEADER_BYTES + COUNT_BYTES) {
      throw new UnsupportedFileError('', 'STL로 읽기에는 파일이 너무 짧습니다.')
    }
    const faces = new DataView(buffer).getUint32(HEADER_BYTES, true)
    const needed = HEADER_BYTES + COUNT_BYTES + faces * FACE_BYTES
    if (needed > buffer.byteLength) {
      throw new UnsupportedFileError(
        '',
        'STL이 중간에 잘렸습니다. 내려받다 끊기지 않았는지 확인해 주세요.',
      )
    }
    return summaryOf(faces > 0 ? 1 : 0, faces)
  }

  const text = new TextDecoder().decode(buffer)
  let solids = 0
  let triangles = 0
  for (const solid of text.matchAll(/solid([\s\S]*?)endsolid/g)) {
    const faces = [...(solid[1] ?? '').matchAll(/facet([\s\S]*?)endfacet/g)].length
    if (faces > 0) solids += 1
    triangles += faces
  }
  return summaryOf(solids, triangles)
}
