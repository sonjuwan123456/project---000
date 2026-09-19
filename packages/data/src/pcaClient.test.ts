import { describe, expect, it } from 'vitest'
import { pcaTo3D } from './pca'
import { canUseWorker, startPca } from './pcaClient'
import { handlePcaRequest, type PcaRequest } from './pcaWorker'
import { vectorFromLists, type VectorColumn } from './vectorColumn'

function cloud(count: number, dimension: number): VectorColumn {
  let state = 11
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 8) / 0x1000000 - 0.5
  }
  const rows: number[][] = []
  for (let row = 0; row < count; row += 1) {
    rows.push(Array.from({ length: dimension }, (_, axis) => random() * (axis + 1)))
  }
  return vectorFromLists('emb', rows)
}

function requestFor(vector: VectorColumn, id = 1): PcaRequest {
  return {
    id,
    name: vector.name,
    rowCount: vector.rowCount,
    dimension: vector.dimension,
    values: vector.values.slice(),
    missing: vector.missing.slice(),
    missingCount: vector.missingCount,
  }
}

describe('handlePcaRequest', () => {
  it('워커를 거쳐도 그 자리에서 돌린 것과 같은 좌표가 나온다', () => {
    const vector = cloud(200, 6)
    const direct = pcaTo3D(vector)
    const { response } = handlePcaRequest(requestFor(vector))

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect([...response.x]).toEqual([...direct.x])
    expect([...response.y]).toEqual([...direct.y])
    expect([...response.z]).toEqual([...direct.z])
    expect(response.explained).toEqual(direct.explained)
  })

  it('요청 번호를 그대로 돌려준다 — 지난 표의 답을 가려내는 표식이다', () => {
    const { response } = handlePcaRequest(requestFor(cloud(20, 3), 42))
    expect(response.id).toBe(42)
  })

  it('넘길 버퍼는 워커가 새로 만든 것뿐이다', () => {
    const { response, transfer } = handlePcaRequest(requestFor(cloud(20, 3)))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(transfer).toHaveLength(4)
    expect(transfer).toContain(response.x.buffer)
    expect(transfer).toContain(response.missing.buffer)
  })
})

describe('startPca', () => {
  it('워커가 없는 곳에서는 그 자리에서 돌고 결과는 같다', async () => {
    // 시험은 node에서 돈다. 워커가 없다는 사실 자체가 되돌림 길을 태우는 조건이다.
    expect(canUseWorker()).toBe(false)

    const vector = cloud(150, 5)
    const result = await startPca(vector).result
    const direct = pcaTo3D(vector)
    expect([...result.x]).toEqual([...direct.x])
    expect(result.missingCount).toBe(direct.missingCount)
  })

  it('원본 벡터는 건드리지 않는다 — 표가 같은 버퍼를 계속 쓴다', async () => {
    const vector = cloud(80, 4)
    const before = [...vector.values]
    await startPca(vector).result
    expect(vector.values.byteLength).toBeGreaterThan(0)
    expect([...vector.values]).toEqual(before)
  })

  it('cancel()을 걸면 결과가 오지 않는다', async () => {
    const job = startPca(cloud(80, 4))
    job.cancel()
    const settled = await Promise.race([
      job.result.then(() => 'done').catch(() => 'failed'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])
    expect(settled).toBe('pending')
  })
})
