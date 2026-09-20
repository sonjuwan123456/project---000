import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Vector3,
  type Camera,
  type ShaderMaterial,
} from 'three'
import { categoryPalette, holoColors, type RowMask, type StoredCamera } from '@holo/core'
import type { ClusterAnchor, Positions } from '@holo/data'
import {
  glowPass,
  maxPixelRatio,
  pointsFragmentShader,
  pointsVertexShader,
  type EffectLevel,
} from '@holo/holo-fx'
import { ClusterLabels } from './ClusterLabels'

/**
 * 3D 점 뷰 — 설계 문서 5장의 "강조" 반응을 맡는 뷰.
 *
 * 선택되지 않은 점도 지우지 않고 흐리게 남긴다. 군집의 전체 모양이 남아야
 * 어디를 골랐는지 읽히기 때문이다. 점 수만 개를 감당하려고 점마다 오브젝트를
 * 만들지 않고 버퍼 하나에 담아 한 번에 그린다.
 */
export type PointCloudViewProps = {
  rowCount: number
  /** 그릴 좌표. 좌표가 없는 행은 그리지 않는다. */
  positions: Positions
  /** 행 → 팔레트 자리. */
  colorOf: (row: number) => number
  /** 코디네이터가 합친 선택. null이면 전체가 선택된 것으로 본다. */
  selected: RowMask | null
  effect: EffectLevel
  /** 올가미 모드. 켜져 있으면 드래그가 카메라 대신 선택을 그린다. */
  lasso: boolean
  onHover: (row: number | null) => void
  onLasso: (rows: RowMask | null, count: number) => void
  /** 군집 라벨을 얹을 자리. 비어 있으면 라벨을 그리지 않는다. */
  anchors?: readonly ClusterAnchor[]
  /** 되살릴 카메라. 첫 프레임에만 쓴다. */
  camera: StoredCamera | null
  /** 카메라를 놓은 순간의 위치. 드래그하는 동안에는 부르지 않는다. */
  onCameraRest: (camera: StoredCamera) => void
}

type CameraHandle = { camera: Camera; width: number; height: number } | null

/** 카메라를 되살릴 것이 없을 때의 자리. */
const DEFAULT_CAMERA: readonly [number, number, number] = [11, 7, 15]

/** drei의 컨트롤 인스턴스 타입. 직접 적으면 ref 타입이 맞지 않는다. */
type OrbitControlsHandle = ComponentRef<typeof OrbitControls>

/**
 * 그린 점과 원래 행 번호를 함께 들고 있는 것.
 *
 * 좌표가 없는 행(벡터 길이가 어긋났거나 숫자 칸이 비었다)은 버퍼에 넣지 않는다.
 * 원점에 몰아 두면 없는 자료가 군집처럼 보이기 때문이다. 대신 버퍼 자리와 행 번호가
 * 어긋나므로 `rows`로 되돌린다.
 */
type Cloud = {
  readonly geometry: BufferGeometry
  /** 버퍼 자리 → 원래 행 번호. */
  readonly rows: Int32Array
}

function buildCloud(rowCount: number, source: Positions, colorOf: (row: number) => number): Cloud {
  const drawn: number[] = []
  for (let row = 0; row < rowCount; row += 1) {
    if (source.missing[row] !== 1) drawn.push(row)
  }
  const rows = Int32Array.from(drawn)
  const count = rows.length

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const selected = new Float32Array(count).fill(1)
  const seeds = new Float32Array(count)
  const palette = categoryPalette()
  const paletteLength = palette.length / 3

  for (let index = 0; index < count; index += 1) {
    const row = rows[index] ?? 0
    positions[index * 3] = source.x[row] ?? 0
    positions[index * 3 + 1] = source.y[row] ?? 0
    positions[index * 3 + 2] = source.z[row] ?? 0

    const slot = (((colorOf(row) % paletteLength) + paletteLength) % paletteLength) * 3
    colors[index * 3] = palette[slot] ?? 1
    colors[index * 3 + 1] = palette[slot + 1] ?? 1
    colors[index * 3 + 2] = palette[slot + 2] ?? 1

    // 등장 연출을 점마다 조금씩 어긋나게 한다. 난수를 쓰면 다시 그릴 때마다 달라진다.
    seeds[index] = (row % 97) / 97
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
  geometry.setAttribute('aSelected', new BufferAttribute(selected, 1))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1))
  geometry.computeBoundingSphere()
  return { geometry, rows }
}

function CameraBridge({ handle }: { handle: RefObject<CameraHandle> }) {
  const { camera, size } = useThree()
  useEffect(() => {
    handle.current = { camera, width: size.width, height: size.height }
  }, [camera, size, handle])
  return null
}

function PointCloud(props: {
  rowCount: number
  positions: Positions
  colorOf: (row: number) => number
  selected: RowMask | null
  effect: EffectLevel
  onHover: (row: number | null) => void
}) {
  const { rowCount, positions, colorOf, selected, effect, onHover } = props
  const cloud = useMemo(
    () => buildCloud(rowCount, positions, colorOf),
    [rowCount, positions, colorOf],
  )
  const { geometry, rows: drawnRows } = cloud
  const core = useRef<ShaderMaterial>(null)
  const glow = useRef<ShaderMaterial>(null)
  const reveal = useRef(0)
  const hovered = useRef<number | null>(null)
  const { size, viewport } = useThree()

  useEffect(() => () => geometry.dispose(), [geometry])

  // 선택이 바뀌어도 위치와 색 버퍼는 그대로 두고 aSelected만 덮어쓴다.
  useEffect(() => {
    const attribute = geometry.getAttribute('aSelected') as BufferAttribute
    const values = attribute.array as Float32Array
    if (selected === null) values.fill(1)
    else
      for (let index = 0; index < values.length; index += 1) {
        values[index] = selected[drawnRows[index] ?? 0] === 1 ? 1 : 0
      }
    attribute.needsUpdate = true
  }, [geometry, selected, drawnRows])

  // 등장 연출은 한 번만 재생한다. 움직임을 줄인 환경에서는 건너뛴다.
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    reveal.current = reduced ? 1 : 0
  }, [geometry])

  const coreUniforms = useMemo(
    () => ({
      uSize: { value: 40 },
      uSizeScale: { value: 1 },
      uAlpha: { value: 1 },
      uReveal: { value: 0 },
    }),
    [],
  )
  const glowUniforms = useMemo(
    () => ({
      uSize: { value: 40 },
      uSizeScale: { value: 2.4 },
      uAlpha: { value: 0.14 },
      uReveal: { value: 0 },
    }),
    [],
  )

  useFrame((_, delta) => {
    if (reveal.current < 1) reveal.current = Math.min(1, reveal.current + delta / 1.1)
    // 점 크기는 화면 높이와 픽셀 비율을 따라간다. 창을 줄이면 점도 같이 작아져야 한다.
    const base = 104 * Math.min(viewport.dpr, maxPixelRatio(effect)) * (size.height / 760)
    for (const material of [core.current, glow.current]) {
      if (!material) continue
      material.uniforms.uSize!.value = base
      material.uniforms.uReveal!.value = reveal.current
    }
  })

  const pass = glowPass(effect)

  function handleMove(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation()
    const index = event.index ?? null
    const row = index === null ? null : (drawnRows[index] ?? null)
    if (row === hovered.current) return
    hovered.current = row
    onHover(row)
  }
  function handleOut() {
    if (hovered.current === null) return
    hovered.current = null
    onHover(null)
  }

  return (
    <>
      {pass === null ? null : (
        <points geometry={geometry} frustumCulled={false}>
          <shaderMaterial
            ref={glow}
            uniforms={glowUniforms}
            vertexShader={pointsVertexShader}
            fragmentShader={pointsFragmentShader}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </points>
      )}
      <points
        geometry={geometry}
        frustumCulled={false}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
      >
        <shaderMaterial
          ref={core}
          uniforms={coreUniforms}
          vertexShader={pointsVertexShader}
          fragmentShader={pointsFragmentShader}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </>
  )
}

/** 화면에 그린 다각형 안에 든 점을 고른다. 카메라가 보고 있는 그대로 판정한다. */
function pickInsidePolygon(
  rowCount: number,
  source: Positions,
  polygon: readonly (readonly [number, number])[],
  handle: NonNullable<CameraHandle>,
): { rows: RowMask; count: number } {
  const { camera, width, height } = handle
  const rows = new Uint8Array(rowCount)
  const point = new Vector3()
  let count = 0

  for (let row = 0; row < rowCount; row += 1) {
    // 좌표가 없는 행은 화면에 없으니 올가미로도 고를 수 없다.
    if (source.missing[row] === 1) continue
    point.set(source.x[row] ?? 0, source.y[row] ?? 0, source.z[row] ?? 0).project(camera)
    if (point.z > 1) continue // 카메라 뒤나 far 평면 밖
    const px = (point.x * 0.5 + 0.5) * width
    const py = (1 - (point.y * 0.5 + 0.5)) * height

    let inside = false
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a, a += 1) {
      const [ax, ay] = polygon[a] ?? [0, 0]
      const [bx, by] = polygon[b] ?? [0, 0]
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside
    }
    if (inside) {
      rows[row] = 1
      count += 1
    }
  }
  return { rows, count }
}

function LassoLayer(props: {
  rowCount: number
  positions: Positions
  handle: RefObject<CameraHandle>
  onLasso: (rows: RowMask | null, count: number) => void
}) {
  const { rowCount, positions, handle, onLasso } = props
  const path = useRef<[number, number][]>([])
  const shape = useRef<SVGPolygonElement>(null)

  function toLocal(event: React.PointerEvent<HTMLDivElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect()
    return [event.clientX - box.left, event.clientY - box.top]
  }
  function draw() {
    if (!shape.current) return
    shape.current.setAttribute('points', path.current.map(([x, y]) => `${x},${y}`).join(' '))
  }

  return (
    <div
      className="holo-lasso"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        path.current = [toLocal(event)]
        draw()
      }}
      onPointerMove={(event) => {
        if (path.current.length === 0) return
        const next = toLocal(event)
        const last = path.current[path.current.length - 1] ?? next
        if (Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) < 3) return
        path.current.push(next)
        draw()
      }}
      onPointerUp={() => {
        const polygon = path.current
        path.current = []
        draw()
        if (polygon.length < 6 || !handle.current) {
          onLasso(null, 0)
          return
        }
        const picked = pickInsidePolygon(rowCount, positions, polygon, handle.current)
        if (picked.count === 0) onLasso(null, 0)
        else onLasso(picked.rows, picked.count)
      }}
    >
      <svg className="holo-lasso-path">
        <polygon ref={shape} points="" />
      </svg>
    </div>
  )
}

export function PointCloudView(props: PointCloudViewProps) {
  const { rowCount, positions, colorOf, selected, effect, lasso } = props
  const { onHover, onLasso, camera, onCameraRest } = props
  const anchors = props.anchors ?? []
  const handle = useRef<CameraHandle>(null)
  const controls = useRef<OrbitControlsHandle>(null)
  const start = camera?.position ?? DEFAULT_CAMERA

  // 되살린 카메라는 첫 프레임에 한 번만 앉힌다. 그 뒤로는 사용자가 움직인 것이 진짜다.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || camera === null || !controls.current) return
    restored.current = true
    controls.current.target.set(...camera.target)
    controls.current.update()
  }, [camera])

  return (
    <div className="holo-stage">
      <Canvas
        camera={{ position: [...start], fov: 45, far: 200 }}
        dpr={[1, maxPixelRatio(effect)]}
        // 점은 크기가 0이라 기본 판정 반경으로는 잡히지 않는다. 화면의 점 크기에 맞춰 넓힌다.
        onCreated={({ raycaster }) => {
          raycaster.params.Points.threshold = 0.22
        }}
      >
        <color attach="background" args={[holoColors.bg]} />
        <CameraBridge handle={handle} />
        <PointCloud
          rowCount={rowCount}
          positions={positions}
          colorOf={colorOf}
          selected={selected}
          effect={effect}
          onHover={onHover}
        />
        <Grid
          args={[60, 60]}
          cellColor={holoColors.line}
          sectionColor={holoColors.line}
          fadeDistance={42}
          position={[0, -6, 0]}
          infiniteGrid
        />
        {/* 유휴 자동 회전은 기본으로 끈다. 분석 도구를 오래 보고 있어야 하기 때문이다. */}
        <OrbitControls
          ref={controls}
          makeDefault
          enabled={!lasso}
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
      {anchors.length > 0 ? <ClusterLabels anchors={anchors} view={handle} /> : null}
      {lasso ? (
        <LassoLayer rowCount={rowCount} positions={positions} handle={handle} onLasso={onLasso} />
      ) : null}
    </div>
  )
}
