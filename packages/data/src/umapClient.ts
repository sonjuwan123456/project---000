/**
 * UMAP을 워커에 맡기는 쪽.
 *
 * `pcaClient.ts`와 같은 모양이다. 워커를 일감 하나에 하나씩 만들고 끝나면 닫는다.
 * 다른 점은 이쪽이 훨씬 오래 걸린다는 것이다 — 그래서 `cancel()`이 더 중요하다.
 * 사용자가 UMAP을 고른 뒤 표를 갈아 끼우면 몇 분짜리 계산이 남아 돌 수 있다.
 */

import { progressOf, throttleProgress, type ProgressReporter } from './progress'
import { DEFAULT_UMAP, umapTo3D, type UmapOptions, type UmapResult } from './umap'
import type { UmapRequest, UmapResponse } from './umapWorker'
import type { VectorColumn } from './vectorColumn'
import { canUseWorker, transferable } from './workerSupport'

export type UmapJob = {
  /** 계산 결과. cancel()을 부른 뒤에는 끝나지 않는다. */
  readonly result: Promise<UmapResult>
  /** 계산을 멈추고 워커를 닫는다. 이미 끝났으면 아무 일도 없다. */
  cancel(): void
}

let nextId = 1

function inThisThread(vector: VectorColumn, options: UmapOptions): UmapJob {
  let cancelled = false
  return {
    result: new Promise<UmapResult>((resolve, reject) => {
      // 마이크로태스크로 미뤄서, 부른 쪽이 cancel()을 걸 틈을 준다.
      queueMicrotask(() => {
        if (cancelled) return
        try {
          resolve(umapTo3D(vector, options))
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
 * 임베딩 하나를 UMAP으로 3D 좌표로 줄인다.
 *
 * 벡터는 한 벌 떠서 보낸다. 표가 들고 있는 버퍼를 그대로 넘기면 주 스레드에서
 * 떨어져 나가 표가 망가진다. 뜬 것은 넘겨 버려서 복사가 한 번으로 끝난다.
 */
export function startUmap(
  vector: VectorColumn,
  options: UmapOptions = DEFAULT_UMAP,
  onProgress?: ProgressReporter,
): UmapJob {
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
    worker = new Worker(new URL('./umapWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    // 워커를 만들 수 없는 환경이면 조용히 이 스레드에서 돈다. 결과는 같다.
    return inThisThread(vector, options)
  }

  const id = nextId
  nextId += 1
  let done = false

  const result = new Promise<UmapResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<UmapResponse>) => {
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
        epochs: message.epochs,
      })
    }
    worker.onerror = (event) => {
      done = true
      worker.terminate()
      reject(new Error(event.message || 'UMAP 워커가 멈췄습니다.'))
    }
  })

  const values = vector.values.slice()
  const missing = vector.missing.slice()
  const request: UmapRequest = {
    id,
    name: vector.name,
    rowCount: vector.rowCount,
    dimension: vector.dimension,
    values,
    missing,
    missingCount: vector.missingCount,
    // onProgress는 함수라 싣지 못한다. 워커 쪽이 자기 것을 달아서 쓴다.
    options: { neighbors: options.neighbors, minDist: options.minDist, seed: options.seed },
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
