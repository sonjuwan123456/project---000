import { describe, expect, it } from 'vitest'
import { FORMATS, plannedMessage, resolveFormat, supportedLabels } from './formats'
import { kindOfFile, readAssetFile, type ReadableAsset } from './loaderRegistry'
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

const cube = {
  asset: { version: '2.0' },
  meshes: [{ primitives: [{ indices: 0 }] }],
  accessors: [{ count: 36 }],
}

/** 브라우저 File을 흉내 낸다. `slice`가 있어야 앞머리 판별이 돈다. */
function fileOf(name: string, bytes: ArrayBuffer | string): ReadableAsset {
  const buffer =
    typeof bytes === 'string' ? (new TextEncoder().encode(bytes).buffer as ArrayBuffer) : bytes
  return {
    name,
    size: buffer.byteLength,
    lastModified: 1_700_000_000_000,
    text: async () => new TextDecoder().decode(buffer),
    arrayBuffer: async () => buffer,
    slice: (start = 0, end = buffer.byteLength) => ({
      arrayBuffer: async () => buffer.slice(start, end),
    }),
  }
}

/** `slice`가 없는 파일. 앞머리를 못 떼는 자리를 흉내 낸다. */
function blindFileOf(name: string, text: string): ReadableAsset {
  const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer
  return {
    name,
    size: buffer.byteLength,
    text: async () => text,
    arrayBuffer: async () => buffer,
  }
}

describe('resolveFormat', () => {
  it('확장자로 고른다', () => {
    expect(resolveFormat('표.csv')?.kind).toBe('table')
    expect(resolveFormat('표.TSV')?.id).toBe('delimited')
    expect(resolveFormat('줄.jsonl')?.id).toBe('json-lines')
    expect(resolveFormat('큐브.glb')?.kind).toBe('model')
    expect(resolveFormat('장면.gltf')?.id).toBe('gltf-json')
  })

  it('모르는 확장자는 고르지 않는다', () => {
    expect(resolveFormat('무엇.zzz')).toBeNull()
  })

  it('확장자가 없으면 표로 본다', () => {
    expect(resolveFormat('내보내기')?.id).toBe('delimited')
  })

  it('확장자가 틀려도 앞머리가 glTF면 GLB로 본다', () => {
    const head = new Uint8Array(glbOf(cube)).slice(0, 16)
    expect(resolveFormat('모델.bin', head)?.id).toBe('gltf-binary')
    // 확장자가 아예 없을 때도 내용이 이긴다.
    expect(resolveFormat('모델', head)?.id).toBe('gltf-binary')
  })

  it('앞머리가 표면 확장자 없는 파일은 그대로 표다', () => {
    const head = new TextEncoder().encode('이름,값\n가,1')
    expect(resolveFormat('내보내기', head)?.id).toBe('delimited')
  })

  it('확장자가 맞으면 앞머리를 보지 않는다', () => {
    // CSV라고 적힌 파일 안에 GLB가 들었어도 확장자를 믿는다. 내용 판별은 물러설 자리다.
    const head = new Uint8Array(glbOf(cube)).slice(0, 16)
    expect(resolveFormat('표.csv', head)?.id).toBe('delimited')
  })
})

describe('plannedMessage', () => {
  it('아직 못 읽는 형식은 무엇이 필요한지 말한다', () => {
    expect(plannedMessage('표.xlsx')).toMatch(/CSV로 내보내/)
    expect(plannedMessage('표.parquet')).toMatch(/Parquet/)
    expect(plannedMessage('모델.fbx')).toMatch(/GLB/)
    expect(plannedMessage('작업.blend')).toMatch(/glTF Binary/)
  })

  it('읽을 수 있는 형식에는 없다', () => {
    expect(plannedMessage('표.csv')).toBeNull()
    expect(plannedMessage('큐브.glb')).toBeNull()
    expect(plannedMessage('상자.obj')).toBeNull()
    expect(plannedMessage('부품.stl')).toBeNull()
  })

  it('.mtl만 떨어뜨리면 .obj와 같이 넣으라고 한다', () => {
    expect(plannedMessage('상자.mtl')).toMatch(/\.obj와 함께/)
  })

  it('모르는 확장자에도 없다', () => {
    expect(plannedMessage('무엇.zzz')).toBeNull()
  })
})

describe('supportedLabels', () => {
  it('지금 읽을 수 있는 것만 센다', () => {
    const labels = supportedLabels()
    expect(labels).toContain('GLB')
    expect(labels).toContain('CSV·TSV')
    expect(labels).toContain('OBJ')
    expect(labels).toContain('STL')
    expect(labels).not.toContain('MTL')
    expect(labels).not.toContain('Parquet')
    expect(labels).not.toContain('FBX')
  })
})

describe('FORMATS', () => {
  it('한 확장자를 두 형식이 가져가지 않는다', () => {
    const seen = new Map<string, string>()
    for (const format of FORMATS) {
      for (const extension of format.extensions) {
        expect(seen.get(extension), `${extension}이(가) 겹친다`).toBeUndefined()
        seen.set(extension, format.id)
      }
    }
  })

  it('읽을 수 있다고 적힌 형식에는 까닭이 없고, 그 반대도 같다', () => {
    for (const format of FORMATS) {
      const reachable = resolveFormat(`x.${format.extensions[0]}`)
      expect(reachable?.id, `${format.id}을(를) 확장자로 못 찾는다`).toBe(format.id)
    }
  })
})

describe('kindOfFile', () => {
  it('종류만 먼저 본다', async () => {
    expect(await kindOfFile(fileOf('표.csv', '이름,값\n가,1'))).toBe('table')
    expect(await kindOfFile(fileOf('큐브.glb', glbOf(cube)))).toBe('model')
  })

  it('아직 못 읽는 형식과 모르는 형식은 null이다', async () => {
    expect(await kindOfFile(fileOf('표.xlsx', ''))).toBeNull()
    expect(await kindOfFile(fileOf('무엇.zzz', ''))).toBeNull()
  })

  it('앞머리를 못 떼는 파일도 확장자로 가린다', async () => {
    expect(await kindOfFile(blindFileOf('표.csv', '이름,값\n가,1'))).toBe('table')
  })
})

describe('readAssetFile', () => {
  it('표는 표 자산으로 온다', async () => {
    const asset = await readAssetFile(fileOf('표.csv', '이름,값\n가,1\n나,2'))
    expect(asset.kind).toBe('table')
    if (asset.kind !== 'table') throw new Error('표가 아니다')
    expect(asset.table.rowCount).toBe(2)
    expect(asset.assetId).toBe(asset.table.assetId)
  })

  it('모델은 모델 자산으로 온다', async () => {
    const asset = await readAssetFile(fileOf('큐브.glb', glbOf(cube)))
    expect(asset.kind).toBe('model')
    if (asset.kind !== 'model') throw new Error('모델이 아니다')
    expect(asset.model.summary.triangles).toBe(12)
  })

  it('확장자가 틀린 GLB도 내용을 보고 연다', async () => {
    const asset = await readAssetFile(fileOf('모델.bin', glbOf(cube)))
    expect(asset.kind).toBe('model')
  })

  it('아직 못 읽는 형식은 까닭을 그대로 돌려준다', async () => {
    await expect(readAssetFile(fileOf('표.parquet', ''))).rejects.toThrow(/CSV로 내보내거나/)
  })

  it('모르는 형식은 받는 것들을 늘어놓는다', async () => {
    const error = await readAssetFile(fileOf('무엇.zzz', '내용')).catch((e) => e)
    expect(error).toBeInstanceOf(UnsupportedFileError)
    expect((error as Error).message).toContain('GLB')
  })
})

describe('텍스트 자산', () => {
  it('.log는 텍스트로 읽는다', async () => {
    const asset = await readAssetFile(
      fileOf(
        'app.log',
        `2026-09-20 12:01:30 [INFO] 시작
2026-09-20 12:01:35 [ERROR] 실패
`,
      ),
    )
    expect(asset.kind).toBe('text')
    if (asset.kind !== 'text') throw new Error('텍스트여야 한다')
    expect(asset.text.flavor).toBe('log')
    expect(asset.text.lines).toHaveLength(2)
  })

  it('.md와 코드 파일도 텍스트다', async () => {
    expect((await readAssetFile(fileOf('읽어주세요.md', '# 제목'))).kind).toBe('text')
    expect((await readAssetFile(fileOf('Workspace.tsx', 'const a = 1'))).kind).toBe('text')
    expect(await kindOfFile(fileOf('app.log', ''))).toBe('text')
  })

  it('표로 읽으려다 글이었던 파일도 열린다', async () => {
    // 예전에는 여기서 UnsupportedFileError로 끝났다.
    const asset = await readAssetFile(
      fileOf(
        '출력.txt',
        `2026-09-20 12:01:30 [INFO] 시작
2026-09-20 12:01:31 [INFO] 대기
2026-09-20 12:01:35 [ERROR] 실패
2026-09-20 12:01:36 [WARN] 재시도
2026-09-20 12:01:40 [INFO] 연결됨
`,
      ),
    )
    expect(asset.kind).toBe('text')
    if (asset.kind !== 'text') throw new Error('텍스트여야 한다')
    expect(asset.text.flavor).toBe('log')
    // 왜 표가 아니라 글로 열렸는지 사람에게 먼저 말한다.
    expect(asset.text.notices[0]).toMatchObject({ level: 'warning' })
    expect(asset.text.notices[0]?.message).toContain('글자')
  })

  it('진짜 못 읽는 파일은 여전히 막는다', async () => {
    await expect(readAssetFile(fileOf('사진.png', 'x'))).rejects.toBeInstanceOf(
      UnsupportedFileError,
    )
  })

  it('받는 형식 목록에 글자 갈래가 들어간다', () => {
    expect(supportedLabels()).toContain('로그')
    expect(supportedLabels()).toContain('마크다운')
    expect(supportedLabels()).toContain('코드')
  })
})
