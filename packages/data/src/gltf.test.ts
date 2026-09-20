import { describe, expect, it } from 'vitest'
import { looksLikeGlb, readGlb, readGltfJson, summarizeGltf, type GltfDocument } from './gltf'
import { UnsupportedFileError } from './unsupported'

/**
 * GLB를 손으로 만든다.
 *
 * 채움(padding)을 일부러 생기게 하려고 JSON 길이를 4의 배수로 맞추지 않는다.
 * 채움을 건너뛰지 않는 읽개는 BIN 청크의 머리를 엉뚱한 자리에서 읽는다.
 */
function buildGlb(
  document: unknown,
  options: {
    binary?: Uint8Array
    magic?: number
    version?: number
    declaredLength?: number
    /** 규격은 청크 길이에 채움을 포함하라고 한다. 거짓이면 빼고 적는다(어긴 내보내기). */
    padInLength?: boolean
  } = {},
): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document))
  const jsonPad = (4 - (json.byteLength % 4)) % 4
  const binary = options.binary
  const binPad = binary === undefined ? 0 : (4 - (binary.byteLength % 4)) % 4

  const total =
    12 + 8 + json.byteLength + jsonPad + (binary === undefined ? 0 : 8 + binary.byteLength + binPad)

  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  view.setUint32(0, options.magic ?? 0x46546c67, true)
  view.setUint32(4, options.version ?? 2, true)
  view.setUint32(8, options.declaredLength ?? total, true)

  const padInLength = options.padInLength ?? true

  let offset = 12
  view.setUint32(offset, json.byteLength + (padInLength ? jsonPad : 0), true)
  view.setUint32(offset + 4, 0x4e4f534a, true)
  bytes.set(json, offset + 8)
  // 채움은 공백이어야 JSON이 그대로 파싱된다.
  for (let index = 0; index < jsonPad; index += 1)
    bytes[offset + 8 + json.byteLength + index] = 0x20
  offset += 8 + json.byteLength + jsonPad

  if (binary !== undefined) {
    view.setUint32(offset, binary.byteLength + (padInLength ? binPad : 0), true)
    view.setUint32(offset + 4, 0x004e4942, true)
    bytes.set(binary, offset + 8)
  }
  return buffer
}

const minimal: GltfDocument = {
  asset: { version: '2.0', generator: 'Khronos glTF Blender I/O v4.2' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 24 }, { count: 36 }],
  materials: [{}],
  nodes: [{}, {}],
}

describe('readGlb', () => {
  it('JSON과 BIN 청크를 모두 읽는다', () => {
    const bin = new Uint8Array([1, 2, 3, 4, 5])
    const chunks = readGlb(buildGlb(minimal, { binary: bin }))
    expect(chunks.json.meshes).toHaveLength(1)
    expect(chunks.binary?.slice(0, 5)).toEqual(bin)
  })

  it('JSON 길이가 4의 배수가 아니어도 뒤따르는 BIN을 찾는다', () => {
    // 이름 길이를 바꿔 가며 남는 바이트 0~3을 모두 지나간다.
    for (const padding of ['', 'a', 'bb', 'ccc']) {
      const document = { ...minimal, extras: { note: padding } }
      const chunks = readGlb(buildGlb(document, { binary: new Uint8Array([9, 9, 9]) }))
      expect(chunks.binary, `남는 바이트 ${padding.length}개`).not.toBeNull()
      expect(chunks.binary?.[0]).toBe(9)
    }
  })

  it('청크 길이에 채움을 빼고 적은 파일에서도 BIN을 찾는다', () => {
    /*
     * 규격은 청크 길이에 채움까지 넣으라고 하는데, 빼고 적는 내보내기가 실제로 있다.
     * 적힌 길이만 믿고 건너뛰면 다음 청크 머리를 채움 바이트에서 읽어 BIN을 놓친다.
     */
    for (const padding of ['a', 'bb', 'ccc']) {
      const document = { ...minimal, extras: { note: padding } }
      const chunks = readGlb(
        buildGlb(document, { binary: new Uint8Array([7, 7, 7]), padInLength: false }),
      )
      expect(chunks.json.meshes, `남는 바이트 ${4 - padding.length}개`).toHaveLength(1)
      expect(chunks.binary?.[0], `남는 바이트 ${4 - padding.length}개`).toBe(7)
    }
  })

  it('BIN 청크가 없는 GLB도 읽는다', () => {
    expect(readGlb(buildGlb(minimal)).binary).toBeNull()
  })

  it('앞머리가 glTF가 아니면 거절한다', () => {
    expect(() => readGlb(buildGlb(minimal, { magic: 0x12345678 }))).toThrow(UnsupportedFileError)
  })

  it('GLB 버전 1은 거절한다', () => {
    expect(() => readGlb(buildGlb(minimal, { version: 1 }))).toThrow(/버전 1/)
  })

  it('glTF 1.0은 거절한다', () => {
    const old = { ...minimal, asset: { version: '1.0' } }
    expect(() => readGlb(buildGlb(old))).toThrow(/glTF 1.0/)
  })

  it('중간에 잘린 파일은 잘렸다고 말한다', () => {
    const full = buildGlb(minimal, { binary: new Uint8Array(64) })
    // 머리에 적힌 길이는 그대로 두고 뒤를 잘라 낸다. 내려받다 끊긴 파일의 모양이다.
    expect(() => readGlb(full.slice(0, full.byteLength - 40))).toThrow(/잘렸/)
  })

  it('머리만 있고 내용이 없으면 거절한다', () => {
    expect(() => readGlb(new ArrayBuffer(8))).toThrow(/너무 짧/)
  })
})

describe('readGltfJson', () => {
  it('JSON 한 덩어리를 읽는다', () => {
    expect(readGltfJson(JSON.stringify(minimal)).json.meshes).toHaveLength(1)
  })

  it('JSON이 깨졌으면 거절한다', () => {
    expect(() => readGltfJson('{ "asset": ')).toThrow(/JSON/)
  })

  it('최상위가 배열이면 거절한다', () => {
    expect(() => readGltfJson('[]')).toThrow(/객체가 아/)
  })
})

describe('summarizeGltf', () => {
  it('인덱스가 있으면 인덱스 수로 삼각형을 센다', () => {
    const summary = summarizeGltf(minimal, 'glb')
    // 인덱스 36개 = 삼각형 12개. 좌표 24개를 쓰면 8이 나온다.
    expect(summary.triangles).toBe(12)
    expect(summary.meshes).toBe(1)
    expect(summary.materials).toBe(1)
    expect(summary.nodes).toBe(2)
    expect(summary.generator).toContain('Blender')
  })

  it('인덱스가 없으면 좌표 수로 센다', () => {
    const document: GltfDocument = {
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ count: 9 }],
    }
    expect(summarizeGltf(document, 'glb').triangles).toBe(3)
  })

  it('그리기 모드마다 삼각형 수가 다르다', () => {
    const withMode = (mode: number | undefined): number =>
      summarizeGltf(
        { meshes: [{ primitives: [{ mode, indices: 0 }] }], accessors: [{ count: 12 }] },
        'glb',
      ).triangles

    expect(withMode(4)).toBe(4) // TRIANGLES
    expect(withMode(5)).toBe(10) // TRIANGLE_STRIP
    expect(withMode(6)).toBe(10) // TRIANGLE_FAN
    expect(withMode(0)).toBe(0) // POINTS
    expect(withMode(1)).toBe(0) // LINES
    // 모드를 빠뜨리면 규격상 TRIANGLES다. 0으로 세면 흔한 파일이 전부 0이 된다.
    expect(withMode(undefined)).toBe(4)
  })

  it('덩어리가 여럿이면 합쳐 센다', () => {
    const document: GltfDocument = {
      meshes: [{ primitives: [{ indices: 0 }, { indices: 1 }] }, { primitives: [{ indices: 0 }] }],
      accessors: [{ count: 30 }, { count: 6 }],
    }
    const summary = summarizeGltf(document, 'glb')
    expect(summary.primitives).toBe(3)
    expect(summary.triangles).toBe(10 + 2 + 10)
  })

  it('바깥 파일만 골라내고 박아 넣은 것은 세지 않는다', () => {
    const document: GltfDocument = {
      buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
      images: [{ uri: 'wood.png' }, { uri: 'scene.bin' }, {}],
      meshes: [],
    }
    // 같은 uri는 한 번만. data:는 이미 파일 안에 있다.
    expect(summarizeGltf(document, 'gltf').externalResources).toEqual(['scene.bin', 'wood.png'])
  })

  it('GLB는 대개 바깥 파일이 없다', () => {
    expect(summarizeGltf(minimal, 'glb').externalResources).toEqual([])
  })

  it('필수로 적히지 않고 쓴다고만 적힌 압축도 잡아낸다', () => {
    const document: GltfDocument = {
      meshes: [],
      extensionsUsed: ['KHR_materials_emissive_strength', 'KHR_draco_mesh_compression'],
    }
    expect(summarizeGltf(document, 'glb').needsDecoder).toEqual(['Draco로 압축된 메시'])
  })

  it('해제기가 필요 없는 확장은 세지 않는다', () => {
    const document: GltfDocument = {
      meshes: [],
      extensionsRequired: ['KHR_materials_unlit', 'KHR_texture_transform'],
    }
    expect(summarizeGltf(document, 'glb').needsDecoder).toEqual([])
  })

  it('필수와 사용에 같은 확장이 겹쳐도 한 번만 센다', () => {
    const document: GltfDocument = {
      meshes: [],
      extensionsRequired: ['EXT_meshopt_compression'],
      extensionsUsed: ['EXT_meshopt_compression', 'KHR_texture_basisu'],
    }
    expect(summarizeGltf(document, 'glb').needsDecoder).toEqual([
      'meshopt으로 압축된 메시',
      'KTX2(Basis)로 압축된 텍스처',
    ])
  })

  it('버전이 없으면 모른다고 적는다', () => {
    expect(summarizeGltf({ meshes: [] }, 'glb').version).toBe('알 수 없음')
    expect(summarizeGltf({ meshes: [] }, 'glb').generator).toBeNull()
  })
})

describe('looksLikeGlb', () => {
  it('앞 네 바이트가 glTF면 참이다', () => {
    expect(looksLikeGlb(new Uint8Array(buildGlb(minimal)).slice(0, 16))).toBe(true)
  })

  it('CSV 앞머리는 거짓이다', () => {
    expect(looksLikeGlb(new TextEncoder().encode('이름,값\n가,1'))).toBe(false)
  })

  it('네 바이트가 안 되면 거짓이다', () => {
    expect(looksLikeGlb(new Uint8Array([0x67, 0x6c]))).toBe(false)
  })
})
