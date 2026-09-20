import { describe, expect, it } from 'vitest'
import { layoutLabels, type LabelBox } from './labelLayout'

const box = (id: string, x: number, y: number, priority = 1): LabelBox => ({
  id,
  x,
  y,
  width: 60,
  height: 20,
  priority,
})

const view = { width: 400, height: 300 }

describe('layoutLabels', () => {
  it('겹치지 않으면 가리키는 점 위에 놓는다', () => {
    const placed = layoutLabels([box('a', 200, 150)], view)

    expect(placed).toHaveLength(1)
    // 가로는 가운데, 세로는 점보다 위.
    expect(placed[0]?.x).toBe(200 - 30)
    expect(placed[0]?.y).toBeLessThan(150)
  })

  it('겹치면 다른 자리로 밀어낸다', () => {
    const placed = layoutLabels([box('a', 200, 150, 2), box('b', 200, 150, 1)], view)

    expect(placed).toHaveLength(2)
    expect(placed[0]?.y).not.toBe(placed[1]?.y)
  })

  it('밀어서도 안 되면 버린다', () => {
    // 네 방향이 모두 막히도록 같은 자리에 다섯 개를 몰아넣는다.
    const crowd = [1, 2, 3, 4, 5].map((n) => box(`l${n}`, 200, 150, 10 - n))
    const placed = layoutLabels(crowd, view)

    expect(placed.length).toBeLessThan(crowd.length)
    // 우선순위가 높은 것이 먼저 자리를 얻는다.
    expect(placed[0]?.id).toBe('l1')
  })

  it('화면 밖으로 나가는 자리는 쓰지 않는다', () => {
    const placed = layoutLabels([box('a', 5, 5)], view)

    for (const label of placed) {
      expect(label.x).toBeGreaterThanOrEqual(0)
      expect(label.y).toBeGreaterThanOrEqual(0)
      expect(label.x + 60).toBeLessThanOrEqual(view.width)
      expect(label.y + 20).toBeLessThanOrEqual(view.height)
    }
  })

  it('우선순위가 같으면 순서가 프레임마다 흔들리지 않는다', () => {
    const labels = [box('b', 200, 150), box('a', 200, 150), box('c', 200, 150)]
    const once = layoutLabels(labels, view)
    const again = layoutLabels([...labels].reverse(), view)

    expect(once).toEqual(again)
  })

  it('군집이 몰려 있어도 대각선 자리까지 써서 다 놓는다', () => {
    // 실제 3D 화면에서 나온 모양: 작은 라벨 여섯 개가 200px 안에 몰려 있다.
    // 위아래옆 네 자리만 보면 가운데 것이 갈 곳을 잃는다.
    const cluster: LabelBox[] = [
      { id: 'a', x: 300, y: 260, width: 54, height: 17, priority: 3120 },
      { id: 'b', x: 340, y: 210, width: 54, height: 17, priority: 2640 },
      { id: 'c', x: 430, y: 220, width: 54, height: 17, priority: 2160 },
      { id: 'd', x: 320, y: 160, width: 54, height: 17, priority: 2040 },
      { id: 'e', x: 350, y: 235, width: 54, height: 17, priority: 1680 },
      { id: 'f', x: 395, y: 195, width: 54, height: 17, priority: 360 },
    ]
    const placed = layoutLabels(cluster, { width: 700, height: 460 })

    expect(placed.map((label) => label.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    for (const [i, one] of placed.entries()) {
      for (const other of placed.slice(i + 1)) {
        const apart =
          one.x + 54 <= other.x ||
          other.x + 54 <= one.x ||
          one.y + 17 <= other.y ||
          other.y + 17 <= one.y
        expect(apart, `${one.id} ${other.id}`).toBe(true)
      }
    }
  })

  it('라벨이 없으면 빈 배열', () => {
    expect(layoutLabels([], view)).toEqual([])
  })
})
