/**
 * 패널 배치 — 무대 옆 패널의 폭과 아래 패널의 높이.
 *
 * 설계 문서 5장이 작업 공간에 "배치"를 두기로 한 자리다. 사람이 칸 사이 손잡이를 끌어
 * 크기를 바꾸면 여기 적힌 값이 바뀌고, 작업 공간과 함께 저장·내보내기·되돌리기된다.
 *
 * 옆 패널은 픽셀로, 아래 패널은 비율로 적는다. 옆 패널에 담기는 것(분포 그래프, 활동 기록)은
 * 글자 폭이 정해져 있어 화면이 넓어져도 같은 폭이 맞다. 아래 표는 화면 높이를 나눠 쓰는
 * 것이라, 내보낸 파일을 키가 다른 화면에서 열어도 같은 모양이 나오려면 비율이어야 한다.
 */
import { clamp } from './math'

export type PanelLayout = {
  /** 옆 패널 폭(CSS 픽셀). */
  readonly side: number
  /** 아래 패널이 무대와 나눠 쓰는 높이 중 차지하는 몫(0..1). */
  readonly bottom: number
}

/** 칸 사이 손잡이 이름. 끌 때 어느 값을 바꿀지 가른다. */
export type LayoutHandle = 'side' | 'bottom'

/**
 * 크기를 바꿀 수 있는 범위.
 *
 * 옆 패널이 220보다 좁으면 분포 그래프의 막대 이름과 개수가 겹친다. 아래 표가 너무
 * 낮으면 머리줄만 남고, 너무 높으면 3D 무대가 띠처럼 된다.
 */
export const LAYOUT_LIMITS = {
  side: { min: 220, max: 640 },
  bottom: { min: 0.15, max: 0.7 },
} as const

/** 지금까지 CSS로 고정돼 있던 모양 그대로다(옆 300px, 무대 1 : 표 0.8). */
export const DEFAULT_LAYOUT: PanelLayout = { side: 300, bottom: 0.8 / 1.8 }

/** 밖에서 온 값을 받을 수 있는 범위 안으로 넣는다. */
export function clampLayout(layout: PanelLayout): PanelLayout {
  return {
    side: Math.round(clamp(layout.side, LAYOUT_LIMITS.side.min, LAYOUT_LIMITS.side.max)),
    bottom: clamp(layout.bottom, LAYOUT_LIMITS.bottom.min, LAYOUT_LIMITS.bottom.max),
  }
}

/**
 * 손잡이를 `delta` 픽셀 옮긴 뒤의 배치.
 *
 * 옆 손잡이는 왼쪽으로 끌수록(음수) 패널이 넓어진다. 패널이 오른쪽에 붙어 있기 때문이다.
 * 아래 손잡이는 위로 끌수록(음수) 표가 커진다. `span`은 무대와 아래 패널이 나눠 쓰는
 * 전체 높이로, 픽셀 움직임을 비율로 바꾸는 데 쓴다.
 */
export function resizeLayout(
  layout: PanelLayout,
  handle: LayoutHandle,
  delta: number,
  span: number,
): PanelLayout {
  if (handle === 'side') return clampLayout({ ...layout, side: layout.side - delta })
  if (span <= 0) return layout
  return clampLayout({ ...layout, bottom: layout.bottom - delta / span })
}

/** 두 배치가 같은지. 저장할 것이 있는지 볼 때 쓴다. */
export function sameLayout(a: PanelLayout, b: PanelLayout): boolean {
  return a.side === b.side && Math.abs(a.bottom - b.bottom) < 1e-6
}
