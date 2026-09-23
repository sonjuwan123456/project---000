import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FORMATS,
  PreferTextError,
  UnsupportedFileError,
  bundleOf,
  entriesOfZip,
  kindOfFile,
  looksLikeZip,
  pickPrimary,
  readModelFile,
  readTextFile,
  startTableRead,
  supportedLabels,
  type Asset,
  type BundleFile,
  type FileBundle,
  type LoadProgress,
  type TableJob,
} from '@holo/data'
import { ProgressBar } from './ProgressBar'
import { collectDropped, entriesOfPicked } from './fileEntries'

/**
 * 파일을 끌어다 놓는 자리 — 대표 사용 흐름의 1단계.
 *
 * 끌어다 놓기만 있으면 키보드로는 파일을 열 수 없다. 같은 일을 하는 버튼을 함께 둔다.
 *
 * `dragleave`는 자식 위를 지나갈 때도 올라온다. 들어온 횟수를 세지 않으면 테두리가
 * 끌고 있는 내내 깜빡인다.
 *
 * 표 읽기는 워커에서 돈다. 5만 행짜리 파일이면 본 스레드에서 수 초가 걸리고, 그동안
 * "읽는 중" 글자조차 그려지지 않아 앱이 죽은 것처럼 보인다. 3D 모델은 여기서 바로
 * 읽는다. 하는 일이 상자를 열어 JSON 한 덩어리를 보는 것뿐이라 화면이 굳지 않고,
 * 무거운 쪽(메시를 GPU로 올리는 일)은 어차피 주 스레드의 렌더러 몫이다.
 *
 * 폴더도 받는다. 갈라진 glTF는 `scene.gltf` 하나만으로는 그려지지 않고 옆에 있는
 * `scene.bin`과 텍스처가 함께 있어야 한다. 폴더가 들어오면 안을 훑어 묶음을 만들고,
 * 그중 무엇을 열지는 `pickPrimary`가 고른다. 나머지는 그 하나가 가리킬 때 쓰인다.
 */

export type FileDropZoneProps = {
  /** 다 읽으면 자산을 넘긴다. 무엇을 띄울지는 받는 쪽이 정한다. */
  onLoaded: (asset: Asset) => void
  /** 이미 불러온 파일이 있으면 화면을 덮지 않고 가장자리에만 붙는다. */
  compact?: boolean
}

/**
 * 파일 고르기 창이 걸러 줄 확장자. 형식 표에서 만든다 — 손으로 적으면 반드시 어긋난다.
 *
 * zip만 형식 표 밖에서 붙인다. 형식 표는 "열면 무엇이 되는 파일인가"를 적은 것이고,
 * zip은 그 자체로 무엇이 되지 않는다. 표에 넣으면 무엇을 열지 고르는 자리가 zip을
 * 자산으로 고르려 든다.
 */
const ACCEPT = [
  ...FORMATS.filter((format) => format.planned === undefined).flatMap((format) =>
    format.extensions.map((extension) => `.${extension}`),
  ),
  '.zip',
].join(',')

/**
 * 워커로 보낼 수 있는 모양으로 바꾼다.
 *
 * zip에서 꺼낸 항목은 닫힌 함수를 쥔 보통 객체다. 표 읽기는 그 파일을 `postMessage`로
 * 워커에 넘기는데, 함수는 복제되지 않아서 `DataCloneError`로 죽는다. **시험에서는
 * 워커를 쓰지 않으니 전부 통과하고, 브라우저에서만 죽는다.** 폴더에서 온 것은 이미
 * 진짜 File이라 그대로 지나간다.
 *
 * 여기서 바이트를 꺼내는 것은 미루기를 깨는 일이 아니다. 여는 파일은 하나뿐이고,
 * 읽개가 어차피 그 하나를 통째로 읽는다. 나머지 항목은 그대로 미뤄져 있다.
 */
async function asSendable(file: BundleFile): Promise<BundleFile> {
  if (file instanceof File) return file
  return new File([await file.arrayBuffer()], file.name, {
    lastModified: file.lastModified ?? 0,
  })
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string; progress: LoadProgress | null }
  | { kind: 'error'; message: string }

export function FileDropZone({ onLoaded, compact = false }: FileDropZoneProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const folderPicker = useRef<HTMLInputElement>(null)

  /*
   * `webkitdirectory`는 리액트가 아는 속성 표에 없다. 그래서 속성으로 직접 붙인다.
   * 이름에 webkit이 붙어 있지만 파이어폭스와 사파리도 같은 이름으로 받는다.
   */
  useEffect(() => {
    const node = folderPicker.current
    if (node === null) return
    node.setAttribute('webkitdirectory', '')
    node.setAttribute('directory', '')
  }, [])

  /** 지금 읽고 있는 표 일감. 새 파일이 오거나 화면을 떠나면 멈춘다. */
  const reading = useRef<TableJob | null>(null)
  /** 표가 아닌 읽기까지 덮는 표. 워커가 없으므로 멈추는 대신 결과를 버린다. */
  const latest = useRef(0)
  useEffect(() => () => reading.current?.cancel(), [])

  const load = useCallback(
    async (file: BundleFile, bundle?: FileBundle) => {
      reading.current?.cancel()
      latest.current += 1
      const ticket = latest.current
      setPhase({ kind: 'reading', fileName: file.name, progress: null })

      /*
       * 소식이 늦게 와서 다음 파일의 막대를 움직이는 일이 없어야 한다. 표를 갈아
       * 끼울 때 지난 워커가 아직 한두 번 더 알려 오기 때문이다.
       */
      const tell = (progress: LoadProgress) => {
        if (latest.current !== ticket) return
        setPhase((current) => (current.kind === 'reading' ? { ...current, progress } : current))
      }

      try {
        const kind = await kindOfFile(file)
        if (latest.current !== ticket) return

        const asTextAsset = async (reason?: string): Promise<Asset> => {
          const text = await readTextFile(file)
          return {
            kind: 'text',
            assetId: text.assetId,
            name: file.name,
            text:
              reason === undefined
                ? text
                : { ...text, notices: [{ level: 'warning', message: reason }, ...text.notices] },
          }
        }

        let asset: Asset
        if (kind === 'model') {
          const model = await readModelFile(file, bundle === undefined ? {} : { bundle })

          asset = { kind: 'model', assetId: model.assetId, name: file.name, model }
        } else if (kind === 'text') {
          asset = await asTextAsset()
        } else {
          // 종류를 모르는 파일도 표 읽개로 보낸다. 거기서 까닭 있는 오류가 나온다.
          const job = startTableRead(file, {}, tell)
          reading.current = job
          try {
            const table = await job.result
            asset = { kind: 'table', assetId: table.assetId, name: file.name, table }
          } catch (error) {
            // 표가 아니었을 뿐이면 실패로 두지 않고 글자로 연다(로그로 온 .txt 같은 것).
            if (!(error instanceof PreferTextError)) throw error
            asset = await asTextAsset(error.message)
          } finally {
            if (reading.current === job) reading.current = null
          }
        }

        // 그사이 다른 파일이 들어왔으면 이 결과는 버린다.
        if (latest.current !== ticket) return
        setPhase({ kind: 'idle' })
        onLoaded(asset)
      } catch (error) {
        if (latest.current !== ticket) return
        const message =
          error instanceof UnsupportedFileError
            ? error.message
            : `'${file.name}'을(를) 읽지 못했습니다. 파일이 온전한지 확인해 주세요.`
        setPhase({ kind: 'error', message })
      }
    },
    [onLoaded],
  )

  /**
   * 훑어 온 것을 묶음으로 만들어 그중 하나를 연다.
   *
   * 여는 것은 하나뿐이다. 자산 하나가 화면 하나라는 규칙(요구사항 2.4)은 폴더를
   * 받아도 그대로고, 나머지 파일은 그 하나가 가리킬 때 찾아 주는 재료로만 쓰인다.
   */
  const loadBundle = useCallback(
    async (label: string, entries: readonly (readonly [string, BundleFile])[]) => {
      const bundle = bundleOf(label, entries)
      const primary = pickPrimary(bundle)
      if (primary === null) {
        setPhase({
          kind: 'error',
          message: `'${label}'에서 열 수 있는 파일을 찾지 못했습니다. ${supportedLabels().join(', ')} 중 하나가 들어 있어야 합니다.`,
        })
        return
      }
      await load(await asSendable(primary.file), bundle)
    },
    [load],
  )

  /** 파일 하나를 연다. zip이면 풀어서 묶음으로 넘긴다. */
  const loadFile = useCallback(
    async (file: File) => {
      if (!looksLikeZip(file.name)) {
        await load(file)
        return
      }
      setPhase({ kind: 'reading', fileName: file.name, progress: null })
      try {
        await loadBundle(file.name, await entriesOfZip(file))
      } catch (error) {
        const message =
          error instanceof UnsupportedFileError
            ? error.message
            : `'${file.name}'을(를) 풀지 못했습니다. 압축 파일이 온전한지 확인해 주세요.`
        setPhase({ kind: 'error', message })
      }
    },
    [load, loadBundle],
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      depth.current = 0
      setDragging(false)

      /*
       * 놓인 것은 지금 이 자리에서 꺼내야 한다. 처리기가 끝나면 `items`가 비어서,
       * 기다린 뒤에 읽으면 빈 손이 온다. `collectDropped`가 앞머리를 동기로 처리하므로
       * 여기서 부르기만 하면 되고, 폴더가 아닐 때를 위한 파일도 미리 집어 둔다.
       */
      const fallback = event.dataTransfer.files.item(0)
      const walked = collectDropped(event.dataTransfer.items)

      void (async () => {
        const dropped = await walked
        // 폴더가 섞였거나 여럿을 놓았으면 묶음으로 본다. 하나만 놓았으면 예전 그대로다.
        if (dropped !== null && (dropped.hadDirectory || dropped.entries.length > 1)) {
          await loadBundle(dropped.label, dropped.entries)
          return
        }

        const file = dropped?.entries[0]?.[1] ?? fallback
        if (file !== null && file !== undefined) await loadFile(file)
      })()
    },
    [loadFile, loadBundle],
  )

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    depth.current += 1
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [])

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // 막지 않으면 브라우저가 파일을 새 탭으로 열어 버린다.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.item(0)
      if (file) void loadFile(file)
      // 같은 파일을 다시 고를 수 있게 값을 비운다.
      event.target.value = ''
    },
    [loadFile],
  )

  const onPickedFolder = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files === null ? null : entriesOfPicked(event.target.files)
      if (picked !== null) void loadBundle(picked.label, picked.entries)

      event.target.value = ''
    },
    [loadBundle],
  )

  const classes = ['holo-drop']
  if (compact) classes.push('is-compact')
  if (dragging) classes.push('is-dragging')
  if (phase.kind === 'reading') classes.push('is-reading')

  return (
    <div
      className={classes.join(' ')}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="holo-drop-input"
        onChange={onPicked}
      />
      <input ref={folderPicker} type="file" className="holo-drop-input" onChange={onPickedFolder} />

      {phase.kind === 'reading' ? (
        <ProgressBar progress={phase.progress} title={`'${phase.fileName}'`} />
      ) : (
        <>
          <p className="holo-drop-title">{compact ? '다른 파일 열기' : '파일을 끌어다 놓으세요'}</p>
          {compact ? null : <p className="holo-drop-caption">{supportedLabels().join(', ')}</p>}
          <button type="button" className="holo-chip" onClick={() => picker.current?.click()}>
            파일 고르기
          </button>
          {/* 갈라진 glTF는 폴더째 골라야 텍스처까지 따라온다. */}
          <button type="button" className="holo-chip" onClick={() => folderPicker.current?.click()}>
            폴더 고르기
          </button>
        </>
      )}
      {phase.kind === 'error' ? (
        <p className="holo-drop-error" role="alert">
          {phase.message}
        </p>
      ) : null}
    </div>
  )
}
