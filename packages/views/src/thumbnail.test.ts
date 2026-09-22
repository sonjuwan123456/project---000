import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { THUMBNAIL_CAMERA, frameBox, hasThumbnail, thumbnailOf } from './thumbnail'
import type { Asset, LoadedTable, LoadedText } from '@holo/data'

/**
 * 상자의 여덟 꼭짓점을 카메라로 쏘아 화면 좌표를 본다.
 *
 * 그린 그림을 견주는 것이 아니라 여기서 재는 까닭은, 썸네일이 잘리거나 점만 하게
 * 나오는 일이 전부 **이 계산**에서 나기 때문이다. 화면 좌표가 -1과 1 사이에 들면
 * 잘리지 않은 것이고, 그 폭이 충분히 크면 점만 하지 않은 것이다.
 */
function shotOf(box: Box3) {
  const camera = new PerspectiveCamera(THUMBNAIL_CAMERA.fieldOfView, 1, 0.1, 1000)
  frameBox(camera, box)
  camera.updateMatrixWorld(true)

  const corners: Vector3[] = []
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corners.push(new Vector3(x, y, z).project(camera))
      }
    }
  }
  const xs = corners.map((one) => one.x)
  const ys = corners.map((one) => one.y)
  const zs = corners.map((one) => one.z)
  return {
    camera,
    outside: Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    depth: { near: Math.min(...zs), far: Math.max(...zs) },
  }
}

const boxOf = (size: number, at = new Vector3()) =>
  new Box3().setFromCenterAndSize(at, new Vector3(size, size, size))

describe('frameBox', () => {
  /*
   * 가장자리에 닿지도 않아야 한다. 딱 맞게 담으면 모서리가 화면 테두리에 붙어서
   * 잘린 것처럼 보이고, 목록에서 썸네일마다 테두리를 물고 있게 된다. 여유를 뺀
   * 계산은 0.9쯤까지 차오르므로 0.85가 둘을 가른다.
   */
  it('상자가 가장자리에 닿지 않는다', () => {
    expect(shotOf(boxOf(10)).outside).toBeLessThan(0.85)
  })

  /*
   * 잘리지 않는 것만으로는 모자라다. 카메라를 한참 뒤로 빼도 안 잘리지만 그러면
   * 96픽셀 안에서 점 하나가 된다. 화면의 절반은 채워야 무엇인지 알아본다.
   */
  it('화면을 비워 두지 않는다', () => {
    const shot = shotOf(boxOf(10))
    expect(Math.max(shot.width, shot.height)).toBeGreaterThan(1)
  })

  /*
   * 블렌더 기본 큐브는 2미터고 스캔한 건물은 수백 미터다. 화면에서는 같은 크기로
   * 보여야 하고, 잘라 내는 면도 같이 따라와야 한다 — 면을 붙박이로 두면 큰 것이
   * 통째로 면 너머로 밀려나 빈 그림이 된다.
   */
  it('물건이 작든 크든 화면에서는 같은 크기로 보인다', () => {
    const small = shotOf(boxOf(0.002))
    const huge = shotOf(boxOf(4000))
    expect(small.width).toBeCloseTo(huge.width, 3)
    for (const shot of [small, huge]) {
      expect(shot.outside).toBeLessThan(0.85)
      expect(shot.depth.near).toBeGreaterThan(-1)
      expect(shot.depth.far).toBeLessThan(1)
    }
  })

  it('원점에서 멀리 떨어진 물건도 담는다 — 원점에 있으리라 믿지 않는다', () => {
    const shot = shotOf(boxOf(10, new Vector3(500, -300, 120)))
    expect(shot.outside).toBeLessThanOrEqual(1)
    expect(Math.max(shot.width, shot.height)).toBeGreaterThan(1)
  })

  /*
   * 잘라 내는 면 사이에 있어야 그려진다. 가까운 면이 물건을 파고들면 앞쪽이 뚫린
   * 채로 나오고, 먼 면이 모자라면 뒤쪽이 사라진다. 둘 다 오류 없이 이상한 그림이 된다.
   */
  it('물건이 잘라 내는 두 면 사이에 온전히 든다', () => {
    const shot = shotOf(boxOf(10))
    expect(shot.depth.near).toBeGreaterThan(-1)
    expect(shot.depth.far).toBeLessThan(1)
  })

  it('납작한 물건도 담는다 — 두께가 0이어도 계산이 무너지지 않는다', () => {
    const flat = new Box3(new Vector3(-5, -5, 0), new Vector3(5, 5, 0))
    const shot = shotOf(flat)
    expect(Number.isFinite(shot.camera.position.length())).toBe(true)
    expect(shot.outside).toBeLessThanOrEqual(1)
  })

  it('점 하나짜리 상자에도 숫자를 낸다', () => {
    const dot = new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1))
    const camera = new PerspectiveCamera(THUMBNAIL_CAMERA.fieldOfView, 1, 0.1, 1000)
    frameBox(camera, dot)
    expect(Number.isFinite(camera.position.length())).toBe(true)
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.far).toBeGreaterThan(camera.near)
  })
})

describe('thumbnailOf', () => {
  const table = { assetId: 'a', notices: [] } as unknown as LoadedTable
  const text = { assetId: 'b', notices: [] } as unknown as LoadedText

  it('미리보기가 있는 종류만 만든다', () => {
    expect(hasThumbnail('model')).toBe(true)
    expect(hasThumbnail('table')).toBe(false)
    expect(hasThumbnail('text')).toBe(false)
  })

  /*
   * 표와 글자는 문서가 적은 셋에 들지 않는다. 억지로 그리면 목록에 회색 얼룩만
   * 늘어서 무엇이 무엇인지 더 알기 어려워진다.
   */
  it('표와 글자는 null이다', async () => {
    const asTable: Asset = { kind: 'table', assetId: 'a', name: '표.csv', table }
    const asText: Asset = { kind: 'text', assetId: 'b', name: '글.md', text }
    expect(await thumbnailOf(asTable)).toBeNull()
    expect(await thumbnailOf(asText)).toBeNull()
  })
})
