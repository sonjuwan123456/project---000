/**
 * 패널 표면 — 패널을 어디에 그리든 같은 방법으로 안을 누를 수 있게 하는 것(설계 문서 7장).
 *
 * 패널은 지금 화면 위 HTML(DOM)이다. 3D 공간에 띄우면 두 길이 있다. DOM을 겹쳐 두거나,
 * Chrome의 HTMLTexture(HTML-in-Canvas)로 캔버스 안에 텍스처로 그리거나. 뒤의 길에서는
 * `elementFromPoint`가 패널 안 요소를 찾지 못한다. 화면의 그 자리에 있는 것은 캔버스다.
 *
 * 그래서 입력을 화면 좌표가 아니라 **표면 좌표**로 받는다. 마우스든 손이든 3D 광선으로
 * 패널 평면을 맞히면 (u, v)가 나오고, 여기서 그 좌표를 패널 안 요소로 바꾼다. 요소를 찾는
 * 방법은 두 길이 같다. 요소마다 패널 안에서 차지한 사각형을 재어 그 점을 덮는 가장 깊은
 * 것을 고른다. HTMLTexture도 DOM 배치는 그대로 하므로 사각형은 잴 수 있다.
 */
import type { ViewEntry } from './viewRegistry'

export type SurfaceKind = 'dom' | 'html-texture'

/** 표면 좌표. 왼쪽 위가 (0, 0), 오른쪽 아래가 (1, 1). */
export type SurfacePoint = { readonly u: number; readonly v: number }

/** 패널이 앉은 곳. 화면 위 HUD인지, 3D 공간 속인지. */
export type SurfacePlacement = 'hud' | 'space'

export type SurfaceSupport = {
  /** 이 브라우저가 HTML을 캔버스 텍스처로 그릴 수 있는지. */
  readonly htmlTexture: boolean
}

type Rect = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * 표면이 다루는 요소에서 쓰는 만큼만. 실제로는 `Element`이고, 시험에서는 사각형만 가진
 * 가짜를 넘긴다.
 */
export type SurfaceNode = {
  getBoundingClientRect(): Rect
  readonly children: ArrayLike<SurfaceNode>
  readonly parentElement: SurfaceNode | null
  matches(selector: string): boolean
  click?(): void
}

export type PanelSurface = {
  readonly kind: SurfaceKind
  /** 표면 좌표를 덮는 가장 깊은 요소. 패널 밖이면 null. */
  elementAt(point: SurfacePoint): SurfaceNode | null
  /**
   * 표면 좌표를 누른다. 그 자리의 요소부터 위로 올라가며 누를 수 있는 것을 찾아 누른다.
   * 누른 것이 있으면 true.
   */
  press(point: SurfacePoint): boolean
}

/** 누를 수 있는 것. 글자나 빈칸을 눌러도 그것을 감싼 단추가 눌려야 한다. */
const PRESSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, label, [role="button"]'

/**
 * 브라우저가 HTMLTexture를 쓸 수 있는지 본다.
 *
 * 오리진 트라이얼 API라 이름이 바뀔 수 있다. 캔버스 2D의 `drawElementImage`와 WebGL의
 * `texElementImage2D` 중 하나라도 있으면 쓸 수 있는 것으로 본다.
 */
export function detectSurfaceSupport(scope: object = globalThis): SurfaceSupport {
  const has = (name: string, method: string) => {
    const owner = (scope as Record<string, unknown>)[name]
    if (typeof owner !== 'function') return false
    const proto = (owner as { prototype?: object }).prototype
    return proto !== undefined && method in proto
  }
  return {
    htmlTexture:
      has('CanvasRenderingContext2D', 'drawElementImage') ||
      has('WebGL2RenderingContext', 'texElementImage2D'),
  }
}

/**
 * 이 뷰를 어떤 표면에 그릴지. 캔버스에 직접 그리는 뷰(3D 무대)는 패널 표면이 없어 null.
 *
 * - 화면 위 HUD에 있으면 언제나 DOM이다. 이미 HTML이고 바꿀 까닭이 없다.
 * - 대용량 뷰(수만 행 표, 긴 글)는 3D 공간에서도 DOM이다(설계 문서 7장).
 * - 나머지는 3D 공간에 뜰 때 브라우저가 되면 HTMLTexture, 안 되면 DOM.
 */
export function surfaceKindFor(
  entry: ViewEntry,
  placement: SurfacePlacement,
  support: SurfaceSupport,
): SurfaceKind | null {
  if (entry.surface === 'canvas') return null
  if (placement === 'hud' || entry.large) return 'dom'
  return support.htmlTexture ? 'html-texture' : 'dom'
}

function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  )
}

/** 그 점을 덮는 가장 깊은 자손. 겹치면 나중에 놓인(위에 그려지는) 것을 고른다. */
function deepest(node: SurfaceNode, x: number, y: number): SurfaceNode {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]
    if (child === undefined) continue
    const rect = child.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && contains(rect, x, y)) return deepest(child, x, y)
  }
  return node
}

export function createPanelSurface(root: SurfaceNode, kind: SurfaceKind): PanelSurface {
  const surface: PanelSurface = {
    kind,
    elementAt({ u, v }) {
      if (u < 0 || u > 1 || v < 0 || v > 1) return null
      const box = root.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) return null
      return deepest(root, box.left + u * box.width, box.top + v * box.height)
    },
    press(point) {
      let node = surface.elementAt(point)
      while (node !== null) {
        if (node.matches(PRESSABLE) && typeof node.click === 'function') {
          node.click()
          return true
        }
        if (node === root) break
        node = node.parentElement
      }
      return false
    },
  }
  return surface
}
