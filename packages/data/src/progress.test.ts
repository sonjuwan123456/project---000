import { describe, expect, it, vi } from 'vitest'
import { PHASE_LABELS, progressOf, throttleProgress, type LoadProgress } from './progress'
import { readTableFile } from './readTableFile'
import { handlePcaRequest } from './pcaWorker'
import { handleTableRequest } from './tableWorker'

describe('progressOf', () => {
  it('단계가 나아가면 전체 몫도 나아간다', () => {
    const order = ['reading', 'parsing', 'profiling', 'building'] as const
    const fractions = order.map((phase) => progressOf(phase, 0).fraction)
    for (let index = 1; index < fractions.length; index += 1) {
      expect(fractions[index]).toBeGreaterThan(fractions[index - 1] ?? -1)
    }
  })

  it('마지막 단계를 끝내면 1이다', () => {
    expect(progressOf('building', 1).fraction).toBeCloseTo(1)
  })

  it('잴 수 없는 단계는 그 단계의 절반에 둔다', () => {
    // 0으로 두면 파일을 읽는 내내 막대가 0에 붙어 있고, 1로 두면 안 한 일을 끝났다고 한다.
    const unknown = progressOf('reading', null)
    expect(unknown.ratio).toBeNull()
    expect(unknown.fraction).toBeGreaterThan(progressOf('reading', 0).fraction)
    expect(unknown.fraction).toBeLessThan(progressOf('parsing', 0).fraction)
  })

  it('범위를 벗어난 값을 0~1로 접는다', () => {
    expect(progressOf('parsing', -5).fraction).toBe(progressOf('parsing', 0).fraction)
    expect(progressOf('parsing', 9).fraction).toBe(progressOf('parsing', 1).fraction)
  })

  it('파생 계산은 읽기 막대에 얹지 않고 혼자 0에서 1까지 간다', () => {
    expect(progressOf('reducing', 0).fraction).toBe(0)
    expect(progressOf('reducing', 0.5).fraction).toBe(0.5)
    expect(progressOf('reducing', 1).fraction).toBe(1)
  })

  it('셀 수 있으면 꼬리표에 센 것을 붙인다', () => {
    expect(progressOf('profiling', 0.5).label).toBe(PHASE_LABELS.profiling)
    expect(progressOf('profiling', 0.5, '컬럼 12/24').label).toBe(
      `${PHASE_LABELS.profiling} · 컬럼 12/24`,
    )
  })
})

describe('throttleProgress', () => {
  const at = (phase: LoadProgress['phase'], ratio: number) => progressOf(phase, ratio)

  it('같은 단계 안에서는 시간 간격만큼만 내보낸다', () => {
    const seen: LoadProgress[] = []
    let clock = 1000
    const report = throttleProgress(
      (one) => seen.push(one),
      80,
      () => clock,
    )

    report(at('parsing', 0)) // 단계가 바뀌었으므로 통과
    report(at('parsing', 0.1)) // 같은 시각 — 막힌다
    clock += 40
    report(at('parsing', 0.2)) // 아직 80ms가 안 됐다
    clock += 50
    report(at('parsing', 0.3)) // 90ms 지났다
    expect(seen.map((one) => one.ratio)).toEqual([0, 0.3])
  })

  it('단계가 바뀌면 시간과 상관없이 내보낸다', () => {
    // 짧은 단계가 통째로 안 보이면 사람은 그 일이 일어난 줄도 모른다.
    const seen: LoadProgress[] = []
    const clock = 1000
    const report = throttleProgress(
      (one) => seen.push(one),
      80,
      () => clock,
    )

    report(at('reading', 0))
    report(at('parsing', 0))
    report(at('profiling', 0))
    report(at('building', 0))
    expect(seen.map((one) => one.phase)).toEqual(['reading', 'parsing', 'profiling', 'building'])
  })

  it('flush는 막히지 않는다', () => {
    // 이것이 없으면 막대가 98%에서 멈춘 채로 끝난다.
    const seen: LoadProgress[] = []
    const report = throttleProgress(
      (one) => seen.push(one),
      80,
      () => 1000,
    )
    report(at('building', 0))
    report(at('building', 0.5))
    expect(seen).toHaveLength(1)
    report.flush(at('building', 1))
    expect(seen).toHaveLength(2)
    expect(seen[1]?.fraction).toBeCloseTo(1)
  })
})

/*
 * 아래가 진짜 재는 것이다. 위의 단위 시험은 계산만 보는데, 배선이 어디 한 군데
 * 끊겨 있어도 전부 통과한다. 실제로 파일을 읽혀서 소식이 오는지 본다.
 */
describe('표를 읽는 동안 진행률이 온다', () => {
  const csv = (rows: number, columns: number) => {
    const header = Array.from({ length: columns }, (_, index) => `열${index}`).join(',')
    const body = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => row * columns + column).join(','),
    )
    return [header, ...body].join('\n')
  }

  const fileOf = (name: string, text: string) => ({ name, text: () => Promise.resolve(text) })

  it('단계 넷이 순서대로 오고 몫이 뒤로 가지 않는다', async () => {
    const seen: LoadProgress[] = []
    await readTableFile(fileOf('큰.csv', csv(400, 12)), { onProgress: (one) => seen.push(one) })

    expect(seen.length).toBeGreaterThan(3)
    const phases = [...new Set(seen.map((one) => one.phase))]
    expect(phases).toEqual(['reading', 'parsing', 'profiling', 'building'])

    // 뒤로 가는 막대는 멈춘 막대보다 나쁘다.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]?.fraction).toBeGreaterThanOrEqual(seen[index - 1]?.fraction ?? 0)
    }
  })

  it('컬럼을 살피는 동안 센 수가 움직인다', async () => {
    const seen: LoadProgress[] = []
    await readTableFile(fileOf('넓은.csv', csv(20, 40)), { onProgress: (one) => seen.push(one) })
    const labels = seen.filter((one) => one.phase === 'profiling').map((one) => one.label)
    expect(labels.length).toBeGreaterThan(1)
    expect(labels[0]).toContain('컬럼 1/40')
    expect(labels[labels.length - 1]).toContain('/40')
    expect(labels[0]).not.toBe(labels[labels.length - 1])
  })

  it('진행률을 주지 않으면 아무 일도 없다', async () => {
    const table = await readTableFile(fileOf('작은.csv', csv(3, 2)))
    expect(table.rowCount).toBe(3)
  })

  it('워커 쪽 입구에서도 소식이 나온다', async () => {
    // 워커를 건너는 길에 배선이 끊기면 화면에는 아무것도 안 온다.
    const onProgress = vi.fn()
    const { response } = await handleTableRequest(
      { id: 1, file: fileOf('큰.csv', csv(300, 8)) },
      onProgress,
    )
    expect(response.ok).toBe(true)
    expect(onProgress).toHaveBeenCalled()
    const phases = onProgress.mock.calls.map((call) => (call[0] as LoadProgress).phase)
    expect(new Set(phases).size).toBeGreaterThan(1)
  })

  it('워커가 보내는 마지막 소식은 100%다 — 85%에서 사라지면 그만둔 것처럼 보인다', async () => {
    const onProgress = vi.fn()
    await handleTableRequest({ id: 1, file: fileOf('큰.csv', csv(300, 8)) }, onProgress)
    const calls = onProgress.mock.calls
    const last = calls[calls.length - 1]?.[0] as LoadProgress
    expect(last.fraction).toBe(1)
  })

  it('주성분 계산도 마지막에 100%까지 간다', () => {
    const rowCount = 40
    const dimension = 8
    const values = new Float32Array(rowCount * dimension)
    for (let index = 0; index < values.length; index += 1) values[index] = Math.sin(index)
    const onProgress = vi.fn()
    handlePcaRequest(
      {
        id: 1,
        name: 'emb',
        rowCount,
        dimension,
        values,
        missing: new Uint8Array(rowCount),
        missingCount: 0,
      },
      onProgress,
    )
    const calls = onProgress.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]?.[0] as LoadProgress
    expect(last.phase).toBe('reducing')
    expect(last.fraction).toBe(1)
  })
})
