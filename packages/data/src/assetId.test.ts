import { describe, expect, it } from 'vitest'
import { assetIdOfFile, assetIdOfShape, fingerprint } from './assetId'
import { buildTable } from './loadTable'
import { readTableFile } from './readTableFile'

describe('fingerprint', () => {
  it('같은 입력은 같은 값, 다른 입력은 다른 값', () => {
    expect(fingerprint(['a', 1])).toBe(fingerprint(['a', 1]))
    expect(fingerprint(['a', 1])).not.toBe(fingerprint(['a', 2]))
  })

  it('이어 붙였을 때 헷갈리는 조합을 가른다', () => {
    // 구분자 없이 이으면 ['ab','c']와 ['a','bc']가 같아진다.
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']))
  })
})

describe('assetIdOfFile', () => {
  const file = { name: '문의.csv', size: 1024, lastModified: 1_758_240_000_000 }

  it('같은 파일은 같은 id를 받는다', () => {
    expect(assetIdOfFile(file)).toBe(assetIdOfFile({ ...file }))
  })

  it('고친 파일은 다른 id를 받는다 — 저장된 행 번호를 얹으면 안 되기 때문이다', () => {
    expect(assetIdOfFile(file)).not.toBe(assetIdOfFile({ ...file, size: 2048 }))
    expect(assetIdOfFile(file)).not.toBe(assetIdOfFile({ ...file, lastModified: 1 }))
  })

  it('이름이 다르면 다른 id다', () => {
    expect(assetIdOfFile(file)).not.toBe(assetIdOfFile({ ...file, name: '다른.csv' }))
  })
})

describe('assetIdOfShape', () => {
  it('행 수가 같아도 컬럼이 다르면 다른 id다', () => {
    const a = assetIdOfShape(100, [['분류', 'category']], [])
    const b = assetIdOfShape(100, [['점수', 'number']], [])
    expect(a).not.toBe(b)
  })

  it('행 수가 다르면 다른 id다', () => {
    const columns = [['분류', 'category']] as const
    expect(assetIdOfShape(100, columns, [])).not.toBe(assetIdOfShape(101, columns, []))
  })
})

describe('불러온 표의 id', () => {
  it('파일로 열면 파일에서 뽑은 id가 붙는다', async () => {
    const source = {
      name: '문의.csv',
      size: 42,
      lastModified: 7,
      text: () => Promise.resolve('분류\n배송\n'),
    }
    const table = await readTableFile(source)
    expect(table.assetId).toBe(assetIdOfFile(source))
    expect(table.assetId.startsWith('file-')).toBe(true)
  })

  it('파일 없이 만든 표는 모양으로 id를 만든다', () => {
    const table = buildTable(['분류'], [['배송']], 1)
    expect(table.assetId.startsWith('shape-')).toBe(true)
    expect(buildTable(['분류'], [['배송']], 1).assetId).toBe(table.assetId)
  })

  it('행 수가 같은 다른 파일은 다른 id를 받는다', async () => {
    // 작업 공간이 고정 선택을 되살릴 때 rowCount만 보면 여기서 남의 행 번호를 얹는다.
    const one = await readTableFile({
      name: '가.csv',
      size: 10,
      lastModified: 1,
      text: () => Promise.resolve('분류\n배송\n결제\n'),
    })
    const two = await readTableFile({
      name: '나.csv',
      size: 10,
      lastModified: 1,
      text: () => Promise.resolve('분류\n환불\n계정\n'),
    })
    expect(one.rowCount).toBe(two.rowCount)
    expect(one.assetId).not.toBe(two.assetId)
  })
})
