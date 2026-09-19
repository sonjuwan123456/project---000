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

export type PcaRequest = {
  readonly id: number
  readonly name: string
  readonly rowCount: number
  readonly dimension: number
  readonly values: Float32Array
  readonly missing: Uint8Array
  readonly missingCount: number
  readonly options?: PcaOptions
}

export type PcaResponse =
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

/**
 * 넘길 버퍼. slice()로 뜬 타입 배열의 buffer는 언제나 평범한 ArrayBuffer지만,
 * 타입은 SharedArrayBuffer일 수도 있다고 본다. 그 한 줄을 여기서 좁힌다.
 */
function transferable(view: { buffer: ArrayBufferLike }): ArrayBuffer {
  return view.buffer as ArrayBuffer
}

/** 요청 하나를 처리한다. 워커 밖에서도 부를 수 있게 떼어 둔다(시험이 쓴다). */
export function handlePcaRequest(request: PcaRequest): {
  response: PcaResponse
  transfer: ArrayBuffer[]
} {
  try {
    const result = pcaTo3D(
      {
        name: request.name,
        dimension: request.dimension,
        rowCount: request.rowCount,
        values: request.values,
        missing: request.missing,
        missingCount: request.missingCount,
      },
      request.options ?? DEFAULT_PCA,
    )
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
type WorkerScope = {
  onmessage: ((event: MessageEvent<PcaRequest>) => void) | null
  postMessage(message: PcaResponse, transfer: ArrayBuffer[]): void
  window?: unknown
}

const scope = globalThis as unknown as Partial<WorkerScope>
// 창이 없고 postMessage가 있는 전역은 워커뿐이다.
if (scope.window === undefined && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => {
    const { response, transfer } = handlePcaRequest(event.data)
    scope.postMessage?.(response, transfer)
  }
}
