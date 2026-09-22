import { describe, expect, it } from 'vitest'
import {
  MAX_BUNDLE_FILES,
  bundleBytes,
  bundleOf,
  findInBundle,
  normalizePath,
  pickPrimary,
  resolveResources,
  type BundleFile,
} from './fileBundle'

function fileOf(name: string, bytes = 'x'): BundleFile {
  const buffer = new TextEncoder().encode(bytes)
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    text: async () => bytes,
  }
}

function bundleFrom(paths: readonly string[]) {
  return bundleOf(
    '모형',
    paths.map((path) => [path, fileOf(path.slice(path.lastIndexOf('/') + 1))] as const),
  )
}

describe('normalizePath', () => {
  it('퍼센트 표기를 푼다 — glTF의 uri는 URL 규칙을 따른다', () => {
    expect(normalizePath('textures/wood%20floor.png')).toBe('textures/wood floor.png')
  })

  it('./ 와 ../ 를 접는다', () => {
    expect(normalizePath('./scene.bin')).toBe('scene.bin')
    expect(normalizePath('textures/../scene.bin')).toBe('scene.bin')
    expect(normalizePath('a/b/../../c.png')).toBe('c.png')
  })

  it('앞의 슬래시와 겹친 슬래시를 버린다', () => {
    expect(normalizePath('/모형//scene.bin')).toBe('모형/scene.bin')
  })

  it('역슬래시도 슬래시로 본다 — 윈도에서 만든 zip이 그렇다', () => {
    expect(normalizePath('textures\\wood.png')).toBe('textures/wood.png')
  })

  it('물음표와 우물 정 뒤를 뗀다', () => {
    expect(normalizePath('scene.bin?v=2')).toBe('scene.bin')
    expect(normalizePath('scene.gltf#mesh')).toBe('scene.gltf')
  })

  it('성하지 않은 퍼센트 표기는 적힌 그대로 둔다 — 고쳐 쓰는 것보다 낫다', () => {
    expect(normalizePath('100%.png')).toBe('100%.png')
  })
})

describe('bundleOf', () => {
  it('부스러기를 버린다', () => {
    const bundle = bundleFrom([
      'scene.gltf',
      '__MACOSX/._scene.gltf',
      '.DS_Store',
      'textures/Thumbs.db',
      'textures/wood.png',
    ])
    expect([...bundle.files.keys()].sort()).toEqual(['scene.gltf', 'textures/wood.png'])
  })

  it('같은 경로가 두 번 오면 처음 것을 쥔다', () => {
    const first = fileOf('a')
    const second = fileOf('b')
    const bundle = bundleOf('묶음', [
      ['scene.bin', first],
      ['./scene.bin', second],
    ])
    expect(bundle.files.size).toBe(1)
    expect(bundle.files.get('scene.bin')).toBe(first)
  })

  it('상한을 넘으면 거기서 끊는다 — 홈 폴더를 놓는 실수가 흔하다', () => {
    const many = Array.from({ length: MAX_BUNDLE_FILES + 50 }, (_, index) => `f${index}.png`)
    expect(bundleFrom(many).files.size).toBe(MAX_BUNDLE_FILES)
  })
})

describe('findInBundle', () => {
  const bundle = bundleFrom(['scene.gltf', 'scene.bin', 'textures/wood floor.png'])

  it('적힌 그대로 찾는다', () => {
    expect(findInBundle(bundle, 'scene.bin')).not.toBeNull()
  })

  it('퍼센트 표기와 ./ 를 풀어서 찾는다', () => {
    expect(findInBundle(bundle, './textures/wood%20floor.png')).not.toBeNull()
  })

  it('대소문자가 어긋나도 찾는다 — 윈도에서 만든 glTF가 그렇다', () => {
    expect(findInBundle(bundle, 'Textures/Wood Floor.PNG')).not.toBeNull()
  })

  it('경로가 통째로 달라도 이름이 하나뿐이면 잇는다', () => {
    expect(findInBundle(bundle, 'C:/작업/내보내기/scene.bin')).not.toBeNull()
  })

  it('같은 이름이 둘이면 잇지 않는다 — 어느 것인지 알 수 없다', () => {
    const two = bundleFrom(['a/wood.png', 'b/wood.png'])
    expect(findInBundle(two, 'c/wood.png')).toBeNull()
  })

  /*
   * 이름만 견주는 마지막 수단으로는 못 가리는 자리다. 이름이 둘이라 그 길은 막히고,
   * 경로를 대소문자 없이 견주는 길만 답을 낸다.
   */
  it('이름이 겹칠 때는 경로를 대소문자 없이 견줘서 가린다', () => {
    const two = bundleOf('묶음', [
      ['A/wood.png', fileOf('wood.png', '첫째')],
      ['b/wood.png', fileOf('wood.png', '둘째')],
    ])
    const found = findInBundle(two, 'a/WOOD.png')
    expect(found).not.toBeNull()
    expect(found).toBe(two.files.get('A/wood.png'))
  })

  it('없는 것은 null이다', () => {
    expect(findInBundle(bundle, 'missing.bin')).toBeNull()
    expect(findInBundle(bundle, '')).toBeNull()
  })
})

describe('pickPrimary', () => {
  it('모델을 먼저 고른다 — 묶음이 있는 까닭이 갈라진 모델이다', () => {
    const bundle = bundleFrom(['data.csv', 'README.md', 'scene.gltf'])
    expect(pickPrimary(bundle)?.path).toBe('scene.gltf')
  })

  it('모델이 없으면 표, 표도 없으면 글자', () => {
    expect(pickPrimary(bundleFrom(['README.md', 'data.csv']))?.path).toBe('data.csv')
    expect(pickPrimary(bundleFrom(['README.md', '기록.log']))?.path).toBe('README.md')
  })

  /*
   * `.txt`는 형식 표에서 구분자 형식(표)에 걸려 있다. 표인지 글인지는 읽어 봐야
   * 알고, 읽개가 글로 보이면 글자 패널로 넘긴다. 그러니 여기서는 표로 친다.
   */
  it('.txt는 표로 친다 — 글인지 표인지는 읽개가 내용을 보고 가른다', () => {
    expect(pickPrimary(bundleFrom(['README.md', 'note.txt']))?.path).toBe('note.txt')
  })

  it('같은 종류면 얕은 것을 고른다', () => {
    const bundle = bundleFrom(['deep/nested/scene.glb', 'scene.glb'])
    expect(pickPrimary(bundle)?.path).toBe('scene.glb')
  })

  it('깊이도 같으면 이름순 — 같은 폴더를 두 번 열면 같은 것이 떠야 한다', () => {
    const bundle = bundleFrom(['b.glb', 'a.glb'])
    expect(pickPrimary(bundle)?.path).toBe('a.glb')
    expect(pickPrimary(bundleFrom(['a.glb', 'b.glb']))?.path).toBe('a.glb')
  })

  /*
   * FBX는 모델이라 종류 순서로는 CSV를 이긴다. 그래서 `planned`를 건너뛰지 않으면
   * "FBX는 아직 읽지 못합니다"만 뜨고, 같이 든 CSV는 열어 보지도 못한다.
   */
  it('아직 못 읽는 형식은 고르지 않는다 — 같이 든 CSV를 막으면 안 된다', () => {
    expect(pickPrimary(bundleFrom(['모형.fbx', '표.csv']))?.path).toBe('표.csv')
    expect(pickPrimary(bundleFrom(['표.parquet', '표.csv']))?.path).toBe('표.csv')
  })

  it('열 만한 것이 없으면 null', () => {
    expect(pickPrimary(bundleFrom(['a.bin', 'b.xyz']))).toBeNull()
  })
})

describe('resolveResources', () => {
  it('찾은 것은 바이트로, 못 찾은 것은 목록으로', async () => {
    const bundle = bundleFrom(['scene.bin', 'textures/wood.png'])
    const { found, missing } = await resolveResources(bundle, [
      'scene.bin',
      './textures/wood.png',
      'lost.png',
    ])
    expect([...found.keys()]).toEqual(['scene.bin', './textures/wood.png'])
    expect(missing).toEqual(['lost.png'])
  })

  it('읽다 실패한 것도 못 찾은 것으로 둔다', async () => {
    const broken: BundleFile = {
      name: 'scene.bin',
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('읽을 수 없음')),
      text: () => Promise.reject(new Error('읽을 수 없음')),
    }
    const bundle = bundleOf('묶음', [['scene.bin', broken]])
    const { found, missing } = await resolveResources(bundle, ['scene.bin'])
    expect(found.size).toBe(0)
    expect(missing).toEqual(['scene.bin'])
  })
})

describe('bundleBytes', () => {
  it('든 파일의 크기를 더한다', () => {
    const bundle = bundleOf('묶음', [
      ['a.bin', fileOf('a', '1234')],
      ['b.bin', fileOf('b', '12')],
    ])
    expect(bundleBytes(bundle)).toBe(6)
  })

  it('크기를 모르는 파일은 0으로 센다', () => {
    const bundle = bundleOf('묶음', [
      ['a.bin', { name: 'a', arrayBuffer: async () => new ArrayBuffer(8), text: async () => '' }],
    ])
    expect(bundleBytes(bundle)).toBe(0)
  })
})
