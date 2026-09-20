import { Spherical, Vector3 } from 'three'
import { clamp, type CameraDrive, type StoredCamera } from '@holo/core'

/**
 * drei 컨트롤을 손 제스처가 쓸 수 있는 손잡이로 감싼다.
 *
 * 컨트롤 자체가 아니라 필요한 부분만 받는다. 그래야 WebGL 없이 시험할 수 있다.
 */
export type OrbitLike = {
  object: { position: Vector3 }
  target: Vector3
  update(): void
}

/** 바로 위·아래를 넘어가면 화면이 뒤집힌다. 그 앞에서 멈춘다. */
export const POLAR_MARGIN = 0.05

/** 손으로 확대할 수 있는 범위. 너무 가까우면 점 사이로 빠지고, 멀면 격자만 남는다. */
export const DOLLY_RANGE = { min: 3, max: 80 }

export function createOrbitDrive(
  orbit: () => OrbitLike | null,
  onRest: (camera: StoredCamera) => void,
): CameraDrive {
  // 프레임마다 새 벡터를 만들지 않는다. 손 추적은 초당 60번 부른다.
  const offset = new Vector3()
  const spherical = new Spherical()

  return {
    rotate(azimuth, polar) {
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
  }
}
