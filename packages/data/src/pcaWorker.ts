/**
 * 주성분 분석을 돌리는 워커.
 *
 * 2만 행 384차원이면 주 스레드에서 0.5초가 넘게 걸린다. 그동안 화면은 아무것도
 * 못 하므로 파일을 연 순간 앱이 멈춘 것처럼 보인다. 계산을 통째로 이리로 옮긴다.
 *
 * 벡터는 표가 들고 있는 것을 그대로 넘기면 안 된다. 넘긴 버퍼는 주 스레드에서
 * 떨어져 나가 표가 망가진다. 보내는 쪽에서 한 벌 떠서 보내고, 뜬 것만 넘긴다.
 */

import { DEFAULT_PCA, pcaTo3D, type PcaOptions } from './pca'
import { progressOf, throttleProgress, type LoadProgress } from './progress'
import { transferable, workerScope } from './workerSupport'

/**
 * 워커로 보낼 수 있는 설정.
 *
 * `onProgress`는 함수라 구조화 복제를 통과하지 못한다. 그대로 실으면 `postMessage`가
 * DataCloneError로 던진다. 타입에서 빼 두면 그 실수를 컴파일러가 잡는다.
 */
export type PcaRequestOptions = Omit<PcaOptions, 'onProgress'>

export type PcaRequest = {
  readonly id: number
  readonly name: string
  readonly rowCount: number
  readonly dimension: number
  readonly values: Float32Array
  readonly missing: Uint8Array
  readonly missingCount: number
  readonly options?: PcaRequestOptions
}

export type PcaWorkerResult =
  | {
      readonly id: number
      readonly ok: true
      readonly x: Float32Array
      readonly y: Float32Array
      readonly z: Float32Array
      readonly missing: Uint8Array
      readonly missingCount: number
      readonly explained: readonly [number, number, number]
    }
  | { readonly id: number; readonly ok: false; readonly message: string }

/** 워커 선을 건너오는 것 전부. 진행률은 끝나기 전에 여러 번 온다. */
export type PcaResponse =
  | PcaWorkerResult
  | { readonly id: number; readonly kind: 'progress'; readonly progress: LoadProgress }

/** 요청 하나를 처리한다. 워커 밖에서도 부를 수 있게 떼어 둔다(시험이 쓴다). */
export function handlePcaRequest(
  request: PcaRequest,
  onProgress?: (progress: LoadProgress) => void,
): {
  response: PcaWorkerResult
  transfer: ArrayBuffer[]
} {
  try {
    const report = onProgress === undefined ? undefined : throttleProgress((one) => onProgress(one))
    const result = pcaTo3D(
      {
        name: request.name,
        dimension: request.dimension,
        rowCount: request.rowCount,
        values: request.values,
        missing: request.missing,
        missingCount: request.missingCount,
      },
      {
        ...(request.options ?? DEFAULT_PCA),
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
        explained: result.explained,
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
const scope = workerScope<PcaRequest, PcaResponse>()
if (scope !== null) {
  scope.onmessage = (event) => {
    const { id } = event.data
    const { response, transfer } = handlePcaRequest(event.data, (progress) => {
      scope.postMessage?.({ id, kind: 'progress', progress }, [])
    })
    scope.postMessage?.(response, transfer)
  }
}
