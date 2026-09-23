/**
 * 주성분 분석을 워커에 맡기는 쪽.
 *
 * 워커를 쓸 수 없는 곳(시험, 서버)에서는 그 자리에서 계산한다. 부르는 쪽은
 * 어느 쪽이 돌았는지 몰라도 되게 언제나 Promise를 돌려준다.
 *
 * 워커는 일감 하나에 하나씩 만들고 끝나면 닫는다. 파일 하나를 여는 동안 한 번
 * 도는 계산이라 워커를 살려 둘 이유가 없고, 표를 갈아 끼울 때 지난 계산을
 * 멈추려면 닫는 쪽이 확실하다.
 */

import { DEFAULT_PCA, pcaTo3D, type PcaOptions, type PcaResult } from './pca'
import type { PcaRequest, PcaResponse } from './pcaWorker'
import { progressOf, throttleProgress, type ProgressReporter } from './progress'
import type { VectorColumn } from './vectorColumn'
import { canUseWorker, transferable } from './workerSupport'

export type PcaJob = {
  /** 계산 결과. cancel()을 부른 뒤에는 끝나지 않는다. */
  readonly result: Promise<PcaResult>
  /** 계산을 멈추고 워커를 닫는다. 이미 끝났으면 아무 일도 없다. */
  cancel(): void
}

let nextId = 1

function inThisThread(vector: VectorColumn, options: PcaOptions): PcaJob {
  let cancelled = false
  return {
    result: new Promise<PcaResult>((resolve, reject) => {
      // 마이크로태스크로 미뤄서, 부른 쪽이 cancel()을 걸 틈을 준다.
      queueMicrotask(() => {
        if (cancelled) return
        try {
          resolve(pcaTo3D(vector, options))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    }),
    cancel() {
      cancelled = true
    },
  }
}

/**
 * 임베딩 하나를 주성분 셋으로 줄인다.
 *
 * 벡터는 한 벌 떠서 보낸다. 표가 들고 있는 버퍼를 그대로 넘기면 주 스레드에서
 * 떨어져 나가 표가 망가진다. 뜬 것은 넘겨 버려서 복사가 한 번으로 끝난다.
 */
export function startPca(
  vector: VectorColumn,
  options: PcaOptions = DEFAULT_PCA,
  onProgress?: ProgressReporter,
): PcaJob {
  if (!canUseWorker()) {
    const report = onProgress === undefined ? undefined : throttleProgress(onProgress)
    return inThisThread(vector, {
      ...options,
      ...(report === undefined
        ? {}
        : { onProgress: (fraction: number) => report(progressOf('reducing', fraction)) }),
    })
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('./pcaWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    // 워커를 만들 수 없는 환경이면 조용히 이 스레드에서 돈다. 결과는 같다.
    return inThisThread(vector, options)
  }

  const id = nextId
  nextId += 1
  let done = false

  const result = new Promise<PcaResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<PcaResponse>) => {
      const message = event.data
      if (message.id !== id) return
      if ('kind' in message) {
        // 멈춘 뒤에 늦게 온 소식으로 막대를 되살리지 않는다.
        if (!done) onProgress?.(message.progress)
        return
      }
      done = true
      worker.terminate()
      if (!message.ok) {
        reject(new Error(message.message))
        return
      }
      resolve({
        x: message.x,
        y: message.y,
        z: message.z,
        missing: message.missing,
        missingCount: message.missingCount,
        explained: message.explained,
      })
    }
    worker.onerror = (event) => {
      done = true
      worker.terminate()
      reject(new Error(event.message || '주성분 계산 워커가 멈췄습니다.'))
    }
  })

  const values = vector.values.slice()
  const missing = vector.missing.slice()
  const request: PcaRequest = {
    id,
    name: vector.name,
    rowCount: vector.rowCount,
    dimension: vector.dimension,
    values,
    missing,
    missingCount: vector.missingCount,
    // onProgress는 함수라 싣지 못한다. 워커 쪽이 자기 것을 달아서 쓴다.
    options: { fitSample: options.fitSample, iterations: options.iterations },
  }
  worker.postMessage(request, [transferable(values), transferable(missing)])

  return {
    result,
    cancel() {
      if (done) return
      done = true
      worker.terminate()
    },
  }
}
