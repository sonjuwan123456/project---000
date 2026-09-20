import { useEffect, useRef } from 'react'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
import type { DetectedHand } from './gestures'

/**
 * 웹캠을 켜고 매 비디오 프레임마다 손 랜드마크를 넘긴다.
 *
 * 모델은 무겁고 카메라 권한은 거절당할 수 있어서, 켜고 끄고 실패하는 세 가지를 모두
 * 상태로 돌려준다. 손 좌표 자체는 매 프레임 바뀌므로 React 상태가 아니라 콜백으로 준다.
 * 상태 저장은 부르는 쪽 몫이다(설계 문서 3장: 입력층은 화면을 모른다).
 */

const TASKS_VERSION = '0.10.35'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type HandTrackingStatus = 'off' | 'loading' | 'on' | 'error'

/** 실패한 까닭을 사용자가 고칠 수 있는 말로 바꾼다. */
export function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return '카메라 권한이 막혀 있습니다. 브라우저 주소창에서 카메라를 허용한 뒤 다시 켜 주세요.'
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      return '연결된 카메라를 찾지 못했습니다. 웹캠이 연결돼 있는지 확인해 주세요.'
    }
    if (err.name === 'NotReadableError') {
      return '다른 앱이 카메라를 쓰고 있습니다. 화상회의 앱 등을 끄고 다시 시도해 주세요.'
    }
  }
  return '손 인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 켜 주세요.'
}

async function createLandmarker(): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  })
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    // GPU 백엔드가 없는 기기가 있다. 느려도 도는 쪽으로 물러선다.
    return await HandLandmarker.createFromOptions(fileset, options('CPU'))
  }
}

export type HandTrackingOptions = {
  enabled: boolean
  /**
   * 다시 켤 때마다 올리는 번호.
   *
   * 실패한 뒤에도 `enabled`는 켜진 채로 남아 있어서, 이 번호가 없으면 "다시 시도"를 눌러도
   * 효과가 다시 돌지 않는다.
   */
  session: number
  /** 프레임마다 인식된 손. `now`는 `performance.now()` 기준이다. */
  onHands: (hands: DetectedHand[], now: number) => void
  onStatus: (status: HandTrackingStatus, message: string | null) => void
}

export function useHandTracking(options: HandTrackingOptions): void {
  const { enabled, session } = options
  // 콜백이 매 렌더 새로 오더라도 카메라를 다시 켜지 않는다.
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let stream: MediaStream | null = null
    let landmarker: HandLandmarker | null = null
    let raf = 0
    const video = document.createElement('video')
    video.playsInline = true
    video.muted = true

    const start = async () => {
      try {
        latest.current.onStatus('loading', null)
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException('no media devices', 'NotFoundError')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) return
        video.srcObject = stream
        await video.play()
        landmarker = await createLandmarker()
        if (cancelled) return
        latest.current.onStatus('on', null)

        let lastVideoTime = -1
        const loop = () => {
          raf = requestAnimationFrame(loop)
          // 같은 프레임을 두 번 넣으면 MediaPipe가 시각이 거꾸로 갔다며 던진다.
          if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return
          lastVideoTime = video.currentTime
          const now = performance.now()
          const result = landmarker.detectForVideo(video, now)
          const hands: DetectedHand[] = result.landmarks.map((landmarks, i) => ({
            handedness: result.handedness[i]?.[0]?.categoryName ?? `hand-${i}`,
            landmarks,
          }))
          latest.current.onHands(hands, now)
        }
        loop()
      } catch (err) {
        // 카메라는 열렸는데 모델만 실패할 수 있다. 그대로 두면 아무것도 못 하면서
        // 카메라 불만 켜져 있다. 여기서 먼저 끄고 알린다.
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
        landmarker?.close()
        landmarker = null
        if (!cancelled) latest.current.onStatus('error', describeError(err))
      }
    }
    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      landmarker?.close()
      // 카메라 불을 확실히 끈다. 트랙을 남기면 켜진 채로 남는다.
      stream?.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
  }, [enabled, session])
}
