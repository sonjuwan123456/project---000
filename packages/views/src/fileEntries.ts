/**
 * 끌어다 놓은 것에서 파일을 훑어 온다 — 폴더를 받는 쪽의 브라우저 맞닿는 면.
 *
 * `dataTransfer.files`에는 폴더가 들어오지 않는다. 폴더를 놓으면 이름만 든 항목
 * 하나가 오고 내용은 비어 있다. 안을 보려면 `webkitGetAsEntry()`로 항목을 얻어
 * 직접 걸어 내려가야 한다. 이름에 webkit이 붙어 있지만 파이어폭스와 사파리도
 * 같은 이름으로 낸다.
 *
 * **`readEntries`는 한 번에 다 주지 않는다.** 폴더에 100개가 넘게 들어 있으면 앞
 * 100개만 주고, 빈 배열이 올 때까지 다시 불러야 나머지가 온다. 한 번만 부르고 마는
 * 것이 이 API의 대표적인 함정이고, 텍스처가 딱 100개에서 끊기는 모양으로 나타난다.
 */

/**
 * 한 번에 받을 파일 수의 상한. 묶음 쪽 상한(`MAX_BUNDLE_FILES`)과 같은 수다.
 * 여기서도 막는 까닭은, 묶음을 만들기 전에 이미 수만 번 걸어 내려간 뒤이기 때문이다.
 */
export const MAX_DROPPED_FILES = 2000

/** 브라우저가 주는 항목 중 우리가 쓰는 만큼만 적은 모양. */
export type DroppedEntry = {
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly name: string
  readonly fullPath?: string
  file?(onDone: (file: File) => void, onFail?: (error: unknown) => void): void
  createReader?(): {
    readEntries(onDone: (entries: DroppedEntry[]) => void, onFail?: (error: unknown) => void): void
  }
}

function fileOf(entry: DroppedEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof entry.file !== 'function') {
      resolve(null)
      return
    }
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    )
  })
}

/** 한 폴더의 항목을 끝까지 읽는다. 빈 배열이 올 때가 끝이다. */
async function childrenOf(entry: DroppedEntry): Promise<DroppedEntry[]> {
  if (typeof entry.createReader !== 'function') return []
  const reader = entry.createReader()
  const all: DroppedEntry[] = []

  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([]),
      )
    })
    if (batch.length === 0) return all
    all.push(...batch)
    // 상한을 넘겼으면 더 물어보지 않는다. 묶음 쪽에서도 자르지만 걷는 값이 아깝다.
    if (all.length >= MAX_DROPPED_FILES) return all.slice(0, MAX_DROPPED_FILES)
  }
}

/**
 * 항목 하나를 걸어 내려가며 `[상대 경로, 파일]`을 모은다.
 *
 * 깊이를 따로 막지 않는다. 파일 수 상한이 먼저 걸리고, 심어 놓은 링크로 도는 폴더는
 * 브라우저가 이 API로 내주지 않는다.
 */
async function walk(entry: DroppedEntry, prefix: string, out: [string, File][]): Promise<void> {
  if (out.length >= MAX_DROPPED_FILES) return
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`

  if (entry.isFile) {
    const file = await fileOf(entry)
    if (file !== null) out.push([path, file])
    return
  }
  if (!entry.isDirectory) return

  // 상한은 이 함수 첫 줄이 이미 본다. 여기서 또 보면 같은 말을 두 번 적는 것이다.
  for (const child of await childrenOf(entry)) await walk(child, path, out)
}

export type DroppedFiles = {
  /** 사람에게 보일 이름. 폴더 하나를 놓았으면 그 폴더 이름이다. */
  readonly label: string
  readonly entries: readonly (readonly [string, File])[]
  /** 폴더가 하나라도 섞여 있었는지. 묶음으로 열지 파일 하나로 열지를 가른다. */
  readonly hadDirectory: boolean
}

/**
 * 놓은 것에서 파일을 전부 꺼낸다. 폴더면 안까지 걸어 내려간다.
 *
 * 항목을 얻는 일은 **동기로** 먼저 해야 한다. `DataTransferItemList`는 이벤트
 * 처리가 끝나면 비워져서, `await` 한 번 뒤에 읽으면 빈 목록이 온다. 그래서 항목을
 * 먼저 전부 꺼내 놓고 그다음에 걷는다.
 */
export async function collectDropped(
  items: ArrayLike<{ webkitGetAsEntry?(): DroppedEntry | null }>,
): Promise<DroppedFiles | null> {
  const roots: DroppedEntry[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const entry = typeof item?.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry !== null && entry !== undefined) roots.push(entry)
  }
  if (roots.length === 0) return null

  const entries: [string, File][] = []
  let hadDirectory = false
  for (const root of roots) {
    if (root.isDirectory) hadDirectory = true
    await walk(root, '', entries)
  }
  if (entries.length === 0) return null

  const first = roots[0]
  const label = roots.length === 1 && first !== undefined ? first.name : `${entries.length}개 파일`
  return { label, entries, hadDirectory }
}

/**
 * 폴더 고르기 창이 돌려준 파일 목록을 묶음 재료로 바꾼다.
 *
 * `webkitdirectory` 입력은 `webkitRelativePath`에 `폴더/하위/파일` 꼴의 경로를
 * 담아 준다. 그것이 없으면 이름만 쓴다.
 */
export function entriesOfPicked(
  files: ArrayLike<File & { webkitRelativePath?: string }>,
): DroppedFiles | null {
  const entries: [string, File][] = []
  for (let index = 0; index < files.length && entries.length < MAX_DROPPED_FILES; index += 1) {
    const file = files[index]
    if (file === undefined) continue
    const path = file.webkitRelativePath
    entries.push([path !== undefined && path !== '' ? path : file.name, file])
  }
  if (entries.length === 0) return null

  const firstPath = entries[0]?.[0] ?? ''
  const slash = firstPath.indexOf('/')
  const label = slash === -1 ? `${entries.length}개 파일` : firstPath.slice(0, slash)
  return { label, entries, hadDirectory: slash !== -1 }
}
