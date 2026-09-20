/**
 * 제스처 해석, 손 추적, 입력-명령 연결.
 *
 * 브라우저 API를 쓰는 것은 `handTracking`뿐이고, 나머지는 순수 로직이라 테스트할 수 있다.
 */
export {
  GestureInterpreter,
  LANDMARK_COUNT,
  LM,
  OneEuroFilter,
  PINCH_OFF,
  PINCH_ON,
  TAP_MAX_MS,
  TAP_MAX_TRAVEL,
  pinchAmount,
  pinchRatio,
} from './gestures'
export type { Cursor, DetectedHand, GestureEvent, GestureOutput, Landmark } from './gestures'

export { ROTATE_GAIN, ZOOM_GAIN, createCameraGestures } from './cameraGestures'
export type { CameraGestureOptions, CameraGestures } from './cameraGestures'

export { describeError, useHandTracking } from './handTracking'
export type { HandTrackingOptions, HandTrackingStatus } from './handTracking'
