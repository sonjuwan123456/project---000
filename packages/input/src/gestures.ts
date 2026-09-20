/**
 * 손 랜드마크(MediaPipe 21점)를 제스처 이벤트로 바꾸는 순수 로직.
 *
 * 카메라도 브라우저 API도 쓰지 않는다. 그래서 가짜 손을 넣어 테스트할 수 있고,
 * 나중에 녹화한 손 데이터를 그대로 흘려보낼 수도 있다(설계 문서 10장의 제스처 녹화 재생).
 */

export type Landmark = {
  x: number
  y: number
  z: number
}

export type DetectedHand = {
  /** MediaPipe가 판단한 손 방향 ('Left' | 'Right'). 같은 값이 둘 오면 뒤엣것에 번호를 붙인다. */
  handedness: string
  landmarks: readonly Landmark[]
}

/** 쓰는 랜드마크 자리만 추린 것. 번호는 MediaPipe Hand Landmarker 규격이다. */
export const LM = {
  wrist: 0,
  thumbTip: 4,
  indexTip: 8,
  middleMcp: 9,
} as const

/** 손 하나가 가진 랜드마크 수. 이보다 적게 오면 그 손은 건너뛴다. */
export const LANDMARK_COUNT = 21

const ORIGIN: Landmark = { x: 0, y: 0, z: 0 }

/** 자리를 벗어난 색인은 원점으로 본다. 손을 미리 걸러 두므로 실제로는 일어나지 않는다. */
const point = (lm: readonly Landmark[], index: number): Landmark => lm[index] ?? ORIGIN

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)

/** 엄지-검지 거리를 손 크기로 나눈 값. 손이 카메라에서 멀어져도 값이 일정하다. */
export function pinchRatio(lm: readonly Landmark[]): number {
  const scale = dist(point(lm, LM.wrist), point(lm, LM.middleMcp)) || 1e-6
  return dist(point(lm, LM.thumbTip), point(lm, LM.indexTip)) / scale
}

/** 집었다고 보기 시작하는 값. */
export const PINCH_ON = 0.3
/** 집기를 푸는 값. 켜는 값보다 높게 두어 경계에서 깜빡이지 않게 한다. */
export const PINCH_OFF = 0.45

/** 0(펼침) ~ 1(완전히 집음). 커서를 얼마나 채울지 정하는 데 쓴다. */
export const pinchAmount = (ratio: number) =>
  Math.min(1, Math.max(0, (0.7 - ratio) / (0.7 - PINCH_ON)))

/**
 * 떨림은 줄이고 빠른 움직임에는 즉시 따라가는 One Euro 필터.
 *
 * 그냥 평균을 내면 손을 빨리 움직일 때 커서가 뒤처지고, 안 내면 가만히 둔 손이 떤다.
 * 속도가 빠를수록 차단 주파수를 올려서 둘을 같이 얻는다.
 */
export class OneEuroFilter {
  private prev: number | null = null
  private dPrev = 0
  private tPrev = 0

  constructor(
    private minCutoff = 1.4,
    private beta = 8,
    private dCutoff = 1,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timeMs: number): number {
    if (this.prev === null) {
      this.prev = value
      this.tPrev = timeMs
      return value
    }
    const dt = Math.max((timeMs - this.tPrev) / 1000, 1e-3)
    const d = (value - this.prev) / dt
    const aD = this.alpha(this.dCutoff, dt)
    this.dPrev = aD * d + (1 - aD) * this.dPrev
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dPrev)
    const a = this.alpha(cutoff, dt)
    this.prev = a * value + (1 - a) * this.prev
    this.tPrev = timeMs
    return this.prev
  }

  reset() {
    this.prev = null
    this.dPrev = 0
  }
}

export type Cursor = {
  id: string
  /** 화면 기준 0~1. 좌우 반전이 이미 적용돼 있다. */
  x: number
  y: number
  pinching: boolean
  /** 0~1. 집는 정도. */
  pinch: number
}

export type GestureEvent =
  | { type: 'pinchstart'; id: string; x: number; y: number }
  | { type: 'pinchmove'; id: string; x: number; y: number; dx: number; dy: number }
  | { type: 'pinchend'; id: string; x: number; y: number; tap: boolean }
  | { type: 'zoom'; delta: number }

export type GestureOutput = {
  cursors: Cursor[]
  events: GestureEvent[]
}

type TrackState = {
  fx: OneEuroFilter
  fy: OneEuroFilter
  pinching: boolean
  pinchStartTime: number
  startX: number
  startY: number
  travel: number
  lastX: number
  lastY: number
}

/** 이 시간 안에 놓아야 탭으로 본다. */
export const TAP_MAX_MS = 350
/** 집은 채로 이만큼보다 더 움직였으면 탭이 아니라 끌기다. */
export const TAP_MAX_TRAVEL = 0.035

/**
 * 손 랜드마크를 받아 커서 위치와 제스처 이벤트를 낸다.
 *
 * 손마다 상태를 따로 들고 있어야 "집기 시작"과 "놓음"을 구분할 수 있으므로,
 * 함수가 아니라 프레임 사이에 사는 객체다.
 */
export class GestureInterpreter {
  private tracks = new Map<string, TrackState>()
  private lastSpread: number | null = null

  /** 웹캠 화면은 거울처럼 좌우가 뒤집혀 보인다. 기본은 뒤집어 맞춘다. */
  constructor(private mirrored = true) {}

  update(hands: readonly DetectedHand[], now: number): GestureOutput {
    const events: GestureEvent[] = []
    const cursors: Cursor[] = []
    const used = new Set<string>()

    hands.forEach((hand, index) => {
      if (hand.landmarks.length < LANDMARK_COUNT) return

      let id = hand.handedness || `hand-${index}`
      if (used.has(id)) id = `${id}-${index}`
      used.add(id)

      let track = this.tracks.get(id)
      if (!track) {
        track = {
          fx: new OneEuroFilter(),
          fy: new OneEuroFilter(),
          pinching: false,
          pinchStartTime: 0,
          startX: 0,
          startY: 0,
          travel: 0,
          lastX: 0,
          lastY: 0,
        }
        this.tracks.set(id, track)
      }

      const lm = hand.landmarks
      const thumb = point(lm, LM.thumbTip)
      const finger = point(lm, LM.indexTip)
      // 커서는 엄지와 검지 사이. 집는 순간 손가락이 모이는 자리라 흔들림이 가장 적다.
      const rawX = (thumb.x + finger.x) / 2
      const rawY = (thumb.y + finger.y) / 2
      const x = track.fx.filter(this.mirrored ? 1 - rawX : rawX, now)
      const y = track.fy.filter(rawY, now)

      const ratio = pinchRatio(lm)
      const wasPinching = track.pinching
      const pinching = wasPinching ? ratio < PINCH_OFF : ratio < PINCH_ON

      if (pinching && !wasPinching) {
        track.pinchStartTime = now
        track.startX = x
        track.startY = y
        track.travel = 0
        events.push({ type: 'pinchstart', id, x, y })
      } else if (pinching && wasPinching) {
        const dx = x - track.lastX
        const dy = y - track.lastY
        track.travel = Math.max(track.travel, Math.hypot(x - track.startX, y - track.startY))
        events.push({ type: 'pinchmove', id, x, y, dx, dy })
      } else if (!pinching && wasPinching) {
        events.push({ type: 'pinchend', id, x, y, tap: this.isTap(track, now) })
      }

      track.pinching = pinching
      track.lastX = x
      track.lastY = y
      cursors.push({ id, x, y, pinching, pinch: pinchAmount(ratio) })
    })

    // 화면 밖으로 나간 손은 집기를 강제로 푼다. 안 그러면 카메라가 잡힌 채로 남는다.
    for (const [id, track] of this.tracks) {
      if (used.has(id)) continue
      if (track.pinching) {
        events.push({ type: 'pinchend', id, x: track.lastX, y: track.lastY, tap: false })
      }
      this.tracks.delete(id)
    }

    // 양손으로 집고 있으면 벌린 거리의 변화를 확대·축소로 읽는다.
    const pinched = cursors.filter((c) => c.pinching)
    const [a, b] = pinched
    if (a && b) {
      const spread = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.lastSpread !== null) events.push({ type: 'zoom', delta: spread - this.lastSpread })
      this.lastSpread = spread
      // 확대하는 동안에는 회전을 내보내지 않는다. 두 손이 같이 움직여 화면이 휘둘린다.
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.type === 'pinchmove') events.splice(i, 1)
      }
    } else {
      this.lastSpread = null
    }

    return { cursors, events }
  }

  private isTap(track: TrackState, now: number) {
    return now - track.pinchStartTime <= TAP_MAX_MS && track.travel <= TAP_MAX_TRAVEL
  }

  reset() {
    this.tracks.clear()
    this.lastSpread = null
  }
}
