import { useState } from 'react'
import type { CameraBookmark } from '@holo/core'

/**
 * 카메라 북마크 목록 — 지금 보는 자리를 남기고, 누르면 그리로 날아간다.
 *
 * 목록은 지금 무대에 오른 자산의 것만 받는다. 번호 단추가 곧 단축키다(1~9). 이름을 두 번
 * 누르면 고칠 수 있다. "북마크 3"보다 "환불 군집"이 발표할 때 훨씬 잘 읽힌다.
 */
export type BookmarkListProps = {
  bookmarks: readonly CameraBookmark[]
  /** 지금 자리를 더할 수 있는지. 카메라를 아직 한 번도 안 움직였거나 가득 찼으면 false. */
  canAdd: boolean
  /** 왜 더할 수 없는지. `canAdd`가 false일 때 단추의 풀이로 쓴다. */
  addHint: string | null
  onAdd: () => void
  onFly: (bookmark: CameraBookmark) => void
  onRemove: (bookmark: CameraBookmark) => void
  onRename: (bookmark: CameraBookmark, name: string) => void
}

export function BookmarkList(props: BookmarkListProps) {
  const { bookmarks, canAdd, addHint, onAdd, onFly, onRemove, onRename } = props
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <section className="holo-chart holo-bookmarks">
      <h3>
        카메라 북마크
        <button
          type="button"
          className="holo-chip"
          onClick={onAdd}
          disabled={!canAdd}
          title={canAdd ? '지금 보는 자리를 북마크로 남긴다 (B)' : (addHint ?? undefined)}
        >
          지금 자리 남기기
        </button>
      </h3>
      {bookmarks.length === 0 ? (
        <p className="holo-caption">
          {addHint ?? '보기 좋은 자리를 남겨 두면 누를 때마다 그리로 날아간다.'}
        </p>
      ) : (
        <ol className="holo-bookmark-list">
          {bookmarks.map((bookmark, index) => (
            <li key={bookmark.id}>
              <kbd>{index + 1}</kbd>
              {editing === bookmark.id ? (
                <input
                  className="holo-bookmark-name"
                  aria-label="북마크 이름"
                  defaultValue={bookmark.name}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    // 이름 칸에 친 글자가 단축키(1~9, B)로 새지 않게 한다.
                    event.stopPropagation()
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.currentTarget.value = bookmark.name
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={(event) => {
                    setEditing(null)
                    const name = event.currentTarget.value.trim()
                    if (name !== '' && name !== bookmark.name) onRename(bookmark, name)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="holo-bookmark-go"
                  // 두 번 누르기(이름 고치기)의 첫 번째 누름에만 날아간다. 두 번째까지 날면
                  // 활동 기록에 같은 비행이 두 줄 남는다. 키보드로 누르면 detail이 0이다.
                  onClick={(event) => {
                    if (event.detail <= 1) onFly(bookmark)
                  }}
                  onDoubleClick={() => setEditing(bookmark.id)}
                  title="누르면 날아가고, 두 번 누르면 이름을 고친다"
                >
                  {bookmark.name}
                </button>
              )}
              <button
                type="button"
                className="holo-bookmark-remove"
                onClick={() => onRemove(bookmark)}
                aria-label={`${bookmark.name} 지우기`}
                title="지우기"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
