import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FORMATS,
  PreferTextError,
  UnsupportedFileError,
  kindOfFile,
  readModelFile,
  readTextFile,
  startTableRead,
  supportedLabels,
  type Asset,
  type TableJob,
} from '@holo/data'

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
 */
export type FileDropZoneProps = {
  /** 다 읽으면 자산을 넘긴다. 무엇을 띄울지는 받는 쪽이 정한다. */
  onLoaded: (asset: Asset) => void
  /** 이미 불러온 파일이 있으면 화면을 덮지 않고 가장자리에만 붙는다. */
  compact?: boolean
}

/** 파일 고르기 창이 걸러 줄 확장자. 형식 표에서 만든다 — 손으로 적으면 반드시 어긋난다. */
const ACCEPT = FORMATS.filter((format) => format.planned === undefined)
  .flatMap((format) => format.extensions)
  .map((extension) => `.${extension}`)
  .join(',')

type Phase =
  { kind: 'idle' } | { kind: 'reading'; fileName: string } | { kind: 'error'; message: string }

export function FileDropZone({ onLoaded, compact = false }: FileDropZoneProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)

  /** 지금 읽고 있는 표 일감. 새 파일이 오거나 화면을 떠나면 멈춘다. */
  const reading = useRef<TableJob | null>(null)
  /** 표가 아닌 읽기까지 덮는 표. 워커가 없으므로 멈추는 대신 결과를 버린다. */
  const latest = useRef(0)
  useEffect(() => () => reading.current?.cancel(), [])

  const load = useCallback(
    async (file: File) => {
      reading.current?.cancel()
      latest.current += 1
      const ticket = latest.current
      setPhase({ kind: 'reading', fileName: file.name })

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
          const model = await readModelFile(file)
          asset = { kind: 'model', assetId: model.assetId, name: file.name, model }
        } else if (kind === 'text') {
          asset = await asTextAsset()
        } else {
          // 종류를 모르는 파일도 표 읽개로 보낸다. 거기서 까닭 있는 오류가 나온다.
          const job = startTableRead(file)
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

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const file = event.dataTransfer.files.item(0)
      // 여러 개를 놓아도 첫 파일만 연다. 파일 하나 = 자산 하나다(요구사항 2.4).
      if (file !== null) void load(file)
    },
    [load],
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
      if (file) void load(file)
      // 같은 파일을 다시 고를 수 있게 값을 비운다.
      event.target.value = ''
    },
    [load],
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
      {phase.kind === 'reading' ? (
        <p className="holo-drop-title">'{phase.fileName}' 읽는 중…</p>
      ) : (
        <>
          <p className="holo-drop-title">{compact ? '다른 파일 열기' : '파일을 끌어다 놓으세요'}</p>
          {compact ? null : <p className="holo-drop-caption">{supportedLabels().join(', ')}</p>}
          <button type="button" className="holo-chip" onClick={() => picker.current?.click()}>
            파일 고르기
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
