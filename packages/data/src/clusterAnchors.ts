/**
 * 군집 앵커 — 3D 화면에 범주 이름을 얹을 자리.
 *
 * 점만 보면 색이 무슨 범주인지 옆 그래프와 눈으로 맞춰야 한다. 범주마다 점들의 무게중심을
 * 구해 그 위에 이름을 얹으면 그 왕복이 사라진다. 여기서는 자리만 구하고, 겹칠 때 누가
 * 비켜설지는 화면 좌표로 바뀐 뒤에 정한다(`@holo/core`의 `layoutLabels`).
 *
 * 뷰 모델의 범주 역할과 좌표를 엮는 일이라 데이터층에 둔다. 뷰 쪽은 앵커 배열만 받는다.
 */
import type { CategoryRole, Positions } from './viewModel'

export type ClusterAnchor = {
  /** 범주 이름 자리. `CategoryRole.names`의 번호와 같다. */
  readonly slot: number
  readonly name: string
  /** 팔레트 자리. 라벨을 점과 막대와 같은 색으로 묶는 데 쓴다. */
  readonly color: number
  readonly position: readonly [number, number, number]
  /**
   * 무게중심에 들어간 행 수.
   *
   * 라벨이 서로 밀어낼 때의 우선순위로 쓰라고 함께 돌려준다. 고른 개수처럼 자주 바뀌는
   * 값을 우선순위로 쓰면 선택할 때마다 순서가 뒤집혀 라벨이 깜빡인다.
   */
  readonly size: number
}

type Sum = { x: number; y: number; z: number; n: number }

/**
 * 범주마다 점들의 무게중심을 구한다.
 *
 * 세 가지는 빼고 센다.
 *
 * - 좌표가 없는 행(`missing`). 0,0,0으로 세면 무게중심이 원점으로 끌려간다.
 *   3D 점 뷰가 이 행들을 아예 그리지 않는 것과 같은 이유다.
 * - 범주 값이 없는 행(`slotOf`가 -1). 셀 범주가 없다.
 * - "기타" 자리(`overflowSlot`). 색이 모자라 여러 범주를 모아 둔 자리라 무게중심이
 *   가리키는 덩어리가 없다. 억지로 이름을 달면 엉뚱한 곳을 가리킨다.
 *
 * 남은 점이 하나도 없는 자리는 결과에서 빠진다.
 */
export function anchorsOf(positions: Positions, category: CategoryRole): readonly ClusterAnchor[] {
  const rowCount = positions.missing.length
  const sums: Sum[] = category.names.map(() => ({ x: 0, y: 0, z: 0, n: 0 }))

  for (let row = 0; row < rowCount; row += 1) {
    if (positions.missing[row] === 1) continue
    const slot = category.slotOf(row)
    if (slot < 0 || slot === category.overflowSlot) continue
    const sum = sums[slot]
    if (!sum) continue
    const x = positions.x[row]
    const y = positions.y[row]
    const z = positions.z[row]
    if (x === undefined || y === undefined || z === undefined) continue
    sum.x += x
    sum.y += y
    sum.z += z
    sum.n += 1
  }

  const anchors: ClusterAnchor[] = []
  sums.forEach((sum, slot) => {
    if (sum.n === 0) return
    const name = category.names[slot]
    if (name === undefined) return
    anchors.push({
      slot,
      name,
      color: category.colorOfSlot(slot),
      position: [sum.x / sum.n, sum.y / sum.n, sum.z / sum.n],
      size: sum.n,
    })
  })
  return anchors
}
