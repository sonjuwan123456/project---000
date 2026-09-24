import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Group, Mesh, MeshStandardMaterial, Vector3, type Material } from 'three'
import { describe, expect, it } from 'vitest'
import { summarizeObj, summarizeStl } from '@holo/data'
import { parseModel } from './modelParse'

const sample = (name: string): ArrayBuffer => {
  const bytes = readFileSync(fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url)))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

function meshesOf(root: Group): Mesh[] {
  const found: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) found.push(object)
  })
  return found
}

function materialsOf(mesh: Mesh): Material[] {
  const material = mesh.material as Material | Material[]
  return Array.isArray(material) ? material : [material]
}

const trianglesOf = (meshes: readonly Mesh[]) =>
  meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0) / 3, 0)

/*
 * 데이터층은 three 없이 세고, 뷰는 three로 그린다. 두 쪽이 따로 세는 셈이라 어긋나면
 * 패널에 적힌 수와 화면에 뜬 것이 달라진다. 같은 파일을 두 길로 세어 견준다.
 */
describe('데이터층이 센 것과 three가 그린 것이 같다', () => {
  it('OBJ 샘플', async () => {
    const bytes = sample('모형-obj/상자.obj')
    const summary = summarizeObj(new TextDecoder().decode(bytes))
    const meshes = meshesOf(await parseModel('obj', bytes, undefined).scene)
    expect(meshes).toHaveLength(summary.meshes)
    expect(trianglesOf(meshes)).toBe(summary.triangles)
  })

  it('STL 샘플', async () => {
    const bytes = sample('부품.stl')
    const summary = summarizeStl(bytes)
    const meshes = meshesOf(await parseModel('stl', bytes, undefined).scene)
    expect(meshes).toHaveLength(summary.meshes)
    expect(trianglesOf(meshes)).toBe(summary.triangles)
  })
})

describe('parseModel · OBJ', () => {
  const obj = [
    'mtllib 색.mtl',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'o 하나',
    'usemtl 빨강',
    'f 1 2 3',
    'o 둘',
    'usemtl 빨강',
    'f 1 3 4',
  ].join('\n')
  const mtl = 'newmtl 빨강\nKd 1 0 0\nNs 250\n'

  /*
   * 방 조명(환경맵)은 Standard 재질만 받는다. Phong을 그대로 두면 썸네일이 까맣다.
   */
  it('재질을 모두 Standard로 바꾼다', async () => {
    const root = await parseModel('obj', bytesOf(obj), undefined).scene
    for (const mesh of meshesOf(root)) {
      for (const material of materialsOf(mesh)) {
        expect(material).toBeInstanceOf(MeshStandardMaterial)
      }
    }
  })

  it('.mtl을 주면 그 색을 입힌다', async () => {
    const resources = new Map([['색.mtl', bytesOf(mtl)]])
    const root = await parseModel('obj', bytesOf(obj), resources).scene
    const material = materialsOf(meshesOf(root)[0] as Mesh)[0] as MeshStandardMaterial
    expect(material.color.r).toBeCloseTo(1)
    expect(material.color.g).toBeCloseTo(0)
    // 광택이 있으면 덜 거칠다. 기본값(1)이 아니어야 .mtl의 Ns가 건너온 것이다.
    expect(material.roughness).toBeLessThan(1)
  })

  it('같은 재질을 쓰는 덩어리는 바꾼 뒤에도 한 재질을 같이 쓴다', async () => {
    const resources = new Map([['색.mtl', bytesOf(mtl)]])
    const [first, second] = meshesOf(await parseModel('obj', bytesOf(obj), resources).scene)
    expect(first).toBeDefined()
    expect(materialsOf(first as Mesh)[0]).toBe(materialsOf(second as Mesh)[0])
  })

  it('.mtl 이름을 ./나 %20으로 적어도 찾는다', async () => {
    const resources = new Map([['./색.mtl', bytesOf(mtl)]])
    const root = await parseModel('obj', bytesOf(obj), resources).scene
    // 이름으로는 못 가린다. .mtl이 없어도 `OBJLoader`가 `usemtl`의 이름을 붙여 준다.
    const material = materialsOf(meshesOf(root)[0] as Mesh)[0] as MeshStandardMaterial
    expect(material.color.g).toBeCloseTo(0)
  })
})

describe('parseModel · STL', () => {
  it('Z축이 위인 STL을 세워서 받는다', async () => {
    const root = await parseModel('stl', sample('부품.stl'), undefined).scene
    root.updateMatrixWorld(true)
    const mesh = meshesOf(root)[0] as Mesh
    // 샘플은 Z로 4만큼 솟은 기둥이다. 세우면 그 높이가 Y로 온다.
    const up = new Vector3(0, 0, 4).applyMatrix4(mesh.matrixWorld)
    expect(up.y).toBeCloseTo(4)
    expect(up.z).toBeCloseTo(0)
  })

  it('법선을 비워 둔 STL도 면에서 법선을 다시 구한다', async () => {
    // 샘플은 법선을 일부러 0으로 적어 두었다.
    const mesh = meshesOf(await parseModel('stl', sample('부품.stl'), undefined).scene)[0] as Mesh
    const normals = mesh.geometry.getAttribute('normal')
    expect(normals).toBeDefined()
    const first = new Vector3().fromBufferAttribute(normals, 0)
    expect(first.length()).toBeCloseTo(1)
  })
})
