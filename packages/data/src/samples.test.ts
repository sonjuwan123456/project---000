import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundleOf, pickPrimary } from './fileBundle'
import { kindOfFile } from './loaderRegistry'
import { readModelFile } from './readModelFile'
import { readTableFile } from './readTableFile'
import { countByLevel, readTextFile } from './readTextFile'

/**
 * 저장소에 든 샘플 파일이 실제로 열리는지 본다 (설계 문서 9장 M1 "샘플 데이터").
 *
 * 샘플을 두는 까닭은 보여 주려는 것만이 아니다. **읽개의 갈림길을 하나씩 밟는 파일**을
 * 한자리에 모아 두면, 갈림길 하나가 막혔을 때 여기서 걸린다. 파일만 두고 아무도 열어
 * 보지 않으면 그 파일은 조용히 썩는다 — `samples/만들기.mjs`를 고쳤는데 아무도 모르는
 * 일이 없도록 여기서 연다.
 */
const here = (name: string) => fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url))

function fileOf(name: string) {
  const bytes = readFileSync(here(name))
  const buffer = () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return {
    name: name.slice(name.lastIndexOf('/') + 1),
    size: bytes.byteLength,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => buffer(),
    slice: (start?: number, end?: number) => {
      const cut = bytes.subarray(start ?? 0, end ?? bytes.byteLength)
      return {
        arrayBuffer: async () =>
          cut.buffer.slice(cut.byteOffset, cut.byteOffset + cut.byteLength) as ArrayBuffer,
      }
    },
  }
}

describe('샘플 · 종류 가리기', () => {
  it.each([
    ['고객문의.csv', 'table'],
    ['고객문의-euckr.csv', 'table'],
    ['깨진.csv', 'table'],
    ['주문.jsonl', 'table'],
    ['서버.log', 'text'],
    ['읽어보기.md', 'text'],
    ['예시.ts', 'text'],
    ['모형/scene.gltf', 'model'],
    ['모형-obj/상자.obj', 'model'],
    ['부품.stl', 'model'],
  ])('%s 는 %s 로 간다', async (name, kind) => {
    expect(await kindOfFile(fileOf(name))).toBe(kind)
  })
})

describe('샘플 · 표', () => {
  it('고객문의.csv는 네 갈래 컬럼과 임베딩을 다 낸다', async () => {
    const table = await readTableFile(fileOf('고객문의.csv'))
    expect(table.rowCount).toBe(200)
    const kinds = new Set(table.columns.map((column) => column.kind))
    // 범주·숫자·날짜·글자가 다 나와야 컬럼 종류 추론이 통째로 밟힌다.
    expect([...kinds].sort()).toEqual(['category', 'datetime', 'number', 'text'])
    expect(table.vectors[0]?.dimension).toBe(8)
  })

  it('EUC-KR 샘플이 한글로 읽힌다 — 표 읽개가 인코딩을 가리는지 지키는 자리', async () => {
    const table = await readTableFile(fileOf('고객문의-euckr.csv'))
    expect(table.columns.map((column) => column.name)).toContain('분류')
    expect(table.notices.some((one) => one.message.includes('EUC-KR'))).toBe(true)
  })

  it('깨진 샘플은 무엇이 어긋났는지 말한다', async () => {
    const table = await readTableFile(fileOf('깨진.csv'))
    const said = table.notices.map((one) => one.message).join(' ')
    expect(said).toContain('많은')
    expect(said).toContain('적은')
    expect(said).toContain('따옴표')
  })

  it('주문.jsonl은 중첩 객체를 접어서 연다', async () => {
    const table = await readTableFile(fileOf('주문.jsonl'))
    expect(table.rowCount).toBe(50)
    expect(table.columns.map((column) => column.name)).toContain('주문번호')
  })
})

describe('샘플 · 글자', () => {
  it.each([
    ['서버.log', 'log'],
    ['읽어보기.md', 'markdown'],
    ['예시.ts', 'code'],
  ])('%s 는 %s 갈래로 열린다', async (name, flavor) => {
    const text = await readTextFile(fileOf(name))
    expect(text.flavor).toBe(flavor)
  })

  it('서버.log에는 네 레벨이 다 들어 있다 — 레벨 색과 거르기를 밟으려면 필요하다', async () => {
    const counts = countByLevel(await readTextFile(fileOf('서버.log')).then((one) => one.levels))
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(counts[level]).toBeGreaterThan(0)
    }
  })
})

describe('샘플 · 3D 모델', () => {
  /*
   * 갈라진 glTF가 샘플에 있는 까닭이 이것이다. 파일 하나만 열면 바깥 파일을 못 찾고,
   * 폴더째 묶어 주면 찾는다. 폴더·zip을 받는 일이 왜 필요한지가 이 두 줄에 다 있다.
   */
  it('파일 하나만 열면 바깥 파일을 못 찾는다', async () => {
    const model = await readModelFile(fileOf('모형/scene.gltf'))
    expect(model.summary.externalResources.length).toBe(2)
    expect(model.resources.size).toBe(0)
  })

  it('폴더째 묶어 주면 바깥 파일까지 찾아 온다', async () => {
    const bundle = bundleOf('모형', [
      ['scene.gltf', fileOf('모형/scene.gltf')],
      ['scene.bin', fileOf('모형/scene.bin')],
      ['textures/나무 바닥.png', fileOf('모형/textures/나무 바닥.png')],
    ])
    expect(pickPrimary(bundle)?.path).toBe('scene.gltf')
    const model = await readModelFile(fileOf('모형/scene.gltf'), { bundle })
    expect(model.resources.size).toBe(2)
    expect(model.summary.triangles).toBe(1)
  })
})

describe('샘플 · OBJ와 STL', () => {
  /*
   * OBJ는 두 번 갈라져 있다. 파일 하나만 열면 .mtl을 못 찾고, 폴더째 주면 .mtl을 읽은 뒤
   * 그 안에 적힌 그림까지 찾는다.
   */
  it('상자.obj는 덩어리 둘, 재질 둘, 삼각형 16개다', async () => {
    const model = await readModelFile(fileOf('모형-obj/상자.obj'))
    expect(model.summary.meshes).toBe(2)
    expect(model.summary.materials).toBe(2)
    // 상자의 사각형 여섯이 12개, 받침의 육각형 하나가 4개.
    expect(model.summary.triangles).toBe(16)
    expect(model.resources.size).toBe(0)
  })

  it('폴더째 묶어 주면 .mtl과 그 안의 그림까지 찾아 온다', async () => {
    const bundle = bundleOf('모형-obj', [
      ['상자.obj', fileOf('모형-obj/상자.obj')],
      ['상자.mtl', fileOf('모형-obj/상자.mtl')],
      ['textures/나뭇결.png', fileOf('모형-obj/textures/나뭇결.png')],
    ])
    expect(pickPrimary(bundle)?.path).toBe('상자.obj')
    const model = await readModelFile(fileOf('모형-obj/상자.obj'), { bundle })
    expect(model.resources.size).toBe(2)
    expect(model.summary.textures).toBe(1)
    expect(model.notices.some((one) => one.level === 'warning')).toBe(false)
  })

  it('부품.stl은 머리가 "solid"로 시작해도 이진판으로 읽혀 삼각형 24개가 나온다', async () => {
    const model = await readModelFile(fileOf('부품.stl'))
    expect(model.summary.triangles).toBe(24)
  })
})
