/**
 * 형식이 무엇이든 바이트를 three 장면으로 푼다 — 모델 뷰와 썸네일의 입구.
 *
 * glTF는 `gltfParse`가 맡고, 여기서는 OBJ와 STL을 같은 모양(장면 하나와 뒤처리
 * 하나)으로 맞춰 낸다. 부르는 쪽은 형식을 넘기기만 하고 무엇으로 풀었는지 모른다.
 *
 * 두 형식 다 glTF와 달리 재질을 제대로 들고 오지 않는다. 그래서 여기서 무대에 맞게
 * 손본다. 무대의 원본 모드와 썸네일은 방 조명(환경맵) 하나로 비추는데, 그 빛은
 * `MeshStandardMaterial`만 받는다. OBJ가 주는 `MeshPhongMaterial`을 그대로 두면
 * 썸네일은 새까맣고, 무대는 직사광이 닿는 한쪽만 밝다.
 */

import {
  DoubleSide,
  Group,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  type LoadingManager,
  type Material,
} from 'three'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { holoColors } from '@holo/core'
import type { ModelFormat } from '@holo/data'
import { findResource, managerFor, parseGltf } from './gltfParse'

export type ParsedModel = { scene: Promise<Group>; release(): void }

/** MTL의 광택(Ns, 0~1000)을 거칠기(0~1)로 옮긴다. 셀수록 매끈하다. */
function roughnessOf(shininess: number): number {
  const shine = Math.min(Math.max(shininess / 1000, 0), 1)
  return 1 - Math.sqrt(shine)
}

/**
 * Phong 재질을 같은 색과 그림을 쓰는 Standard 재질로 바꾼다.
 *
 * 텍스처는 옮겨 쥐기만 하고 새로 만들지 않는다. 아직 받는 중인 그림도 있는데, 받기가
 * 끝나면 three가 그 텍스처 객체에 그림을 채우므로 쥔 쪽이 누구든 제대로 보인다.
 */
function toStandard(phong: MeshPhongMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial({
    name: phong.name,
    color: phong.color,
    map: phong.map,
    normalMap: phong.normalMap,
    bumpMap: phong.bumpMap,
    bumpScale: phong.bumpScale,
    alphaMap: phong.alphaMap,
    displacementMap: phong.displacementMap,
    emissive: phong.emissive,
    emissiveMap: phong.emissiveMap,
    opacity: phong.opacity,
    transparent: phong.transparent,
    side: phong.side,
    vertexColors: phong.vertexColors,
    flatShading: phong.flatShading,
    roughness: roughnessOf(phong.shininess),
    metalness: 0,
  })
}

/**
 * 장면의 Phong 재질을 모두 Standard로 갈아 끼운다.
 *
 * 여러 메시가 한 재질을 같이 쓰는 일이 흔해서(같은 `usemtl`), 바꾼 것을 기억해 두고
 * 같은 것은 같은 것으로 바꾼다. 그래야 버릴 때도 한 번만 버린다.
 */
function withStandardMaterials(root: Group): void {
  const swapped = new Map<Material, Material>()
  const swap = (material: Material): Material => {
    if (!(material instanceof MeshPhongMaterial)) return material
    const known = swapped.get(material)
    if (known !== undefined) return known
    const next = toStandard(material)
    swapped.set(material, next)
    return next
  }
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const current = object.material as Material | Material[]
    object.material = Array.isArray(current) ? current.map(swap) : swap(current)
  })
  for (const old of swapped.keys()) old.dispose()
}

/** OBJ가 가리키는 `.mtl` 이름들. `OBJLoader`처럼 `mtllib` 뒤를 통째로 이름으로 본다. */
function librariesOf(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*\r?$/gm)) {
    const name = match[1] ?? ''
    if (name !== '' && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * 찾아 온 `.mtl`들로 재질 만들개 하나를 세운다. 하나도 없으면 null.
 *
 * `OBJLoader`는 만들개를 하나만 받는다. `.mtl`이 여럿이면 재질 표를 합쳐 하나로
 * 만든다. 이름이 겹치면 뒤의 것이 이긴다 — three도 마지막 `mtllib`을 본다.
 */
function materialsFor(
  libraries: readonly string[],
  resources: ReadonlyMap<string, ArrayBuffer> | undefined,
  manager: LoadingManager,
): ReturnType<MTLLoader['parse']> | null {
  if (resources === undefined) return null
  const decoder = new TextDecoder()
  let creator: ReturnType<MTLLoader['parse']> | null = null
  let merged = {}
  for (const library of libraries) {
    const bytes = findResource(resources, library)
    if (bytes === undefined) continue
    const next = new MTLLoader(manager).parse(decoder.decode(bytes), '')
    merged = { ...merged, ...next.materialsInfo }
    creator ??= next
  }
  if (creator === null) return null
  creator.setMaterials(merged)
  return creator
}

/**
 * OBJ를 푼다.
 *
 * 텍스처는 `preload`가 받기 시작하고 나중에 채워진다. 무대는 그래도 되지만 썸네일은
 * 한 번 그리고 끝이라, 그림이 다 올 때까지 장면을 내주지 않고 기다린다. 받을 것이
 * 없으면 그 자리에서 내준다.
 */
function parseObj(
  bytes: ArrayBuffer,
  resources: ReadonlyMap<string, ArrayBuffer> | undefined,
): ParsedModel {
  const { manager, handed } = managerFor(resources)
  const scene = new Promise<Group>((resolve, reject) => {
    try {
      const text = new TextDecoder().decode(bytes)
      let waiting = false
      manager.onStart = () => {
        waiting = true
      }

      const loader = new OBJLoader(manager)
      const creator = materialsFor(librariesOf(text), resources, manager)
      if (creator !== null) {
        creator.preload()
        loader.setMaterials(creator)
      }
      const root = loader.parse(text)
      withStandardMaterials(root)

      if (!waiting) {
        resolve(root)
        return
      }
      // 못 받은 그림이 있어도 끝은 온다. three는 실패한 것도 끝난 것으로 센다.
      manager.onLoad = () => resolve(root)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  return {
    scene,
    release() {
      for (const handle of handed) URL.revokeObjectURL(handle)
    },
  }
}

/**
 * STL을 푼다.
 *
 * STL에는 색이 없으니 한 가지 색을 입힌다. 이진판에 드물게 꼭짓점 색이 들어 있으면
 * 그 색을 쓴다.
 *
 * **눕혀서 받는다.** STL은 3D 프린터와 CAD에서 오는 파일이라 Z축이 위다. three는 Y축이
 * 위라, 그대로 두면 받은 모형이 전부 뒤로 드러누워 보인다. three 예제도 같은 까닭으로
 * X축으로 -90도 돌린다.
 */
function parseStl(bytes: ArrayBuffer): ParsedModel {
  const scene = new Promise<Group>((resolve, reject) => {
    try {
      const geometry = new STLLoader().parse(bytes)
      /*
       * 법선을 면에서 다시 구한다. 파일에 적힌 법선을 0으로 비워 두는 내보내기가 있고,
       * 그대로 쓰면 빛을 못 받아 새까만 덩어리가 된다. 꼭짓점을 나눠 쓰지 않는 도형이라
       * 다시 구해도 면마다 평평한 법선이 나온다 — 적혀 있었을 값과 같다.
       */
      geometry.computeVertexNormals()
      const colored = 'hasColors' in geometry && geometry.hasColors === true
      const material = new MeshStandardMaterial({
        color: colored ? '#ffffff' : holoColors.dim,
        vertexColors: colored,
        roughness: 0.55,
        metalness: 0.05,
        // 면의 앞뒤가 뒤섞인 STL이 흔하다. 재질 정보가 없으니 양면을 다 그린다.
        side: DoubleSide,
      })
      const mesh = new Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      const root = new Group()
      root.add(mesh)
      resolve(root)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  return { scene, release() {} }
}

/** 형식에 맞는 읽개로 바이트를 장면으로 푼다. */
export function parseModel(
  format: ModelFormat,
  bytes: ArrayBuffer,
  resources: ReadonlyMap<string, ArrayBuffer> | undefined,
): ParsedModel {
  if (format === 'obj') return parseObj(bytes, resources)
  if (format === 'stl') return parseStl(bytes)
  return parseGltf(bytes, resources)
}
