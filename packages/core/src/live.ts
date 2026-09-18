/**
 * 실시간 저장소 — 매 프레임 바뀌는 값을 React 밖에 둔다.
 *
 * 프로토타입에서 얻은 교훈 1번: 매 프레임 값을 전역 상태에 넣으면 패널이 초당 60번 다시
 * 렌더링된다. 손 커서, 마우스 올린 행, 프레임률, 스트림 값처럼 렌더 루프가 쓰는 값은
 * 여기에 두고, 화면에 숫자로 보여줄 때만 구독해서 React 상태로 옮긴다.
 *
 * `getSnapshot`과 `subscribe`를 그대로 두었기 때문에 React에서는 `useSyncExternalStore`에
 * 바로 넘길 수 있다.
 */
export type LiveStore<T> = {
  /** 지금 값. 렌더 루프에서 매 프레임 불러도 된다. */
  getSnapshot(): T
  /** 값이 실제로 바뀔 때만 구독자에게 알린다. */
  set(next: T): void
  /** 구독을 끊는 함수를 돌려준다. */
  subscribe(listener: () => void): () => void
}

export function createLiveStore<T>(initial: T): LiveStore<T> {
  let value = initial
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
