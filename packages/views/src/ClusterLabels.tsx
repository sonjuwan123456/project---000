import { useEffect, useRef, type RefObject } from 'react'
import { Vector3, type Camera } from 'three'
import { layoutLabels, type LabelBox } from '@holo/core'
import type { ClusterAnchor } from '@holo/data'

/**
 * 군집 라벨 — 어느 덩어리가 무엇인지 3D 안에서 바로 읽게 한다.
 *
 * 카메라를 돌리면 라벨이 서로 겹치므로 자리는 `layoutLabels`가 정한다(설계 문서 9장이
 * 남겨 둔 라벨 충돌 회피). 무게중심을 구하는 일은 데이터층(`anchorsOf`)이 한다.
 *
 * 라벨은 캔버스에 그리지 않고 위에 얹은 DOM이다. 글자는 DOM이 훨씬 선명하고 몇 개뿐이라
 * 비용도 없다. 대신 카메라를 따라 매 프레임 움직여야 하므로 React를 다시 돌리지 않고
 * 위치만 ref로 직접 쓴다. 군집이 바뀔 때만 React가 다시 그린다.
 *
 * 고른 개수는 적지 않는다. 옆 범주 막대가 같은 숫자를 이미 들고 있고, 라벨이 좁을수록
 * 자리 다툼에서 살아남는 것이 많아진다.
 */
export type ClusterLabelsProps = {
  anchors: readonly ClusterAnchor[]
  /** 3D 무대의 카메라와 크기. `PointCloudView`가 캔버스 안에서 채워 준다. */
  view: RefObject<{ camera: Camera; width: number; height: number } | null>
}

type Size = { width: number; height: number }

export function ClusterLabels({ anchors, view }: ClusterLabelsProps) {
  const nodes = useRef(new Map<number, HTMLDivElement>())
  const sizes = useRef(new Map<number, Size>())

  // 라벨 크기를 한 번 재서 자리 다툼에 넘긴다. 글자 수가 달라 폭이 저마다 다르고,
  // 어림값을 쓰면 좁은 라벨은 헛되게 밀리고 넓은 라벨은 겹친 채로 남는다.
  useEffect(() => {
    sizes.current.clear()
    for (const anchor of anchors) {
      const node = nodes.current.get(anchor.slot)
      if (!node) continue
      sizes.current.set(anchor.slot, { width: node.offsetWidth, height: node.offsetHeight })
    }
  }, [anchors])

  useEffect(() => {
    const point = new Vector3()
    let frame = 0

    const place = () => {
      frame = requestAnimationFrame(place)
      const stage = view.current
      if (!stage) return

      const boxes: LabelBox[] = []
      for (const anchor of anchors) {
        const size = sizes.current.get(anchor.slot)
        if (!size || size.width === 0) continue
        point.set(...anchor.position).project(stage.camera)
        // 카메라 뒤로 넘어간 군집은 자리 다툼에서 빼고 감춘다.
        if (point.z > 1) continue
        boxes.push({
          id: String(anchor.slot),
          x: (point.x * 0.5 + 0.5) * stage.width,
          y: (1 - (point.y * 0.5 + 0.5)) * stage.height,
          width: size.width,
          height: size.height,
          priority: anchor.size,
        })
      }

      const placed = layoutLabels(boxes, { width: stage.width, height: stage.height })
      const shown = new Set<string>()
      for (const label of placed) {
        shown.add(label.id)
        const node = nodes.current.get(Number(label.id))
        if (!node) continue
        node.style.transform = `translate3d(${Math.round(label.x)}px, ${Math.round(label.y)}px, 0)`
        node.style.opacity = '1'
      }
      // 자리를 못 얻은 것은 지운다. 억지로 끼워 넣으면 가리키는 곳을 잃는다.
      for (const anchor of anchors) {
        if (shown.has(String(anchor.slot))) continue
        const node = nodes.current.get(anchor.slot)
        if (node) node.style.opacity = '0'
      }
    }

    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [anchors, view])

  return (
    <div className="holo-labels">
      {anchors.map((anchor) => (
        <div
          key={anchor.slot}
          className="holo-cluster-label"
          ref={(node) => {
            if (node) nodes.current.set(anchor.slot, node)
            else nodes.current.delete(anchor.slot)
          }}
        >
          <span
            className="holo-cluster-dot"
            style={{ background: `var(--holo-cat-${anchor.color})` }}
          />
          {anchor.name}
        </div>
      ))}
    </div>
  )
}
