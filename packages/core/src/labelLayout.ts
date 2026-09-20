/**
 * 화면 라벨 자리 잡기 — 설계 문서 9장이 "3D 라벨은 쉽게 겹친다"고 적어 둔 위험에 대한 답.
 *
 * 3D 안의 한 점에 글자를 붙이면 카메라를 돌릴 때마다 라벨이 서로 겹쳐 읽을 수 없게 된다.
 * 여기서는 화면 좌표로 옮긴 뒤 겹치는 것을 밀어내거나 버린다. 밀어서도 안 되면 버리는 쪽을
 * 고른 이유는, 억지로 끼워 넣은 라벨은 가리키는 곳을 잃어 오히려 틀린 정보가 되기 때문이다.
 *
 * 순서는 우선순위가 정한다. **우선순위로는 선택 개수처럼 자주 바뀌는 값을 쓰지 말 것.**
 * 순서가 프레임마다 뒤집히면 라벨이 깜빡인다. 군집 크기처럼 가만히 있는 값을 쓴다.
 */

export type LabelBox = {
  readonly id: string
  /** 가리키는 점의 화면 좌표(px). */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 클수록 먼저 자리를 얻는다. */
  readonly priority: number
}

export type PlacedLabel = {
  readonly id: string
  /** 왼쪽 위 좌표(px). */
  readonly x: number
  readonly y: number
}

export type LabelLayoutOptions = {
  readonly width: number
  readonly height: number
  /** 라벨 사이 최소 여백. */
  readonly gap?: number
  /** 가리키는 점에서 띄우는 거리. */
  readonly offset?: number
}

type Rect = { x: number; y: number; width: number; height: number }

/**
 * 시도할 자리. 위를 가장 먼저 보는 것은 점을 가리지 않기 때문이다.
 *
 * 위아래옆 네 자리만 보면 군집이 몰린 가운데의 작은 라벨이 갈 곳을 잃는다. 대각선까지
 * 여덟 자리를 보면 겹치지 않고도 들어갈 자리가 남는다. 순서는 가까운 쪽부터다.
 */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
]

export function layoutLabels(
  labels: readonly LabelBox[],
  options: LabelLayoutOptions,
): readonly PlacedLabel[] {
  const gap = options.gap ?? 6
  const offset = options.offset ?? 14

  // 우선순위가 같으면 id로 갈라 순서를 고정한다. 프레임마다 결과가 달라지면 안 된다.
  const order = [...labels].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  const taken: Rect[] = []
  const placed: PlacedLabel[] = []

  for (const label of order) {
    for (const direction of DIRECTIONS) {
      const [dx, dy] = direction as readonly [number, number]
      const rect: Rect = {
        x: label.x - label.width / 2 + dx * (offset + label.width / 2),
        y: label.y - label.height / 2 + dy * (offset + label.height / 2),
        width: label.width,
        height: label.height,
      }
      if (!inside(rect, options.width, options.height)) continue
      if (taken.some((other) => overlaps(rect, other, gap))) continue

      taken.push(rect)
      placed.push({ id: label.id, x: rect.x, y: rect.y })
      break
    }
  }

  return placed
}

function inside(rect: Rect, width: number, height: number): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height
  )
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  )
}
