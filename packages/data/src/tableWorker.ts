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
import { progressOf, throttleProgress, type LoadProgress } from './progress'
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

/**
 * 일감 하나의 끝. 성공이거나 실패고, 하나만 온다.
 *
 * 진행률이 이 갈래에 없는 까닭은 `handleTableRequest`가 진행률을 돌려주지 않기
 * 때문이다. 그쪽은 부르는 쪽이 준 콜백으로 나간다. 둘을 한 갈래로 묶으면 결과를
 * 보는 자리마다 "이번 것은 진행률인가" 를 먼저 물어야 한다.
 */
export type TableResult =
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

/** 워커 선을 건너오는 것 전부. 진행률은 끝나기 전에 여러 번 온다. */
export type TableResponse =
  TableResult | { readonly id: number; readonly kind: 'progress'; readonly progress: LoadProgress }

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
  /** 중간 진행률을 내보낼 곳. 워커가 아니면(시험) 주지 않아도 된다. */
  onProgress?: (progress: LoadProgress) => void,
): Promise<{ response: TableResult; transfer: ArrayBuffer[] }> {
  try {
    const report = onProgress === undefined ? undefined : throttleProgress((one) => onProgress(one))
    const loaded = await readTableFile(request.file, {
      ...(request.options ?? {}),
      ...(report === undefined ? {} : { onProgress: report }),
    })
    /*
     * 마지막 한 번은 거르지 않고 내보낸다. 거르는 창에 걸리면 막대가 85%쯤에서
     * 멈춘 채로 사라지고, 그 모습은 끝난 것이 아니라 그만둔 것처럼 보인다.
     */
    report?.flush(progressOf('building', 1))
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
    const { id } = event.data
    void handleTableRequest(event.data, (progress) => {
      // 진행률에는 넘길 버퍼가 없다. 복사할 것도 작은 객체 하나뿐이다.
      scope.postMessage?.({ id, kind: 'progress', progress }, [])
    }).then(({ response, transfer }) => {
      scope.postMessage?.(response, transfer)
    })
  }
}
