/**
 * 카메라 북마크 — 지금 보는 자리에 이름을 붙여 두고 나중에 그리로 날아간다.
 *
 * 설계 문서 5장이 작업 공간에 두기로 한 것 중 하나다. 발표할 때 "이 군집에서 저 군집으로"
 * 옮겨 다니는 것을 손으로 다시 돌려 맞추지 않게 한다.
 *
 * 북마크는 자산에 매인다. 카메라 좌표는 그 자산의 좌표계에서만 뜻이 있다. 점 구름을 보던
 * 자리를 3D 모델에 들이대면 엉뚱한 허공을 본다. 그래서 자산 id를 같이 적고, 화면은 지금
 * 무대에 오른 자산의 북마크만 보여 준다. 다른 자산의 북마크는 지우지 않고 남겨 둔다 —
 * 그 파일을 다시 열면 돌아온다.
 */
import type { StoredCamera } from './workspaceFile'

export type CameraBookmark = {
  /** 작업 공간 안에서 겹치지 않는 값. 이름은 겹칠 수 있다. */
  readonly id: string
  readonly name: string
  /** 이 카메라가 뜻을 가지는 자산. */
  readonly assetId: string
  readonly camera: StoredCamera
}

/** 자산 하나에 둘 수 있는 북마크 수. 단축키 1~9에 하나씩 대응한다. */
export const BOOKMARKS_PER_ASSET = 9

/** 그 자산의 북마크만, 만든 순서대로. */
export function bookmarksOf(
  bookmarks: readonly CameraBookmark[],
  assetId: string,
): readonly CameraBookmark[] {
  return bookmarks.filter((one) => one.assetId === assetId)
}

/**
 * 북마크를 하나 더한다. 그 자산에 이미 가득 찼으면 null.
 *
 * 이름은 "북마크 N"으로 붙인다. 새 북마크는 목록 끝에 붙어 단축키가 (개수+1)번이 되므로
 * N도 거기서 시작한다. 그래야 흔한 경우에 이름의 번호와 단축키 번호가 같다. 그 이름이 이미
 * 있으면(지우고 다시 만든 경우) 다음 번호로 넘어간다. 앞에서부터 빈 번호를 채우면 이름을
 * 하나 바꾼 뒤 새로 만든 것이 2번 자리에 "북마크 1"로 붙는다 — 브라우저로 보고 고쳤다.
 */
export function addBookmark(
  bookmarks: readonly CameraBookmark[],
  assetId: string,
  camera: StoredCamera,
): readonly CameraBookmark[] | null {
  const mine = bookmarksOf(bookmarks, assetId)
  if (mine.length >= BOOKMARKS_PER_ASSET) return null
  const taken = new Set(mine.map((one) => one.name))
  let number = mine.length + 1
  while (taken.has(`북마크 ${number}`)) number += 1
  const ids = new Set(bookmarks.map((one) => one.id))
  let serial = bookmarks.length + 1
  while (ids.has(`b${serial}`)) serial += 1
  return [...bookmarks, { id: `b${serial}`, name: `북마크 ${number}`, assetId, camera }]
}

export function removeBookmark(
  bookmarks: readonly CameraBookmark[],
  id: string,
): readonly CameraBookmark[] {
  return bookmarks.filter((one) => one.id !== id)
}

/** 이름을 바꾼다. 빈 이름은 받지 않고 그대로 둔다. */
export function renameBookmark(
  bookmarks: readonly CameraBookmark[],
  id: string,
  name: string,
): readonly CameraBookmark[] {
  const trimmed = name.trim()
  if (trimmed === '') return bookmarks
  return bookmarks.map((one) => (one.id === id ? { ...one, name: trimmed } : one))
}
