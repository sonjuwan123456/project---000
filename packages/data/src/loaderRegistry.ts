/**
 * 로더 레지스트리 — 형식 표(`formats`)와 읽개들을 잇는 자리.
 *
 * 바깥에서 파일을 열 때 쓰는 입구가 여기 하나다. 어느 형식이 어느 읽개로 가는지는
 * 여기서만 알고, 부르는 쪽은 `Asset` 하나만 받는다.
 */

import { resolveFormat, supportedLabels, type AssetKind } from './formats'
import type { BuildOptions, LoadedTable } from './loadTable'
import { readModelFile, type LoadedModel, type ReadableBinaryFile } from './readModelFile'
import { readTableFile } from './readTableFile'
import { readTextFile, type LoadedText, type ReadableTextFile } from './readTextFile'
import { PreferTextError, UnsupportedFileError } from './unsupported'

/** 불러온 자산. 종류마다 안에 든 것이 다르고, 여는 길은 하나다. */
export type Asset =
  | {
      readonly kind: 'table'
      readonly assetId: string
      readonly name: string
      readonly table: LoadedTable
    }
  | {
      readonly kind: 'model'
      readonly assetId: string
      readonly name: string
      readonly model: LoadedModel
    }
  | {
      readonly kind: 'text'
      readonly assetId: string
      readonly name: string
      readonly text: LoadedText
    }

/** 브라우저의 File이 그대로 들어맞는다. `slice`는 앞머리를 떼어 볼 때만 쓴다. */
export type ReadableAsset = ReadableBinaryFile &
  ReadableTextFile & {
    slice?(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
  }

const HEAD_BYTES = 16

/** 앞머리를 떼어 온다. 못 떼는 파일이면 내용 판별을 건너뛴다. */
async function headOf(file: ReadableAsset): Promise<Uint8Array | undefined> {
  if (typeof file.slice !== 'function') return undefined
  try {
    return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
  } catch {
    return undefined
  }
}

/** 파일 이름과 내용으로 종류만 먼저 본다. 표는 워커로 보내야 해서 부르는 쪽이 갈라 쓴다. */
export async function kindOfFile(file: ReadableAsset): Promise<AssetKind | null> {
  const format = resolveFormat(file.name, await headOf(file))
  if (format === null || format.planned !== undefined) return null
  return format.kind
}

/**
 * 텍스트 자산으로 읽는다. 표에서 넘어온 경우에는 왜 넘어왔는지를 안내에 얹는다.
 *
 * 그 줄을 경고로 다는 까닭은 위험해서가 아니라, 사람이 시킨 것과 다른 일이 일어났기
 * 때문이다. 표를 기대하고 떨어뜨렸는데 글이 떴으면 그 까닭이 눈에 띄어야 한다.
 */
async function asTextAsset(file: ReadableAsset, reason?: string): Promise<Asset> {
  const text = await readTextFile(file)
  const withReason: LoadedText =
    reason === undefined
      ? text
      : { ...text, notices: [{ level: 'warning', message: reason }, ...text.notices] }
  return { kind: 'text', assetId: text.assetId, name: file.name, text: withReason }
}

/**
 * 파일 하나를 자산으로 읽는다.
 *
 * 표는 워커에서 읽는 길(`startTableRead`)이 따로 있다. 5만 행을 주 스레드에서 읽으면
 * 화면이 굳기 때문이다. 이 입구는 워커를 쓸 수 없는 자리와 시험이 쓴다.
 */
export async function readAssetFile(
  file: ReadableAsset,
  options: BuildOptions = {},
): Promise<Asset> {
  const format = resolveFormat(file.name, await headOf(file))

  if (format === null) {
    throw new UnsupportedFileError(
      file.name,
      `이 파일은 읽지 못합니다. ${supportedLabels().join(', ')}을(를) 받습니다.`,
    )
  }
  if (format.planned !== undefined) {
    throw new UnsupportedFileError(file.name, format.planned)
  }

  if (format.kind === 'model') {
    const model = await readModelFile(file)
    return { kind: 'model', assetId: model.assetId, name: file.name, model }
  }
  if (format.kind === 'text') {
    return await asTextAsset(file)
  }
  if (format.kind === 'table') {
    try {
      const table = await readTableFile(file, options)
      return { kind: 'table', assetId: table.assetId, name: file.name, table }
    } catch (error) {
      // 표가 아니었을 뿐이면 실패로 두지 않고 글자로 연다(로그로 온 .txt, 중첩된 JSON).
      if (error instanceof PreferTextError) return await asTextAsset(file, error.message)
      throw error
    }
  }

  throw new UnsupportedFileError(file.name, '아직 읽지 못하는 형식입니다.')
}
