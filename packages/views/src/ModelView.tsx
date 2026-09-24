import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import {
  AdditiveBlending,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  PMREMGenerator,
  ShaderMaterial,
  Vector3,
  type Material,
  type WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { holoColors, type CameraDrive, type StoredCamera } from '@holo/core'
import type { ModelFormat } from '@holo/data'
import { disposeScene } from './gltfParse'
import { parseModel } from './modelParse'

import {
  maxPixelRatio,
  modelFragmentShader,
  modelUniforms,
  modelVertexShader,
  type EffectLevel,
} from '@holo/holo-fx'
import { createOrbitDrive } from './orbitDrive'

/**
 * 3D 모델 뷰 — 설계 문서 5장에서 선택에 참여하지 않는 뷰.
 *
 * 표 데이터의 점 뷰와 한 무대를 쓰지만 하는 일이 다르다. 점 뷰는 수만 개를 한 버퍼에
 * 담아 그리는 것이 전부였고, 여기서는 남이 만든 장면을 그대로 받아 놓는다. 그래서
 * 어려운 자리도 다르다. 어떤 크기로 올지 모른다는 것이다. 블렌더 기본 큐브는 2미터고
 * 스캔한 건물은 수백 미터라, 받은 그대로 놓으면 열에 아홉은 화면 밖이거나 점만 하다.
 * 받아서 무대 크기에 맞춰 다시 앉히는 일을 이 뷰가 맡는다.
 *
 * 표시 모드가 둘인 까닭은 설계 문서 2장의 완료 기준이 둘을 다 요구하기 때문이다.
 * "블렌더에서 내보낸 GLB가 원본 재질로 보임"은 원본 모드가, 같은 공간의 점·표와 한
 * 화면으로 읽히는 것은 홀로그램 모드가 맡는다.
 */
export type ModelDisplayMode = 'original' | 'hologram'

export type ModelViewProps = {
  /** 바이트를 무엇으로 풀지. GLB·glTF·OBJ·STL. */
  format: ModelFormat
  /** 원본 바이트. 이것이 바뀔 때만 다시 파싱한다. */
  bytes: ArrayBuffer
  /**
   * glTF가 가리키는 바깥 파일. 데이터층이 폴더·zip에서 찾아 온 것이다.
   *
   * 키는 glTF에 **적힌 그대로의 uri**다. three가 물어 올 때도 적힌 그대로 물어
   * 오지만, 도구마다 `./`나 `%20`을 섞어 쓰므로 찾을 때 한 번 더 맞춰 본다.
   */
  resources?: ReadonlyMap<string, ArrayBuffer>
  mode: ModelDisplayMode
  effect: EffectLevel
  /** 되살릴 카메라. 첫 프레임에만 쓴다. */
  camera: StoredCamera | null
  /** 카메라를 놓은 순간의 위치. 드래그하는 동안에는 부르지 않는다. */
  onCameraRest: (camera: StoredCamera) => void
  /** 손 제스처가 카메라를 움직일 수 있게 내주는 손잡이. */
  drive?: RefObject<CameraDrive | null>
  /** 파싱이 끝났거나 실패했을 때. 실패하면 사람이 읽을 문구가 온다. */
  onStatus?: (status: 'loading' | 'ready' | 'failed', message: string | null) => void
}

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>

/** 카메라를 되살릴 것이 없을 때의 자리. 점 뷰와 같은 곳에서 본다. */
const DEFAULT_CAMERA: readonly [number, number, number] = [11, 7, 15]
/** 격자 높이. 모델 바닥을 여기에 붙인다. */
const GRID_Y = -6
/** 어떤 크기로 오든 가장 긴 변을 이 길이로 맞춘다. */
const TARGET_SIZE = 10

type Parsed =
  { kind: 'loading' } | { kind: 'ready'; root: Group } | { kind: 'failed'; message: string }

/**
 * 바이트를 three 장면으로 푼다.
 *
 * `parse`를 쓰고 `load`를 쓰지 않는다. 파일은 이미 손에 있고, 주소로 다시 받아 올
 * 것이 없기 때문이다. 바깥 파일을 가리키는 `.gltf`는 여기서 실패하는데, 데이터층이
 * 열기 전에 이미 그 사실을 세어 두었으므로 사람은 까닭을 먼저 읽는다.
 */
function useParsedModel(
  format: ModelFormat,
  bytes: ArrayBuffer,
  resources: ReadonlyMap<string, ArrayBuffer> | undefined,
): Parsed {
  const [parsed, setParsed] = useState<Parsed>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    setParsed({ kind: 'loading' })

    const parsed = parseModel(format, bytes, resources)
    void parsed.scene.then(
      (root) => {
        if (alive) setParsed({ kind: 'ready', root })
      },
      (error: unknown) => {
        if (!alive) return
        const detail = error instanceof Error ? error.message : String(error)
        setParsed({ kind: 'failed', message: `3D 모델을 푸는 중에 멈췄습니다. ${detail}` })
      },
    )
    // 만든 Blob 주소는 우리가 거둬야 한다. 브라우저는 탭이 닫힐 때까지 쥐고 있다.
    return () => {
      alive = false
      parsed.release()
    }
  }, [format, bytes, resources])

  /*
   * 장면을 버릴 때 GPU 자원을 직접 돌려준다. three는 참조가 끊겨도 스스로 반납하지
   * 않는다. 모델을 몇 개 갈아 끼우는 사이에 텍스처가 쌓이면 탭이 그대로 죽는다.
   */
  useEffect(() => {
    if (parsed.kind !== 'ready') return
    const { root } = parsed
    return () => disposeScene(root)
  }, [parsed])

  return parsed
}

/**
 * 받은 크기가 무엇이든 무대에 맞춰 앉힌다.
 *
 * 가장 긴 변을 기준으로 줄이고 바닥을 격자에 붙인다. 가운데를 원점에 맞추기만 하면
 * 키가 큰 모델이 격자를 뚫고 내려가, 서 있는 것이 아니라 잠긴 것처럼 보인다.
 */
export function fitToStage(root: Group): { scale: number; position: Vector3 } {
  root.position.set(0, 0, 0)
  root.scale.setScalar(1)
  root.updateMatrixWorld(true)

  const box = new Box3().setFromObject(root)
  if (box.isEmpty()) return { scale: 1, position: new Vector3(0, GRID_Y, 0) }

  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  const scale = longest > 0 ? TARGET_SIZE / longest : 1

  return {
    scale,
    position: new Vector3(
      -center.x * scale,
      -center.y * scale + (size.y * scale) / 2 + GRID_Y,
      -center.z * scale,
    ),
  }
}

/** 방 하나짜리 환경맵으로 원본 재질을 비춘다. */
function RoomLighting({ on }: { on: boolean }) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    if (!on) return
    /*
     * 환경맵 파일을 내려받지 않고 three가 들고 있는 방 장면에서 만든다. 설계 문서
     * 10장이 "환경맵 파일 선정과 라이선스 확인"을 남은 과제로 둔 자리인데, 파일을
     * 고르는 대신 없애는 쪽으로 답했다. 받아 올 것이 없으니 라이선스도, 막힌 망에서
     * 조명만 빠지는 일도 없다. 정해진 HDRI가 필요해지면 그때 바꿀 수 있다.
     */
    const pmrem = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    let target: WebGLRenderTarget | null = null
    try {
      target = pmrem.fromScene(room, 0.04)
      scene.environment = target.texture
    } catch {
      // 환경맵을 못 만들어도 모델은 보여야 한다. 조명만 빠진다.
    }
    return () => {
      scene.environment = null
      target?.dispose()
      room.dispose?.()
      pmrem.dispose()
    }
  }, [gl, scene, on])

  return null
}

/** 파싱한 장면을 무대에 올린다. 표시 모드에 따라 재질을 갈아 끼운다. */
function Stage({
  root,
  mode,
  effect,
}: {
  root: Group
  mode: ModelDisplayMode
  effect: EffectLevel
}) {
  const values = useMemo(() => modelUniforms(effect), [effect])
  const uniforms = useMemo(
    () => ({
      uColor: { value: [...values.uColor] },
      uRimPower: { value: values.uRimPower },
      uBase: { value: values.uBase },
      uScanStrength: { value: values.uScanStrength },
      uScanDensity: { value: values.uScanDensity },
      uTime: { value: 0 },
    }),
    [values],
  )

  const holo = useMemo(
    () =>
      new ShaderMaterial({
        uniforms,
        vertexShader: modelVertexShader,
        fragmentShader: modelFragmentShader,
        transparent: true,
        blending: AdditiveBlending,
        // 깊이를 쓰지 않아야 겹친 면이 쌓이면서 두께가 읽힌다.
        depthWrite: false,
        side: DoubleSide,
      }),
    [uniforms],
  )
  useEffect(() => () => holo.dispose(), [holo])

  useEffect(() => {
    const { scale, position } = fitToStage(root)
    root.scale.setScalar(scale)
    root.position.copy(position)
  }, [root])

  /*
   * 원본 재질을 버리지 않고 맡아 둔다. 홀로그램 모드로 갔다가 돌아오는 것이 흔한
   * 조작인데, 갈아 끼울 때 원본을 잃으면 되돌아올 자리가 없다.
   */
  useEffect(() => {
    if (mode !== 'hologram') return
    const kept = new Map<Mesh, Material | Material[]>()
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      kept.set(object, object.material)
      object.material = holo
    })
    return () => {
      for (const [mesh, material] of kept) mesh.material = material
    }
  }, [root, mode, holo])

  useFrame((state) => {
    if (values.uScanStrength > 0) uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <>
      <RoomLighting on={mode === 'original'} />
      {/* 환경맵만으로는 그림자 쪽이 새까맣다. 약한 채움 조명 하나를 같이 둔다. */}
      {mode === 'original' ? <directionalLight position={[6, 10, 8]} intensity={1.1} /> : null}
      <primitive object={root} />
    </>
  )
}

export function ModelView(props: ModelViewProps) {
  const { format, bytes, resources, mode, effect, camera, onCameraRest, drive, onStatus } = props
  const parsed = useParsedModel(format, bytes, resources)
  const controls = useRef<OrbitControlsHandle>(null)
  const start = camera?.position ?? DEFAULT_CAMERA

  useEffect(() => {
    if (!onStatus) return
    if (parsed.kind === 'failed') onStatus('failed', parsed.message)
    else onStatus(parsed.kind === 'ready' ? 'ready' : 'loading', null)
  }, [parsed, onStatus])

  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || camera === null || !controls.current) return
    restored.current = true
    controls.current.target.set(...camera.target)
    controls.current.update()
  }, [camera])

  useEffect(() => {
    if (!drive) return
    drive.current = createOrbitDrive(() => controls.current, onCameraRest)
    return () => {
      drive.current = null
    }
  }, [drive, onCameraRest])

  return (
    <div className="holo-stage">
      <Canvas camera={{ position: [...start], fov: 45, far: 200 }} dpr={[1, maxPixelRatio(effect)]}>
        <color attach="background" args={[holoColors.bg]} />
        {parsed.kind === 'ready' ? <Stage root={parsed.root} mode={mode} effect={effect} /> : null}
        <Grid
          args={[60, 60]}
          cellColor={holoColors.line}
          sectionColor={holoColors.line}
          fadeDistance={42}
          position={[0, GRID_Y, 0]}
          infiniteGrid
        />
        <OrbitControls
          ref={controls}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          onEnd={() => {
            const rig = controls.current
            if (!rig) return
            const { x, y, z } = rig.object.position
            const look = rig.target
            onCameraRest({ position: [x, y, z], target: [look.x, look.y, look.z] })
          }}
        />
      </Canvas>
    </div>
  )
}
