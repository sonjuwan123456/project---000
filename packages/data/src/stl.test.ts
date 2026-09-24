import { describe, expect, it } from 'vitest'
import { isBinaryStl, summarizeStl } from './stl'
import { UnsupportedFileError } from './unsupported'

/** 삼각형 `faces`개짜리 이진 STL. 머리 80바이트는 `header`로 채운다. */
function binaryStl(faces: number, header = ''): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + faces * 50)
  new Uint8Array(buffer).set(new TextEncoder().encode(header).slice(0, 80))
  new DataView(buffer).setUint32(80, faces, true)
  return buffer
}

/** 글자판 앞에 붙는 UTF-8 BOM. 소스에 날것으로 두면 보이지 않는다. */
const BOM = String.fromCharCode(0xfeff)

function textOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

const facet = [
  '  facet normal 0 0 1',
  '    outer loop',
  '      vertex 0 0 0',
  '      vertex 1 0 0',
  '      vertex 0 1 0',
  '    endloop',
  '  endfacet',
].join('\n')

describe('isBinaryStl', () => {
  it('크기가 이진판 공식에 맞으면 머리가 "solid"로 시작해도 이진판이다', () => {
    expect(isBinaryStl(binaryStl(3, 'solid 내보낸 부품'))).toBe(true)
  })

  it('"solid"로 시작하고 크기가 안 맞으면 글자판이다', () => {
    expect(isBinaryStl(textOf(`solid 부품\n${facet}\nendsolid 부품\n`))).toBe(false)
  })

  it('앞에 BOM이 붙은 글자판도 알아본다', () => {
    expect(isBinaryStl(textOf(`${BOM}solid 부품\n${facet}\nendsolid\n`))).toBe(false)
  })
})

describe('summarizeStl', () => {
  it('이진판은 머리에 적힌 삼각형 수를 쓴다', () => {
    const summary = summarizeStl(binaryStl(24, 'solid 샘플'))
    expect(summary.format).toBe('stl')
    expect(summary.triangles).toBe(24)
    expect(summary.meshes).toBe(1)
    expect(summary.materials).toBe(0)
    expect(summary.externalResources).toEqual([])
  })

  it('글자판은 facet을 센다 — solid가 여럿이어도 메시는 하나다', () => {
    const text = `solid 가\n${facet}\n${facet}\nendsolid 가\nsolid 나\n${facet}\nendsolid 나\n`
    const summary = summarizeStl(textOf(text))
    expect(summary.triangles).toBe(3)
    expect(summary.meshes).toBe(1)
    expect(summary.primitives).toBe(2)
  })

  it('endsolid 없이 잘린 글자판은 그릴 것이 없다 — three도 면을 못 찾는다', () => {
    expect(summarizeStl(textOf(`solid 가\n${facet}\n`)).meshes).toBe(0)
  })

  it('삼각형 수보다 짧은 이진판은 잘렸다고 말한다', () => {
    const cut = binaryStl(10).slice(0, 84 + 5 * 50)
    expect(() => summarizeStl(cut)).toThrow(/잘렸습니다/)
  })

  it('머리보다 짧으면 읽지 않는다', () => {
    const error = (() => {
      try {
        summarizeStl(new ArrayBuffer(40))
      } catch (caught) {
        return caught
      }
      return null
    })()
    expect(error).toBeInstanceOf(UnsupportedFileError)
  })
})
