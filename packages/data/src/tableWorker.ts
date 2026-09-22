/**
 * 파일 하나를 표로 읽는 워커.
 *
 * 5만 행 384차원짜리 파일이면 읽기·파싱·종류 판별에 수 초가 걸린다. 본 스레드에서
 * 돌리면 그동안 화면이 통째로 굳어서, 파일을 떨어뜨린 사람은 앱이 죽은 줄 안다.
 *
 * 파일(`File`)은 구조화 복제를 그대로 통과하므로 파일째 넘긴다. 그래야 텍스트로
 * 푸는 일까지 이쪽에서 한다. 본 스레드가 먼저 `text()`를 부르면 7MB짜리 디코딩이
 * 다시 본 스레드에 남는다.
 */

import type { BuildOptions, LoadedTableData } from './loadTable'
import {
  PreferTextError,
  UnsupportedFileError,
  readTableFile,
  type ReadableFile,
} from './readTableFile'
import { transferable, workerScope } from './workerSupport'

export type TableRequest = {
  readonly id: number
  readonly file: ReadableFile
  readonly options?: BuildOptions
}

export type TableResponse =
  | { readonly id: number; readonly ok: true; readonly table: LoadedTableData }
  | {
      readonly id: number
      readonly ok: false
      /** true면 읽을 수 없는 형식이라 막은 것이다. 사용자에게 그대로 보여 줄 문구다. */
      readonly unsupported: boolean
      /** true면 실패가 아니라 갈래를 잘못 짚은 것이다. 부르는 쪽이 텍스트로 다시 연다. */
      readonly preferText: boolean
      readonly fileName: string
      readonly message: string
    }

/** 표에서 넘길 수 있는 버퍼를 모은다. 복사 한 번을 아낀다. */
function buffersOf(table: LoadedTableData): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  const take = (view: { buffer: ArrayBufferLike }) => out.push(transferable(view))
  for (const column of table.columns) {
    if (column.kind === 'number' || column.kind === 'datetime') take(column.values)
    else if (column.kind === 'category') {
      take(column.codes)
      take(column.counts)
    }
  }
  for (const vector of table.vectors) {
    take(vector.values)
    take(vector.missing)
  }
  return out
}

/** 요청 하나를 처리한다. 워커 밖에서도 부를 수 있게 떼어 둔다(시험이 쓴다). */
export async function handleTableRequest(
  request: TableRequest,
): Promise<{ response: TableResponse; transfer: ArrayBuffer[] }> {
  try {
    const loaded = await readTableFile(request.file, request.options ?? {})
    // 조회 함수는 넘어가지 않는다. 받는 쪽이 attachLookup으로 다시 단다.
    const table: LoadedTableData = {
      assetId: loaded.assetId,
      rowCount: loaded.rowCount,
      columns: loaded.columns,
      vectors: loaded.vectors,
      hiddenColumns: loaded.hiddenColumns,
      notices: loaded.notices,
    }
    return { response: { id: request.id, ok: true, table }, transfer: buffersOf(table) }
  } catch (error) {
    const unsupported = error instanceof UnsupportedFileError
    return {
      response: {
        id: request.id,
        ok: false,
        unsupported,
        preferText: error instanceof PreferTextError,
        fileName: request.file.name,
        message:
          error instanceof Error ? error.message : `'${request.file.name}'을(를) 읽지 못했습니다.`,
      },
      transfer: [],
    }
  }
}

// 워커로 불린 경우에만 귀를 연다. 시험은 이 파일을 그냥 불러다 위 함수만 쓴다.
const scope = workerScope<TableRequest, TableResponse>()
if (scope !== null) {
  scope.onmessage = (event) => {
    void handleTableRequest(event.data).then(({ response, transfer }) => {
      scope.postMessage?.(response, transfer)
    })
  }
}
