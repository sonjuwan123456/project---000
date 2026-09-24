import { describe, expect, it } from 'vitest'
import {
  createPanelSurface,
  detectSurfaceSupport,
  surfaceKindFor,
  type SurfaceNode,
} from './panelSurface'
import { viewEntry } from './viewRegistry'

type Fake = SurfaceNode & { name: string; clicks: number; children: Fake[] }

/** 사각형과 이름만 가진 가짜 요소. `tag`로 누를 수 있는 것인지 가른다. */
function node(
  name: string,
  rect: [number, number, number, number],
  tag: 'div' | 'button' = 'div',
  children: Fake[] = [],
): Fake {
  const [left, top, width, height] = rect
  const self: Fake = {
    name,
    clicks: 0,
    children,
    parentElement: null,
    getBoundingClientRect: () => ({ left, top, width, height }),
    matches: (selector) => tag === 'button' && selector.includes('button'),
    click() {
      self.clicks += 1
    },
  }
  for (const child of children)
    (child as { parentElement: SurfaceNode | null }).parentElement = self
  return self
}

/** 200x100 패널. 왼쪽 반에 단추 하나, 그 안에 글자 하나. 오른쪽 반은 빈 글상자. */
function panel() {
  const label = node('label', [120, 60, 40, 20])
  const button = node('button', [100, 50, 100, 100], 'button', [label])
  const note = node('note', [200, 50, 100, 100])
  const root = node('root', [100, 50, 200, 100], 'div', [button, note])
  return { root, button, label, note }
}

describe('createPanelSurface', () => {
  it('표면 좌표를 패널 안에서 그 자리를 덮는 가장 깊은 요소로 바꾼다', () => {
    const { root, label, note } = panel()
    const surface = createPanelSurface(root, 'dom')

    expect((surface.elementAt({ u: 0.15, v: 0.2 }) as Fake).name).toBe(label.name)
    expect((surface.elementAt({ u: 0.75, v: 0.5 }) as Fake).name).toBe(note.name)
  })

  it('패널 밖 좌표는 아무것도 가리키지 않는다', () => {
    const surface = createPanelSurface(panel().root, 'dom')
    expect(surface.elementAt({ u: -0.1, v: 0.5 })).toBeNull()
    expect(surface.elementAt({ u: 0.5, v: 1.2 })).toBeNull()
  })

  it('단추 안 글자를 눌러도 단추가 눌린다', () => {
    const { root, button } = panel()
    const surface = createPanelSurface(root, 'html-texture')

    expect(surface.press({ u: 0.15, v: 0.2 })).toBe(true)
    expect(button.clicks).toBe(1)
  })

  it('누를 것이 없는 자리는 눌러도 아무 일이 없다', () => {
    const { root, button, note } = panel()
    const surface = createPanelSurface(root, 'dom')

    expect(surface.press({ u: 0.75, v: 0.5 })).toBe(false)
    expect(button.clicks + note.clicks + root.clicks).toBe(0)
  })

  it('보이지 않는(크기 0) 요소는 건너뛴다', () => {
    const hidden = node('hidden', [100, 50, 0, 0], 'button')
    const root = node('root', [100, 50, 200, 100], 'div', [hidden])
    const surface = createPanelSurface(root, 'dom')

    expect((surface.elementAt({ u: 0, v: 0 }) as Fake).name).toBe('root')
    expect(surface.press({ u: 0, v: 0 })).toBe(false)
  })
})

describe('surfaceKindFor', () => {
  const yes = { htmlTexture: true }
  const no = { htmlTexture: false }

  it('3D 무대는 패널 표면이 없다', () => {
    expect(surfaceKindFor(viewEntry('points'), 'space', yes)).toBeNull()
    expect(surfaceKindFor(viewEntry('model'), 'hud', no)).toBeNull()
  })

  it('화면 위 HUD 패널은 언제나 DOM이다', () => {
    expect(surfaceKindFor(viewEntry('distribution'), 'hud', yes)).toBe('dom')
  })

  it('3D 공간 속 패널은 되는 브라우저에서만 HTMLTexture로 간다', () => {
    expect(surfaceKindFor(viewEntry('distribution'), 'space', yes)).toBe('html-texture')
    expect(surfaceKindFor(viewEntry('distribution'), 'space', no)).toBe('dom')
  })

  it('대용량 표와 글은 3D 공간에서도 DOM이다', () => {
    expect(surfaceKindFor(viewEntry('table'), 'space', yes)).toBe('dom')
    expect(surfaceKindFor(viewEntry('text'), 'space', yes)).toBe('dom')
  })
})

describe('detectSurfaceSupport', () => {
  it('HTML-in-Canvas 함수가 있을 때만 된다고 본다', () => {
    class Plain {}
    class WithDraw {
      drawElementImage() {}
    }
    class WithTexture {
      texElementImage2D() {}
    }
    expect(detectSurfaceSupport({}).htmlTexture).toBe(false)
    expect(detectSurfaceSupport({ CanvasRenderingContext2D: Plain }).htmlTexture).toBe(false)
    expect(detectSurfaceSupport({ CanvasRenderingContext2D: WithDraw }).htmlTexture).toBe(true)
    expect(detectSurfaceSupport({ WebGL2RenderingContext: WithTexture }).htmlTexture).toBe(true)
  })
})
