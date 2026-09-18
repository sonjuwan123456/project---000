/** 값을 [min, max] 안으로 자른다. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** a와 b를 t(0~1)로 섞는다. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 프레임 시간에 관계없이 같은 속도로 목표에 다가가는 감쇠.
 * lerp를 매 프레임 그대로 쓰면 프레임률에 따라 속도가 달라진다.
 * 카메라와 손 커서처럼 렌더 루프에서 따라가는 값에 쓴다.
 */
export function damp(current: number, target: number, smoothing: number, deltaSeconds: number) {
  return lerp(current, target, 1 - Math.pow(smoothing, deltaSeconds))
}
