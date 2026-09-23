/**
 * UMAP을 돌리는 워커.
 *
 * 주성분 분석보다 훨씬 무겁다 — 5만 행이면 분 단위다. 주 스레드에서 돌리면 그동안
 * 화면이 통째로 굳으므로, 이 계산은 워커 밖에서 돌 일이 없다.
 *
 * 벡터는 보내는 쪽에서 한 벌 떠서 넘긴다. 표가 들고 있는 버퍼를 그대로 넘기면
 * 주 스레드에서 떨어져 나가 표가 망가진다. `pcaWorker.ts`와 같은 규칙이다.
 */

import { progressOf, throttleProgress, type LoadProgress } from './progress'
import { DEFAULT_UMAP, umapTo3D, type UmapOptions } from './umap'
import { transferable, workerScope } from './workerSupport'

/**
 * 워커로 보낼 수 있는 설정.
 *
 * `onProgress`는 함수라 구조화 복제를 통과하지 못한다. 그대로 실으면 `postMessage`가
 * DataCloneError로 던진다. 타입에서 빼 두면 그 실수를 컴파일러가 잡는다.
 */
export type UmapRequestOptions = Omit<UmapOptions, 'onProgress'>

export type UmapRequest = {
  readonly id: number
  readonly name: string
  readonly rowCount: number
  readonly dimension: number
  readonly values: Float32Array
  readonly missing: Uint8Array
  readonly missingCount: number
  readonly options?: UmapRequestOptions
}

export type UmapWorkerResult =
  | {
      readonly id: number
      readonly ok: true
      readonly x: Float32Array
      readonly y: Float32Array
      readonly z: Float32Array
      readonly missing: Uint8Array
      readonly missingCount: number
      readonly epochs: number
    }
  | { readonly id: number; readonly ok: false; readonly message: string }

/** 워커 선을 건너오는 것 전부. 진행률은 끝나기 전에 여러 번 온다. */
export type UmapResponse =
  | UmapWorkerResult
  | { readonly id: number; readonly kind: 'progress'; readonly progress: LoadProgress }

/** 요청 하나를 처리한다. 워커 밖에서도 부를 수 있게 떼어 둔다(시험이 쓴다). */
export function handleUmapRequest(
  request: UmapRequest,
  onProgress?: (progress: LoadProgress) => void,
): {
  response: UmapWorkerResult
  transfer: ArrayBuffer[]
} {
  try {
    const report = onProgress === undefined ? undefined : throttleProgress((one) => onProgress(one))
    const result = umapTo3D(
      {
        name: request.name,
        dimension: request.dimension,
        rowCount: request.rowCount,
        values: request.values,
        missing: request.missing,
        missingCount: request.missingCount,
      },
      {
        ...(request.options ?? DEFAULT_UMAP),
        ...(report === undefined
          ? {}
          : { onProgress: (fraction: number) => report(progressOf('reducing', fraction)) }),
      },
    )
    // 막대가 끝까지 가는 것을 보고 사라져야 한다. 거르는 창에 걸리면 도중에 없어진다.
    report?.flush(progressOf('reducing', 1))
    return {
      response: {
        id: request.id,
        ok: true,
        x: result.x,
        y: result.y,
        z: result.z,
        missing: result.missing,
        missingCount: result.missingCount,
        epochs: result.epochs,
      },
      transfer: [result.x, result.y, result.z, result.missing].map(transferable),
    }
  } catch (error) {
    return {
      response: {
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      transfer: [],
    }
  }
}

// 워커로 불린 경우에만 귀를 연다. 시험은 이 파일을 그냥 불러다 위 함수만 쓴다.
const scope = workerScope<UmapRequest, UmapResponse>()
if (scope !== null) {
  scope.onmessage = (event) => {
    const { id } = event.data
    const { response, transfer } = handleUmapRequest(event.data, (progress) => {
      scope.postMessage?.({ id, kind: 'progress', progress }, [])
    })
    scope.postMessage?.(response, transfer)
  }
}
