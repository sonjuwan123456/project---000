import { describe, expect, it } from 'vitest'
import {
  BOOKMARKS_PER_ASSET,
  addBookmark,
  bookmarksOf,
  removeBookmark,
  renameBookmark,
  type CameraBookmark,
} from './bookmarks'

const at = (x: number) => ({ position: [x, 0, 10] as const, target: [0, 0, 0] as const })

function addMany(start: readonly CameraBookmark[], assetId: string, times: number) {
  let list = start
  for (let turn = 0; turn < times; turn += 1) {
    const next = addBookmark(list, assetId, at(turn))
    if (next === null) throw new Error('가득 찼다')
    list = next
  }
  return list
}

describe('addBookmark', () => {
  it('자산마다 번호를 따로 붙인다', () => {
    const list = addMany(addMany([], 'a', 2), 'b', 1)
    expect(bookmarksOf(list, 'a').map((one) => one.name)).toEqual(['북마크 1', '북마크 2'])
    expect(bookmarksOf(list, 'b').map((one) => one.name)).toEqual(['북마크 1'])
    // id는 자산을 넘어 겹치지 않아야 지울 때 남의 것을 지우지 않는다.
    expect(new Set(list.map((one) => one.id)).size).toBe(3)
  })

  it('이름의 번호는 새 북마크가 앉는 자리(단축키) 번호를 따른다', () => {
    const one = addMany([], 'a', 1)
    const first = one[0]
    if (first === undefined) throw new Error('없다')
    // 첫 것의 이름을 바꾼 뒤 새로 만들면 2번 자리다. "북마크 1"이 붙으면 단축키와 어긋난다.
    const renamed = renameBookmark(one, first.id, '환불 군집')
    expect(addBookmark(renamed, 'a', at(1))?.map((b) => b.name)).toEqual(['환불 군집', '북마크 2'])
  })

  it('그 이름이 이미 있으면 다음 번호로 넘어간다', () => {
    const list = addMany([], 'a', 3)
    const second = list[1]
    if (second === undefined) throw new Error('없다')
    const again = addBookmark(removeBookmark(list, second.id), 'a', at(9))
    expect(again?.map((one) => one.name)).toEqual(['북마크 1', '북마크 3', '북마크 4'])
    expect(new Set(again?.map((one) => one.id)).size).toBe(3)
  })

  it('가득 차면 null을 돌려준다. 다른 자산은 막지 않는다', () => {
    const full = addMany([], 'a', BOOKMARKS_PER_ASSET)
    expect(addBookmark(full, 'a', at(0))).toBeNull()
    expect(addBookmark(full, 'b', at(0))).not.toBeNull()
  })
})

describe('renameBookmark', () => {
  it('앞뒤 빈칸을 떼고, 빈 이름은 받지 않는다', () => {
    const list = addMany([], 'a', 1)
    const id = list[0]?.id ?? ''
    expect(renameBookmark(list, id, '  환불 군집 ')[0]?.name).toBe('환불 군집')
    expect(renameBookmark(list, id, '   ')).toBe(list)
  })
})
