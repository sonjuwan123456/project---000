import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useRef } from 'react'
import type { Mesh } from 'three'
import { damp, holoColors } from '@holo/core'

/**
 * 자산이 하나도 없을 때 공간 감각만 보여주는 표식.
 * 유휴 자동 회전은 기본으로 끄기로 했으므로(설계 문서 7장) 스스로 돌지 않고,
 * 마우스를 올렸을 때만 살짝 떠오른다.
 */
function Placeholder() {
  const mesh = useRef<Mesh>(null)
  const hovered = useRef(false)

  useFrame((_, delta) => {
    if (!mesh.current) return
    const target = hovered.current ? 0.35 : 0
    mesh.current.position.y = damp(mesh.current.position.y, target, 0.01, delta)
  })

  return (
    <mesh
      ref={mesh}
      onPointerOver={() => (hovered.current = true)}
      onPointerOut={() => (hovered.current = false)}
    >
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color={holoColors.accent} wireframe />
    </mesh>
  )
}

export function EmptyWorkspace() {
  return (
    <Canvas camera={{ position: [3.5, 2.5, 4.5], fov: 45 }}>
      <color attach="background" args={[holoColors.bg]} />
      <fog attach="fog" args={[holoColors.bg, 8, 22]} />

      <Placeholder />

      <Grid
        args={[40, 40]}
        cellColor={holoColors.line}
        sectionColor={holoColors.faint}
        fadeDistance={24}
        position={[0, -1.4, 0]}
        infiniteGrid
      />

      <OrbitControls enablePan={false} makeDefault />

      <EffectComposer>
        <Bloom intensity={0.6} luminanceThreshold={0.2} mipmapBlur />
      </EffectComposer>
    </Canvas>
  )
}
