import { Spherical, Vector3 } from 'three'
import { clamp, lerp, type CameraDrive, type StoredCamera } from '@holo/core'

/**
 * drei 컨트롤을 손 제스처가 쓸 수 있는 손잡이로 감싼다.
 *
 * 컨트롤 자체가 아니라 필요한 부분만 받는다. 그래야 WebGL 없이 시험할 수 있다.
 */
export type OrbitLike = {
  object: { position: Vector3 }
  target: Vector3
  update(): void
  /**
   * 관성. 켜져 있으면 손을 놓은 뒤에도 남은 회전이 몇 프레임 이어진다. 날아가는 동안
   * 그 남은 회전이 도착점을 밀어내므로 잠시 끈다. 꺼진 채로 한 번 `update`하면 남은 것이 비워진다.
   */
  enableDamping?: boolean
}

/** 바로 위·아래를 넘어가면 화면이 뒤집힌다. 그 앞에서 멈춘다. */
export const POLAR_MARGIN = 0.05

/** 손으로 확대할 수 있는 범위. 너무 가까우면 점 사이로 빠지고, 멀면 격자만 남는다. */
export const DOLLY_RANGE = { min: 3, max: 80 }

/** 북마크로 날아가는 시간(밀리초). 어디로 옮겨 가는지 눈으로 따라갈 수 있을 만큼만. */
export const FLIGHT_MS = 650

/**
 * 날아가는 동안 프레임을 부르는 방법. 브라우저에서는 `requestAnimationFrame`이고,
 * 시험에서는 손으로 시계를 돌린다.
 */
export type FrameClock = {
  now(): number
  request(step: () => void): number
  cancel(handle: number): void
  /** 움직임 줄이기를 켠 사람에게는 날지 않고 바로 옮긴다. */
  reducedMotion(): boolean
}

const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (step) => requestAnimationFrame(step),
  cancel: (handle) => cancelAnimationFrame(handle),
  reducedMotion: () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
}

/** 천천히 떠나 천천히 닿는다. 곧은 속도로 날면 도착할 때 덜컥 멈춘다. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function createOrbitDrive(
  orbit: () => OrbitLike | null,
  onRest: (camera: StoredCamera) => void,
  clock: FrameClock = browserClock,
): CameraDrive {
  // 프레임마다 새 벡터를 만들지 않는다. 손 추적은 초당 60번 부른다.
  const offset = new Vector3()
  const spherical = new Spherical()
  /** 날고 있으면 그 프레임 번호. 손이 끼어들면 이것을 끊는다. */
  let flight: number | null = null
  /** 날기 전 관성 설정. 날고 있지 않으면 undefined. */
  let damping: { rig: OrbitLike; was: boolean } | undefined

  /** 관성을 날기 전대로 돌려놓는다. */
  function restoreDamping() {
    if (damping === undefined) return
    damping.rig.enableDamping = damping.was
    damping = undefined
  }

  function land() {
    restoreDamping()
    if (flight === null) return
    clock.cancel(flight)
    flight = null
  }

  function place(rig: OrbitLike, camera: StoredCamera, t: number, from: StoredCamera) {
    rig.object.position.set(
      lerp(from.position[0], camera.position[0], t),
      lerp(from.position[1], camera.position[1], t),
      lerp(from.position[2], camera.position[2], t),
    )
    rig.target.set(
      lerp(from.target[0], camera.target[0], t),
      lerp(from.target[1], camera.target[1], t),
      lerp(from.target[2], camera.target[2], t),
    )
    rig.update()
  }

  const drive: CameraDrive = {
    rotate(azimuth, polar) {
      land()
      const rig = orbit()
      if (!rig) return
      offset.copy(rig.object.position).sub(rig.target)
      spherical.setFromVector3(offset)
      spherical.theta += azimuth
      spherical.phi = clamp(spherical.phi + polar, POLAR_MARGIN, Math.PI - POLAR_MARGIN)
      rig.object.position.copy(rig.target).add(offset.setFromSpherical(spherical))
      rig.update()
    },
    dolly(delta) {
      land()
      const rig = orbit()
      if (!rig) return
      offset.copy(rig.object.position).sub(rig.target)
      const distance = clamp(offset.length() - delta, DOLLY_RANGE.min, DOLLY_RANGE.max)
      rig.object.position.copy(rig.target).add(offset.setLength(distance))
      rig.update()
    },
    rest() {
      const rig = orbit()
      if (!rig) return
      const { x, y, z } = rig.object.position
      const look = rig.target
      onRest({ position: [x, y, z], target: [look.x, look.y, look.z] })
    },
    flyTo(camera) {
      land()
      const rig = orbit()
      if (!rig) return
      const p = rig.object.position
      const from: StoredCamera = {
        position: [p.x, p.y, p.z],
        target: [rig.target.x, rig.target.y, rig.target.z],
      }
      // 손을 막 놓은 뒤라면 남은 관성이 있다. 끄고 나서 옮겨야 도착점에 정확히 선다.
      if (rig.enableDamping !== undefined) {
        damping = { rig, was: rig.enableDamping }
        rig.enableDamping = false
        rig.update()
      }
      if (clock.reducedMotion()) {
        place(rig, camera, 1, from)
        restoreDamping()
        drive.rest()
        return
      }
      const start = clock.now()
      const step = () => {
        const live = orbit()
        // 날아가는 사이에 뷰가 닫혔으면 조용히 그만둔다.
        if (!live) {
          flight = null
          damping = undefined
          return
        }
        const t = clamp((clock.now() - start) / FLIGHT_MS, 0, 1)
        place(live, camera, easeInOut(t), from)
        if (t < 1) {
          flight = clock.request(step)
          return
        }
        flight = null
        restoreDamping()
        drive.rest()
      }
      flight = clock.request(step)
    },
  }
  return drive
}
