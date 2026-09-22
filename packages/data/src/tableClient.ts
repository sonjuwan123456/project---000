/**
 * 파일 읽기를 워커에 맡기는 쪽.
 *
 * 워커를 쓸 수 없는 곳(시험, 서버)에서는 그 자리에서 읽는다. 부르는 쪽은 어느 쪽이
 * 돌았는지 몰라도 되게 언제나 같은 `LoadedTable`을 받는다.
 *
 * 워커는 파일 하나에 하나씩 만들고 끝나면 닫는다. 파일을 여는 동안 한 번 도는 일이라
 * 살려 둘 이유가 없고, 표를 갈아 끼울 때 지난 읽기를 멈추려면 닫는 쪽이 확실하다.
 */

import { attachLookup, type BuildOptions, type LoadedTable } from './loadTable'
import {
  PreferTextError,
  UnsupportedFileError,
  readTableFile,
  type ReadableFile,
} from './readTableFile'
import type { TableRequest, TableResponse } from './tableWorker'
import { canUseWorker } from './workerSupport'

export type TableJob = {
  /** 읽은 표. cancel()을 부른 뒤에는 끝나지 않는다. */
  readonly result: Promise<LoadedTable>
  /** 읽기를 멈추고 워커를 닫는다. 이미 끝났으면 아무 일도 없다. */
  cancel(): void
}

let nextId = 1

function inThisThread(file: ReadableFile, options: BuildOptions): TableJob {
  let cancelled = false
  return {
    result: readTableFile(file, options).then((table) => {
      // 멈춘 뒤에는 결과를 흘리지 않는다. 끝나지 않는 약속이 된다.
      if (cancelled) return new Promise<LoadedTable>(() => {})
      return table
    }),
    cancel() {
      cancelled = true
    },
  }
}

/** 파일 하나를 표로 읽는다. 읽기·파싱·종류 판별이 전부 워커에서 돈다. */
export function startTableRead(file: ReadableFile, options: BuildOptions = {}): TableJob {
  if (!canUseWorker()) return inThisThread(file, options)

  let worker: Worker
  try {
    worker = new Worker(new URL('./tableWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return inThisThread(file, options)
  }

  const id = nextId
  nextId += 1
  let done = false

  const result = new Promise<LoadedTable>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<TableResponse>) => {
      const message = event.data
      if (message.id !== id) return
      done = true
      worker.terminate()
      if (message.ok) {
        resolve(attachLookup(message.table))
        return
      }
      // 읽을 수 없는 형식은 부르는 쪽이 사용자에게 그대로 보여 준다. 종류를 살려 보낸다.
      reject(
        message.preferText
          ? new PreferTextError(message.fileName, message.message)
          : message.unsupported
            ? new UnsupportedFileError(message.fileName, message.message)
            : new Error(message.message),
      )
    }
    worker.onerror = (event) => {
      done = true
      worker.terminate()
      reject(new Error(event.message || '파일을 읽는 워커가 멈췄습니다.'))
    }
  })

  const request: TableRequest = { id, file, options }
  worker.postMessage(request)

  return {
    result,
    cancel() {
      if (done) return
      done = true
      worker.terminate()
    },
  }
}
