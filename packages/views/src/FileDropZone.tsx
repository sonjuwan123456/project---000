import { useCallback, useRef, useState } from 'react'
import { UnsupportedFileError, readTableFile, type LoadedTable } from '@holo/data'

/**
 * 파일을 끌어다 놓는 자리 — 대표 사용 흐름의 1단계.
 *
 * 끌어다 놓기만 있으면 키보드로는 파일을 열 수 없다. 같은 일을 하는 버튼을 함께 둔다.
 *
 * `dragleave`는 자식 위를 지나갈 때도 올라온다. 들어온 횟수를 세지 않으면 테두리가
 * 끌고 있는 내내 깜빡인다.
 */
export type FileDropZoneProps = {
  /** 다 읽으면 표와 파일 이름을 넘긴다. 무엇을 띄울지는 받는 쪽이 정한다. */
  onLoaded: (table: LoadedTable, fileName: string) => void
  /** 이미 불러온 파일이 있으면 화면을 덮지 않고 가장자리에만 붙는다. */
  compact?: boolean
}

const ACCEPT = '.csv,.tsv,.txt,.json,.jsonl,.ndjson'

type Phase =
  { kind: 'idle' } | { kind: 'reading'; fileName: string } | { kind: 'error'; message: string }

export function FileDropZone({ onLoaded, compact = false }: FileDropZoneProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (file: File) => {
      setPhase({ kind: 'reading', fileName: file.name })
      try {
        const table = await readTableFile(file)
        setPhase({ kind: 'idle' })
        onLoaded(table, file.name)
      } catch (error) {
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
          {compact ? null : <p className="holo-drop-caption">CSV, TSV, JSON, JSON Lines</p>}
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
