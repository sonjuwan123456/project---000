/**
 * 워커를 쓰는 쪽과 워커 안쪽이 함께 쓰는 자잘한 것들.
 *
 * 무거운 계산과 파일 읽기가 각각 워커로 나가면서 같은 두 줄이 네 군데 생겼다.
 * 여기 한 번만 둔다.
 */

/** 이 자리에서 워커를 만들 수 있는지. 시험과 서버에는 없다. */
export function canUseWorker(): boolean {
  return typeof Worker !== 'undefined'
}

/**
 * 넘길 버퍼. slice()로 뜬 타입 배열의 buffer는 언제나 평범한 ArrayBuffer지만,
 * 타입은 SharedArrayBuffer일 수도 있다고 본다. 그 한 줄을 여기서 좁힌다.
 */
export function transferable(view: { buffer: ArrayBufferLike }): ArrayBuffer {
  return view.buffer as ArrayBuffer
}

/**
 * 워커 전역인지. 창이 없고 postMessage가 있는 전역은 워커뿐이다.
 *
 * 워커 파일을 시험이 그냥 불러다 처리 함수만 쓸 수 있어야 해서, 귀를 여는 쪽을
 * 이 검사로 감싼다.
 */
export type WorkerScope<Request, Response> = {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage(message: Response, transfer: ArrayBuffer[]): void
  window?: unknown
}

export function workerScope<Request, Response>(): Partial<WorkerScope<Request, Response>> | null {
  const scope = globalThis as unknown as Partial<WorkerScope<Request, Response>>
  if (scope.window !== undefined || typeof scope.postMessage !== 'function') return null
  return scope
}
