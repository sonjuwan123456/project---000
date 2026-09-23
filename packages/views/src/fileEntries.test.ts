import { describe, expect, it } from 'vitest'
import {
  MAX_DROPPED_FILES,
  collectDropped,
  entriesOfPicked,
  type DroppedEntry,
} from './fileEntries'

function fileEntry(name: string, body = 'x'): DroppedEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file(onDone) {
      onDone(new File([body], name))
    },
  }
}

function brokenFile(name: string): DroppedEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file(_onDone, onFail) {
      onFail?.(new Error('읽을 수 없음'))
    },
  }
}

type ReadLog = { calls: number }

/**
 * 폴더 흉내. 실제 `readEntries`처럼 한 번에 `batch`개까지만 주고, 답은 비동기로 준다.
 * 리더마다 자기 자리를 쥐는 것도 실제와 같다.
 */
function dirEntry(
  name: string,
  children: readonly DroppedEntry[],
  options: { batch?: number; log?: ReadLog } = {},
): DroppedEntry {
  const batch = options.batch ?? 100
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let cursor = 0
      return {
        readEntries(onDone) {
          if (options.log !== undefined) options.log.calls += 1
          const slice = children.slice(cursor, cursor + batch)
          cursor += slice.length
          queueMicrotask(() => onDone([...slice]))
        },
      }
    },
  }
}

function itemsOf(...entries: readonly DroppedEntry[]) {
  return entries.map((entry) => ({ webkitGetAsEntry: () => entry }))
}

function pathsOf(found: { entries: readonly (readonly [string, File])[] } | null) {
  return (found?.entries ?? []).map(([path]) => path)
}

describe('collectDropped', () => {
  it('파일 하나를 놓으면 이름 그대로 나온다 — 앞에 슬래시가 붙으면 안 된다', async () => {
    const found = await collectDropped(itemsOf(fileEntry('scene.glb')))
    expect(pathsOf(found)).toEqual(['scene.glb'])
    expect(found?.hadDirectory).toBe(false)
    expect(found?.label).toBe('scene.glb')
  })

  it('폴더 안까지 걸어 내려가 상대 경로를 붙인다', async () => {
    const tree = dirEntry('모형', [
      fileEntry('scene.gltf'),
      dirEntry('textures', [fileEntry('wood.png')]),
    ])
    const found = await collectDropped(itemsOf(tree))
    expect(pathsOf(found).sort()).toEqual(['모형/scene.gltf', '모형/textures/wood.png'])
    expect(found?.hadDirectory).toBe(true)
    expect(found?.label).toBe('모형')
  })

  /*
   * 이 API의 대표적인 함정. 한 번만 부르면 앞 100개만 받고 끝나서, 텍스처가 딱
   * 100개에서 끊긴 모형이 뜬다. 150개를 100개씩 주게 해 두면 한 번만 부르는 구현은
   * 100개만 들고 나와 여기서 죽는다. 빈 배열을 받고서야 끝이므로 부름은 세 번이다.
   */
  it('readEntries를 빈 배열이 올 때까지 다시 부른다', async () => {
    const log: ReadLog = { calls: 0 }
    const many = Array.from({ length: 150 }, (_, index) => fileEntry(`t${index}.png`))
    const found = await collectDropped(itemsOf(dirEntry('textures', many, { batch: 100, log })))
    expect(found?.entries).toHaveLength(150)
    expect(log.calls).toBe(3)
  })

  /*
   * `DataTransferItemList`는 이벤트 처리가 끝나면 비워진다. 그래서 항목 꺼내기는
   * 첫 `await` 앞에서 동기로 끝나 있어야 한다. 여기서는 부른 직후 — 곧 첫 await에
   * 걸린 그 자리에서 — 목록을 비워 그 순서를 못박는다.
   */
  it('항목을 첫 기다림 앞에서 동기로 꺼내 둔다', async () => {
    let alive = true
    const entry = fileEntry('scene.glb')
    const items = [{ webkitGetAsEntry: () => (alive ? entry : null) }]

    const pending = collectDropped(items)
    alive = false

    expect(pathsOf(await pending)).toEqual(['scene.glb'])
  })

  it('여러 개를 놓으면 이름 대신 개수를 붙인다', async () => {
    const found = await collectDropped(itemsOf(fileEntry('a.glb'), fileEntry('b.csv')))
    expect(found?.label).toBe('2개 파일')
    expect(found?.hadDirectory).toBe(false)
  })

  it('폴더가 하나라도 섞이면 묶음으로 본다', async () => {
    const found = await collectDropped(
      itemsOf(fileEntry('읽어보기.md'), dirEntry('textures', [fileEntry('wood.png')])),
    )
    expect(found?.hadDirectory).toBe(true)
  })

  it('읽지 못한 파일은 건너뛴다 — 나머지까지 잃을 일은 아니다', async () => {
    const found = await collectDropped(itemsOf(brokenFile('잠긴.bin'), fileEntry('scene.glb')))
    expect(pathsOf(found)).toEqual(['scene.glb'])
  })

  it('항목이 없거나 건질 파일이 없으면 null', async () => {
    expect(await collectDropped([])).toBeNull()
    expect(await collectDropped([{ webkitGetAsEntry: () => null }])).toBeNull()
    expect(await collectDropped(itemsOf(brokenFile('잠긴.bin')))).toBeNull()
    expect(await collectDropped(itemsOf(dirEntry('빈폴더', [])))).toBeNull()
  })

  /*
   * 홈 폴더를 놓는 실수가 흔하다. 끊는 것만으로는 모자라고 **더 묻지 않아야** 한다 —
   * 수만 개를 끝까지 훑는 동안 놓은 사람은 굳은 화면만 본다. 300개씩 주면 일곱 번에
   * 2100개가 되어 상한을 넘으니, 성한 구현은 거기서 멈춘다.
   */
  it('상한을 넘기면 더 묻지 않고 끊는다', async () => {
    const log: ReadLog = { calls: 0 }
    const many = Array.from({ length: MAX_DROPPED_FILES + 120 }, (_, index) =>
      fileEntry(`f${index}.png`),
    )
    const found = await collectDropped(itemsOf(dirEntry('전부', many, { batch: 300, log })))
    expect(found?.entries).toHaveLength(MAX_DROPPED_FILES)
    expect(log.calls).toBe(7)
  })
})

describe('entriesOfPicked', () => {
  function picked(path: string): File & { webkitRelativePath?: string } {
    const file = new File(['x'], path.slice(path.lastIndexOf('/') + 1))
    return Object.assign(file, { webkitRelativePath: path })
  }

  it('webkitRelativePath를 경로로 쓰고 맨 앞 칸을 이름으로 삼는다', () => {
    const found = entriesOfPicked([picked('모형/scene.gltf'), picked('모형/textures/wood.png')])
    expect(pathsOf(found)).toEqual(['모형/scene.gltf', '모형/textures/wood.png'])
    expect(found?.label).toBe('모형')
    expect(found?.hadDirectory).toBe(true)
  })

  it('경로가 없으면 이름만 쓰고 묶음으로 보지 않는다', () => {
    const found = entriesOfPicked([new File(['x'], 'scene.glb')])
    expect(pathsOf(found)).toEqual(['scene.glb'])
    expect(found?.hadDirectory).toBe(false)
    expect(found?.label).toBe('1개 파일')
  })

  it('고른 것이 없으면 null', () => {
    expect(entriesOfPicked([])).toBeNull()
  })

  it('상한을 넘으면 거기서 끊는다', () => {
    const many = Array.from({ length: MAX_DROPPED_FILES + 30 }, (_, index) =>
      picked(`전부/f${index}.png`),
    )
    expect(entriesOfPicked(many)?.entries).toHaveLength(MAX_DROPPED_FILES)
  })
})
