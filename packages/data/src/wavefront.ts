/**
 * OBJ(Wavefront) 읽기 — three 없이 글자만 본다.
 *
 * glTF와 같은 까닭으로 그리는 일은 뷰가 three의 `OBJLoader`로 하고, 여기서는 무엇이
 * 들었는지와 무엇을 더 찾아야 하는지만 센다. OBJ는 한 줄에 한 가지를 적는 글자
 * 파일이라 세는 일이 가볍다. `v`는 꼭짓점, `f`는 면, `o`와 `g`는 덩어리의 시작,
 * `usemtl`은 재질 이름, `mtllib`은 재질이 적힌 바깥 파일(.mtl)이다.
 *
 * 재질의 색과 텍스처는 OBJ 안에 없다. `.mtl`에 있고, 텍스처 그림은 다시 `.mtl`이
 * 가리킨다. 그래서 바깥 파일을 두 번에 나눠 찾는다 — 먼저 `.mtl`, 그 안을 읽고 그림.
 *
 * 줄을 가르는 규칙은 three의 `OBJLoader`·`MTLLoader`를 그대로 따른다. 여기서 센 것과
 * 화면에 뜬 것이 달라지면 안 되고, 무엇보다 바깥 파일의 이름이 three가 물어 올
 * 이름과 글자 하나까지 같아야 묶음에서 찾아 줄 수 있다.
 */

import type { ModelSummary } from './modelSummary'

/** 첫 줄 주석을 만든 곳으로 보여 줄 때의 최대 길이. 넘으면 설명문이지 도구 이름이 아니다. */
const GENERATOR_MAX_LENGTH = 80

/** three의 `OBJLoader`처럼 줄 끝의 역슬래시 이음을 먼저 푼다. */
function linesOf(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\\\n/g, '').split('\n')
}

/** 한 줄 맨 앞 낱말과 나머지. `OBJLoader`가 쓰는 것과 같게 앞뒤 공백을 걷는다. */
function keyOf(line: string): { key: string; rest: string } {
  const trimmed = line.trimStart()
  const space = trimmed.search(/\s/)
  if (space === -1) return { key: trimmed, rest: '' }
  return { key: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() }
}

/**
 * 글자로 된 OBJ를 세어 요약을 낸다.
 *
 * 덩어리 수는 `OBJLoader`가 실제로 만드는 메시 수다. `o`나 `g`가 나올 때마다 새
 * 덩어리가 시작되고, 면이 하나도 없는 덩어리는 버려진다.
 *
 * 면 하나가 꼭짓점 k개면 삼각형 k-2개다. `OBJLoader`가 부채꼴로 쪼개는 방식과 같다.
 */
export function summarizeObj(text: string): ModelSummary {
  const lines = linesOf(text)
  const materials = new Set<string>()
  const libraries: string[] = []
  let meshes = 0
  let facesInBlock = 0
  let triangles = 0
  let declared = false

  const closeBlock = () => {
    if (facesInBlock > 0) meshes += 1
    facesInBlock = 0
  }

  for (const line of lines) {
    const { key, rest } = keyOf(line)
    if (key === 'f') {
      const corners = rest === '' ? 0 : rest.split(/\s+/).length
      if (corners >= 3) {
        triangles += corners - 2
        facesInBlock += 1
      }
    } else if (key === 'o' || key === 'g') {
      /*
       * 첫 선언은 새 덩어리를 열지 않는다. `OBJLoader`는 선언 전에 만든 이름 없는
       * 덩어리에 그 이름을 붙이고 이어 쓴다. 그 앞에 면이 있었어도 한 메시가 된다.
       */
      if (declared) closeBlock()
      declared = true
    } else if (key === 'usemtl') {
      if (rest !== '') materials.add(rest)
    } else if (key === 'mtllib') {
      if (rest !== '' && !libraries.includes(rest)) libraries.push(rest)
    }
  }
  closeBlock()

  return {
    format: 'obj',
    generator: generatorOf(lines[0] ?? ''),
    nodes: meshes,
    meshes,
    primitives: meshes,
    materials: materials.size,
    // 텍스처는 `.mtl`을 읽어야 안다. 찾은 뒤에 `readModelFile`이 채운다.
    textures: 0,
    animations: 0,
    triangles,
    externalResources: libraries,
    needsDecoder: [],
  }
}

/**
 * 첫 줄이 주석이면 만든 곳으로 본다.
 *
 * 블렌더는 "# Blender 4.2.0", 3ds Max는 "# 3ds Max Wavefront OBJ Exporter"를 첫 줄에
 * 적는다. 첫 줄만 보는 까닭은 그 아래 주석이 대개 저작권 문구나 설명이기 때문이다.
 */
function generatorOf(first: string): string | null {
  const trimmed = first.trim()
  if (!trimmed.startsWith('#')) return null
  const body = trimmed.replace(/^#+/, '').trim()
  if (body === '' || body.length > GENERATOR_MAX_LENGTH) return null
  return body
}

/** `MTLLoader`가 텍스처로 불러오는 줄들. 이 밖의 `map_`은 three가 읽지 않는다. */
const TEXTURE_KEYS = new Set([
  'map_kd',
  'map_ks',
  'map_ke',
  'norm',
  'map_bump',
  'bump',
  'disp',
  'map_d',
])

/**
 * 텍스처 줄에서 파일 이름만 떼어 낸다.
 *
 * `MTLLoader.getTextureParams`와 같은 순서로 선택 인자(`-bm`, `-mm`, `-s`, `-o`)를
 * 걷어 낸다. 더 똑똑하게 떼어 낼 수도 있지만, three가 물어 올 이름이 이것이라
 * 여기서 다르게 떼면 묶음에서 찾아도 이어 주지 못한다.
 */
function textureNameOf(value: string): string {
  const items = value.split(/\s+/)
  const drop = (flag: string, count: number) => {
    const at = items.indexOf(flag)
    if (at >= 0) items.splice(at, count)
  }
  drop('-bm', 2)
  drop('-mm', 3)
  drop('-s', 4)
  drop('-o', 4)
  return items.join(' ').trim()
}

/** `.mtl`이 가리키는 텍스처 이름들. 같은 그림을 두 재질이 써도 한 번만 센다. */
export function texturesOfMtl(text: string): string[] {
  const found: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const space = line.indexOf(' ')
    if (space === -1) continue
    const key = line.slice(0, space).toLowerCase()
    if (!TEXTURE_KEYS.has(key)) continue
    const name = textureNameOf(line.slice(space + 1).trim())
    // 주소로 적힌 것은 three가 그대로 받아 오러 간다. 묶음에서 찾을 것이 아니다.
    if (name === '' || /^https?:\/\//i.test(name)) continue
    if (!found.includes(name)) found.push(name)
  }
  return found
}
