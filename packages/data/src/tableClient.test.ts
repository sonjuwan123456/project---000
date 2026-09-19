import { describe, expect, it } from 'vitest'
import { attachLookup } from './loadTable'
import { UnsupportedFileError, type ReadableFile } from './readTableFile'
import { startTableRead } from './tableClient'
import { handleTableRequest, type TableRequest } from './tableWorker'
import { canUseWorker } from './workerSupport'

function fileOf(name: string, text: string): ReadableFile {
  return { name, size: text.length, lastModified: 1, text: () => Promise.resolve(text) }
}

const CSV = ['원문,범주,값', '가,A,1', '나,B,2', '다,A,3'].join('\n')

function requestFor(file: ReadableFile, id = 1): TableRequest {
  return { id, file }
}

describe('handleTableRequest', () => {
  it('조회 함수를 뺀 표를 돌려준다 — 함수는 워커를 넘어가지 못한다', async () => {
    const { response } = await handleTableRequest(requestFor(fileOf('시험.csv', CSV)))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.table).not.toHaveProperty('lookup')
    expect(response.table.rowCount).toBe(3)
    expect(response.table.columns.map((column) => column.name)).toEqual(['원문', '범주', '값'])
  })

  it('받는 쪽이 조회 함수를 다시 달면 원래대로 쓸 수 있다', async () => {
    const { response } = await handleTableRequest(requestFor(fileOf('시험.csv', CSV)))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const table = attachLookup(response.table)
    expect(table.lookup('값')?.[2]).toBe(3)
  })

  it('넘길 버퍼에 숫자 컬럼의 것이 들어 있다', async () => {
    const { response, transfer } = await handleTableRequest(requestFor(fileOf('시험.csv', CSV)))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    const numbers = response.table.columns.find((column) => column.kind === 'number')
    expect(numbers).toBeDefined()
    expect(transfer).toContain(numbers?.values.buffer)
  })

  it('읽을 수 없는 형식은 종류를 살려서 알린다', async () => {
    const { response } = await handleTableRequest(requestFor(fileOf('표.xlsx', '')))
    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.unsupported).toBe(true)
    expect(response.fileName).toBe('표.xlsx')
    expect(response.message).toContain('CSV')
  })

  it('요청 번호를 그대로 돌려준다 — 지난 파일의 답을 가려내는 표식이다', async () => {
    const { response } = await handleTableRequest(requestFor(fileOf('시험.csv', CSV), 9))
    expect(response.id).toBe(9)
  })
})

describe('startTableRead', () => {
  it('워커가 없는 곳에서는 그 자리에서 읽고 결과는 같다', async () => {
    // 시험은 node에서 돈다. 워커가 없다는 사실 자체가 되돌림 길을 태우는 조건이다.
    expect(canUseWorker()).toBe(false)

    const table = await startTableRead(fileOf('시험.csv', CSV)).result
    expect(table.rowCount).toBe(3)
    expect(table.lookup('값')?.[0]).toBe(1)
  })

  it('읽을 수 없는 형식은 UnsupportedFileError로 온다', async () => {
    await expect(startTableRead(fileOf('표.parquet', '')).result).rejects.toBeInstanceOf(
      UnsupportedFileError,
    )
  })

  it('cancel()을 걸면 결과가 오지 않는다', async () => {
    const job = startTableRead(fileOf('시험.csv', CSV))
    job.cancel()
    const settled = await Promise.race([
      job.result.then(() => 'done').catch(() => 'failed'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])
    expect(settled).toBe('pending')
  })
})
