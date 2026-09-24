import { describe, expect, it } from 'vitest'
import { noticesOfModel, readModelFile, type ReadableBinaryFile } from './readModelFile'
import type { GltfSummary } from './gltf'
import { bundleOf } from './fileBundle'
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

describe('readModelFile 크기 안전장치', () => {
  const MB = 1024 * 1024

  it('거부선을 넘는 모델은 바이트를 읽어 보지도 않고 막는다', async () => {
    let opened = false
    const file: ReadableBinaryFile = {
      name: '거대한.glb',
      size: 700 * MB,
      text: async () => '',
      arrayBuffer: async () => {
        opened = true
        return new ArrayBuffer(0)
      },
    }
    await expect(readModelFile(file)).rejects.toThrow(UnsupportedFileError)
    expect(opened).toBe(false)
  })

  it('경고선을 넘으면 열되 무겁다는 말을 안내 맨 앞에 얹는다', async () => {
    const buffer = glbOf(cube)
    const model = await readModelFile({
      name: '제법큰.glb',
      size: 200 * MB,
      text: async () => '',
      arrayBuffer: async () => buffer,
    })
    expect(model.notices[0]?.level).toBe('warning')
    expect(model.notices[0]?.message).toContain('200MB')
  })

  it('표보다 너그럽다 — 같은 크기가 표는 막히고 모델은 열린다', async () => {
    const buffer = glbOf(cube)
    const model = await readModelFile({
      name: '오백.glb',
      size: 500 * MB,
      text: async () => '',
      arrayBuffer: async () => buffer,
    })
    expect(model.summary.meshes).toBe(1)
  })
})

describe('noticesOfModel · 폴더에서 찾은 바깥 파일', () => {
  const withExternals = { ...base, externalResources: ['scene.bin', 'wood.png'] }

  it('다 찾았으면 경고가 사라지고 찾았다고 말한다', () => {
    const notices = noticesOfModel(withExternals, [])
    expect(notices.some((one) => one.level === 'warning')).toBe(false)
    expect(notices.some((one) => one.message.includes('2개를 같은 폴더에서 찾아'))).toBe(true)
  })

  it('일부만 찾았으면 못 찾은 것만 말한다', () => {
    const notices = noticesOfModel(withExternals, ['wood.png'])
    const warning = notices.find((one) => one.level === 'warning')
    expect(warning?.message).toContain('wood.png')
    expect(warning?.message).not.toContain('scene.bin')
    expect(notices.some((one) => one.message.includes('1개를 같은 폴더에서'))).toBe(true)
  })

  it('하나도 못 찾았으면 폴더째 넣어 보라고 한다', () => {
    const warning = noticesOfModel(withExternals, ['scene.bin', 'wood.png']).find(
      (one) => one.level === 'warning',
    )
    expect(warning?.message).toContain('폴더째')
    expect(warning?.message).toContain('.glb')
  })
})

describe('readModelFile · 묶음', () => {
  it('묶음을 주면 바깥 파일을 찾아 함께 들고 온다', async () => {
    const gltf = {
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ count: 3 }],
      buffers: [{ uri: 'scene.bin' }],
      images: [{ uri: 'textures/wood%20floor.png' }],
    }
    const bin = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer
    const png = new Uint8Array([9, 9]).buffer as ArrayBuffer
    const bundle = bundleOf('모형', [
      [
        'scene.bin',
        { name: 'scene.bin', size: 4, arrayBuffer: async () => bin, text: async () => '' },
      ],
      [
        'textures/wood floor.png',
        { name: 'wood floor.png', size: 2, arrayBuffer: async () => png, text: async () => '' },
      ],
    ])

    const model = await readModelFile(fileOf('scene.gltf', JSON.stringify(gltf)), { bundle })
    expect(model.resources.get('scene.bin')).toBe(bin)
    expect(model.resources.get('textures/wood%20floor.png')).toBe(png)
    expect(model.notices.some((one) => one.level === 'warning')).toBe(false)
  })

  it('묶음이 없으면 예전처럼 하나만 읽고 경고한다', async () => {
    const gltf = {
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ count: 3 }],
      buffers: [{ uri: 'scene.bin' }],
    }
    const model = await readModelFile(fileOf('scene.gltf', JSON.stringify(gltf)))
    expect(model.resources.size).toBe(0)
    expect(model.notices.some((one) => one.level === 'warning')).toBe(true)
  })

  it('GLB는 묶음이 있어도 찾을 것이 없다', async () => {
    const model = await readModelFile(fileOf('상자.glb', glbOf(cube)), {
      bundle: bundleOf('모형', []),
    })
    expect(model.resources.size).toBe(0)
    expect(model.summary.externalResources).toEqual([])
  })
})

/** 글자 하나를 묶음 안 파일로 만든다. */
function entryOf(path: string, body: string) {
  const bytes = new TextEncoder().encode(body).buffer as ArrayBuffer
  return [
    path,
    {
      name: path.slice(path.lastIndexOf('/') + 1),
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
      text: async () => body,
    },
  ] as const
}

const box = ['mtllib 상자.mtl', 'o 상자', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0']
  .concat(['usemtl 나무', 'f 1 2 3 4'])
  .join('\n')
const boxMtl = 'newmtl 나무\nKd 1 1 1\nmap_Kd textures/나뭇결.png\n'

describe('readModelFile · OBJ', () => {
  it('OBJ를 읽어 면과 재질을 센다', async () => {
    const model = await readModelFile(fileOf('상자.obj', box))
    expect(model.format).toBe('obj')
    expect(model.summary.triangles).toBe(2)
    expect(model.summary.materials).toBe(1)
  })

  it('파일 하나만 열면 .mtl을 못 찾았다고 OBJ의 말로 알린다', async () => {
    const model = await readModelFile(fileOf('상자.obj', box))
    const warning = model.notices.find((one) => one.level === 'warning')
    expect(warning?.message).toContain('이 OBJ가')
    expect(warning?.message).toContain('상자.mtl')
    expect(warning?.message).not.toContain('glTF가')
  })

  /*
   * 두 번 찾아야 하는 까닭. 그림 이름은 OBJ가 아니라 .mtl에 적혀 있어서, .mtl을 찾아
   * 읽기 전에는 무엇을 더 찾아야 하는지조차 모른다.
   */
  it('폴더째 주면 .mtl을 읽고 그 안에 적힌 그림까지 찾아 온다', async () => {
    const bundle = bundleOf('모형', [
      entryOf('상자.mtl', boxMtl),
      entryOf('textures/나뭇결.png', 'png'),
    ])
    const model = await readModelFile(fileOf('상자.obj', box), { bundle })
    expect([...model.resources.keys()]).toEqual(['상자.mtl', 'textures/나뭇결.png'])
    expect(model.summary.textures).toBe(1)
    expect(model.notices.some((one) => one.level === 'warning')).toBe(false)
  })

  it('.mtl은 찾았는데 그림이 없으면 그림 이름을 들어 알린다', async () => {
    const bundle = bundleOf('모형', [entryOf('상자.mtl', boxMtl)])
    const model = await readModelFile(fileOf('상자.obj', box), { bundle })
    expect(model.resources.has('상자.mtl')).toBe(true)
    const warning = model.notices.find((one) => one.level === 'warning')
    expect(warning?.message).toContain('textures/나뭇결.png')
    expect(warning?.message).toContain('1개를 찾지 못했습니다')
  })

  it('면이 없는 OBJ는 열지 않고 까닭을 말한다', async () => {
    await expect(readModelFile(fileOf('점.obj', 'v 0 0 0\nv 1 0 0'))).rejects.toThrow(/면이 없/)
  })
})

describe('readModelFile · STL', () => {
  function binaryStl(faces: number): ArrayBuffer {
    const buffer = new ArrayBuffer(84 + faces * 50)
    new DataView(buffer).setUint32(80, faces, true)
    return buffer
  }

  it('STL을 읽어 삼각형을 센다', async () => {
    const model = await readModelFile(fileOf('부품.stl', binaryStl(24)))
    expect(model.format).toBe('stl')
    expect(model.summary.triangles).toBe(24)
  })

  it('재질이 없다는 것을 빠진 것이 아니라 한 가지 색으로 보인다고 말한다', async () => {
    const model = await readModelFile(fileOf('부품.stl', binaryStl(24)))
    const info = model.notices.find((one) => one.level === 'info')
    expect(info?.message).toContain('삼각형 24개')
    expect(info?.message).toContain('한 가지 색')
    expect(info?.message).not.toContain('재질 0개')
  })

  it('삼각형이 하나도 없는 STL은 열지 않는다', async () => {
    await expect(readModelFile(fileOf('빈.stl', binaryStl(0)))).rejects.toThrow(/삼각형이 없/)
  })

  it('잘린 STL은 파일 이름을 달아서 알린다', async () => {
    const error = await readModelFile(fileOf('잘린.stl', binaryStl(10).slice(0, 200))).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(UnsupportedFileError)
    expect((error as UnsupportedFileError).fileName).toBe('잘린.stl')
    expect((error as UnsupportedFileError).message).toMatch(/잘렸습니다/)
  })
})
