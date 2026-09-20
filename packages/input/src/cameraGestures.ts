import type { CameraDrive } from '@holo/core'
import type { GestureEvent } from './gestures'

/**
 * 제스처 이벤트를 카메라 조작으로 잇는다.
 *
 * 설계 문서 2장의 "입력은 명령으로"에서 카메라를 맡는 자리다. 여기에도 three.js나 DOM은
 * 들어오지 않는다. 무대인지 아닌지 판단하는 일만 밖에서 받아, 가짜 손잡이로 테스트한다.
 */

/** 화면을 가로로 가득 끌면 반 바퀴 조금 넘게 돈다. 한 번에 뒤를 볼 수 있는 정도. */
export const ROTATE_GAIN = { azimuth: Math.PI * 1.6, polar: Math.PI * 0.9 }

/** 양손을 벌린 거리(화면 비율)를 카메라가 움직이는 거리로 바꾸는 배율. */
export const ZOOM_GAIN = 14

export type CameraGestureOptions = {
  /** 지금 쓸 수 있는 카메라. 3D 뷰가 아직 없으면 null. */
  drive: () => CameraDrive | null
  /** 화면 좌표(0~1)가 3D 무대 위인지. 표나 패널 위에서 집으면 카메라가 돌지 않는다. */
  isStage: (x: number, y: number) => boolean
}

export type CameraGestures = {
  handle(event: GestureEvent): void
  /** 손 추적을 끌 때 쥐고 있던 것을 모두 놓는다. */
  reset(): void
}

export function createCameraGestures(options: CameraGestureOptions): CameraGestures {
  // 무대에서 집기 시작한 손만 카메라를 돌린다. 집은 자리를 집는 순간에 한 번만 판단하는 것은,
  // 끌다가 손이 표 위를 지나간다고 회전이 끊기면 안 되기 때문이다.
  const holding = new Set<string>()

  return {
    handle(event) {
      const drive = options.drive()
      switch (event.type) {
        case 'pinchstart': {
          if (options.isStage(event.x, event.y)) holding.add(event.id)
          break
        }
        case 'pinchmove': {
          if (!drive || !holding.has(event.id)) break
          drive.rotate(-event.dx * ROTATE_GAIN.azimuth, -event.dy * ROTATE_GAIN.polar)
          break
        }
        case 'pinchend': {
          if (!holding.delete(event.id)) break
          // 놓은 자리를 작업 공간에 남긴다. 마우스로 돌렸을 때와 같아야 한다.
          drive?.rest()
          break
        }
        case 'zoom': {
          // 두 손 다 표 위에 있으면 확대하지 않는다. 무대를 쥔 손이 하나는 있어야 한다.
          if (!drive || holding.size === 0) break
          drive.dolly(event.delta * ZOOM_GAIN)
          break
        }
      }
    },
    reset() {
      holding.clear()
    },
  }
}
