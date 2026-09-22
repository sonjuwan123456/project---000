/**
 * 바이트를 three 장면으로 푸는 일과 그 뒤처리 — 모델 뷰와 썸네일이 함께 쓴다.
 *
 * 여기 모은 까닭은 뒤처리 때문이다. glTF를 푸는 데에는 눈에 안 보이는 빚이 둘 붙는다.
 * 바깥 파일을 물릴 때 만든 Blob 주소는 탭이 닫힐 때까지 살아 있고, three는 참조가
 * 끊겨도 GPU 자원을 스스로 반납하지 않는다. 푸는 코드를 두 군데에 적으면 갚는 코드도
 * 두 군데에 적게 되고, 한쪽에서 빠뜨리면 모델을 몇 개 갈아 끼우는 사이에 탭이 죽는다.
 */

import { Group, LoadingManager, Mesh, type Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { normalizePath } from '@holo/data'

/**
 * 바깥 파일을 브라우저가 받아들일 주소로 바꿔 준다.
 *
 * three는 uri를 주소로 보고 받아 오려 한다. 파일은 이미 손에 있으므로 받아 올 곳이
 * 없고, 그래서 한때 `.gltf`는 그 자리에서 실패했다. `LoadingManager`의 주소
 * 바꿔치기로 그 요청을 우리가 쥔 바이트로 돌린다.
 *
 * MIME 종류를 붙이는 까닭은 텍스처 때문이다. 종류 없는 Blob 주소를 `<img>`에 물리면
 * 브라우저가 내용을 보고 맞히기는 하지만, 확장자를 아는데 굳이 맡길 이유가 없다.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ktx2: 'image/ktx2',
  bin: 'application/octet-stream',
}

export function mimeOf(uri: string): string {
  const clean = uri.split(/[?#]/)[0] ?? ''
  const dot = clean.lastIndexOf('.')
  const extension = dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/** 적힌 그대로 먼저 찾고, 안 되면 `./`와 `%20`을 풀어서 한 번 더 찾는다. */
function resourceFor(
  resources: ReadonlyMap<string, ArrayBuffer>,
  normalized: ReadonlyMap<string, ArrayBuffer>,
  url: string,
): ArrayBuffer | undefined {
  return resources.get(url) ?? normalized.get(normalizePath(url))
}

/** 바깥 파일을 Blob 주소로 물려 주는 관리자와, 거둘 주소 목록. */
export function managerFor(resources: ReadonlyMap<string, ArrayBuffer> | undefined): {
  manager: LoadingManager
  handed: string[]
} {
  const handed: string[] = []
  const manager = new LoadingManager()
  if (resources === undefined || resources.size === 0) return { manager, handed }

  const normalized = new Map<string, ArrayBuffer>()
  for (const [uri, buffer] of resources) normalized.set(normalizePath(uri), buffer)
  manager.setURLModifier((url) => {
    const buffer = resourceFor(resources, normalized, url)
    if (buffer === undefined) return url
    const handle = URL.createObjectURL(new Blob([buffer], { type: mimeOf(url) }))
    handed.push(handle)
    return handle
  })
  return { manager, handed }
}

/**
 * 장면이 쥔 GPU 자원을 돌려준다.
 *
 * 재질이 쥔 텍스처는 이름이 제각각(`map`, `normalMap`, `emissiveMap`…)이라 값으로
 * 가린다. 이름을 적어 두면 새 재질이 들어올 때마다 조용히 새는 자리가 생긴다.
 */
export function disposeScene(root: Group): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value !== null && typeof value === 'object' && 'isTexture' in value) {
          ;(value as { dispose(): void }).dispose()
        }
      }
      material.dispose()
    }
  })
}

/**
 * 바이트를 장면으로 푼다.
 *
 * `parse`를 쓰고 `load`를 쓰지 않는다. 파일은 이미 손에 있고, 주소로 다시 받아 올
 * 것이 없기 때문이다.
 */
export function parseGltf(
  bytes: ArrayBuffer,
  resources: ReadonlyMap<string, ArrayBuffer> | undefined,
): { scene: Promise<Group>; release(): void } {
  const { manager, handed } = managerFor(resources)
  const scene = new Promise<Group>((resolve, reject) => {
    new GLTFLoader(manager).parse(
      bytes,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    )
  })
  return {
    scene,
    release() {
      for (const handle of handed) URL.revokeObjectURL(handle)
    },
  }
}
