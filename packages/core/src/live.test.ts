import { describe, expect, it, vi } from 'vitest'
import { createLiveStore } from './live'

describe('createLiveStore', () => {
  it('값이 실제로 바뀔 때만 알린다', () => {
    const store = createLiveStore(-1)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(-1)
    expect(listener).not.toHaveBeenCalled()

    store.set(42)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(42)
  })

  it('구독을 끊으면 더 알리지 않는다', () => {
    const store = createLiveStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
  })
})
