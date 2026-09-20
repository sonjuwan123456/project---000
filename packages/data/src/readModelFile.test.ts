import { describe, expect, it } from 'vitest'
import { noticesOfModel, readModelFile, type ReadableBinaryFile } from './readModelFile'
import type { GltfSummary } from './gltf'
import { UnsupportedFileError } from './unsupported'

function glbOf(document: unknown): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document))
  const pad = (4 - (json.byteLength % 4)) % 4
  const buffer = new ArrayBuffer(20 + json.byteLength + pad)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, json.byteLength + pad, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  for (let index = 0; index < pad; index += 1) bytes[20 + json.byteLength + index] = 0x20
  return buffer
}

function fileOf(name: string, bytes: ArrayBuffer | string): ReadableBinaryFile {
  const buffer =
    typeof bytes === 'string' ? (new TextEncoder().encode(bytes).buffer as ArrayBuffer) : bytes
  return {
    name,
    size: buffer.byteLength,
    lastModified: 1_700_000_000_000,
    text: async () => new TextDecoder().decode(buffer),
    arrayBuffer: async () => buffer,
  }
}

const cube = {
  asset: { version: '2.0', generator: 'Khronos glTF Blender I/O v4.2' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 24 }, { count: 36 }],
  materials: [{ name: '나무' }],
  nodes: [{ mesh: 0 }],
}

describe('readModelFile', () => {
  it('GLB를 읽어 무엇이 들었는지 센다', async () => {
    const model = await readModelFile(fileOf('큐브.glb', glbOf(cube)))
    expect(model.format).toBe('glb')
    expect(model.name).toBe('큐브.glb')
    expect(model.summary.triangles).toBe(12)
    expect(model.summary.materials).toBe(1)
    expect(model.bytes.byteLength).toBeGreaterThan(0)
  })

  it('같은 파일을 다시 열면 같은 자산 id가 나온다', async () => {
    const bytes = glbOf(cube)
    const first = await readModelFile(fileOf('큐브.glb', bytes))
    const second = await readModelFile(fileOf('큐브.glb', bytes))
    expect(second.assetId).toBe(first.assetId)
    // 이름이 다르면 다른 자산이다. 표와 같은 규칙이다.
    const other = await readModelFile(fileOf('다른이름.glb', bytes))
    expect(other.assetId).not.toBe(first.assetId)
  })

  it('확장자가 gltf면 JSON으로 읽는다', async () => {
    const model = await readModelFile(fileOf('장면.gltf', JSON.stringify(cube)))
    expect(model.format).toBe('gltf')
    expect(model.summary.meshes).toBe(1)
  })

  it('그릴 메시가 없으면 열지 않는다', async () => {
    const empty = { asset: { version: '2.0' }, nodes: [{ camera: 0 }], meshes: [] }
    await expect(readModelFile(fileOf('빈.glb', glbOf(empty)))).rejects.toThrow(/메시가 없/)
  })

  it('읽지 못하면 파일 이름을 달아서 알린다', async () => {
    const error = await readModelFile(fileOf('깨진.glb', 'glTF가 아닌 내용')).catch((e) => e)
    expect(error).toBeInstanceOf(UnsupportedFileError)
    expect((error as UnsupportedFileError).fileName).toBe('깨진.glb')
  })
})

const base: GltfSummary = {
  format: 'glb',
  version: '2.0',
  generator: null,
  nodes: 1,
  meshes: 2,
  primitives: 2,
  materials: 3,
  textures: 0,
  animations: 0,
  triangles: 1234,
  externalResources: [],
  needsDecoder: [],
}

describe('noticesOfModel', () => {
  it('들어 있는 것을 한 줄로 말한다', () => {
    const notices = noticesOfModel(base)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.level).toBe('info')
    expect(notices[0]?.message).toContain('1,234')
  })

  it('바깥 파일을 가리키면 GLB로 내보내라고 한다', () => {
    const notices = noticesOfModel({ ...base, externalResources: ['scene.bin', 'wood.png'] })
    const warning = notices.find((one) => one.level === 'warning')
    expect(warning?.message).toContain('scene.bin')
    expect(warning?.message).toContain('.glb')
  })

  it('바깥 파일이 넷을 넘으면 앞 셋만 적고 나머지를 센다', () => {
    const many = ['a.bin', 'b.png', 'c.png', 'd.png', 'e.png']
    const warning = noticesOfModel({ ...base, externalResources: many }).find(
      (one) => one.level === 'warning',
    )
    expect(warning?.message).toContain('외 2개')
    expect(warning?.message).not.toContain('e.png')
  })

  it('해제기가 필요한 압축은 끄는 법을 알려 준다', () => {
    const warning = noticesOfModel({ ...base, needsDecoder: ['Draco로 압축된 메시'] }).find(
      (one) => one.level === 'warning',
    )
    expect(warning?.message).toContain('Draco')
    expect(warning?.message).toContain('압축을 끄면')
  })

  it('애니메이션은 첫 자세만 보인다고 미리 말한다', () => {
    const notices = noticesOfModel({ ...base, animations: 3 })
    expect(notices.some((one) => one.message.includes('첫 자세'))).toBe(true)
  })

  it('모자란 것이 없으면 경고를 만들지 않는다', () => {
    expect(noticesOfModel(base).some((one) => one.level === 'warning')).toBe(false)
  })
})
