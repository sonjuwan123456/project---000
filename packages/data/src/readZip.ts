/**
 * zip 하나를 파일 묶음으로 푼다 (설계 문서 6장 M1, 폴더·zip 불러오기).
 *
 * **압축 라이브러리를 쓰지 않는다.** 브라우저가 `DecompressionStream('deflate-raw')`로
 * 이미 해제기를 내주고 있어서, 남는 일은 zip 상자의 목차를 읽는 것뿐이다. 목차를 읽는
 * 코드는 200줄이 안 되고, 그 대가로 의존성 하나와 300KB를 들이지 않는다. 이 프로젝트가
 * 마크다운 라이브러리와 DOMPurify를 들이지 않은 것과 같은 판단이다.
 *
 * **중앙 목록(central directory)을 읽는다.** zip은 앞에서부터 항목이 죽 이어지고 끝에
 * 목차가 붙는 모양이다. 앞에서부터 훑어도 되지만 목차를 읽는 편이 옳다 — 지운 항목과
 * 덧붙인 항목은 목차에만 제대로 적혀 있고, 압축 해제 뒤의 크기도 거기 적혀 있어서
 * **한 바이트도 풀기 전에** zip 폭탄을 가려낼 수 있다.
 *
 * **푸는 일은 미룬다.** 항목마다 압축된 조각만 들고 있다가 `arrayBuffer()`를 부를 때
 * 푼다. 모델 하나에 텍스처 스무 개가 든 zip에서 실제로 쓰이는 것은 glTF가 가리키는
 * 것뿐이고, 나머지 열여덟 개를 풀어 둘 까닭이 없다.
 */

import type { BundleFile } from './fileBundle'
import { MAX_UNPACKED_BYTES, checkUnpackedSize, formatBytes } from './sizeGuard'

import { UnsupportedFileError } from './unsupported'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** 끝의 주석은 최대 65535바이트다. 목차를 찾아 거슬러 올라갈 거리가 이만큼이다. */
const EOCD_SEARCH = 22 + 0xffff

const STORED = 0
const DEFLATED = 8

/** 이름이 UTF-8이라고 적어 둔 깃발. 없으면 만든 컴퓨터의 지역 인코딩이다. */
const UTF8_FLAG = 0x800

/** 읽는 일만 밖에서 시킨다. 브라우저의 File이 그대로 들어맞는다. */
export type ReadableZip = {
  readonly name: string
  readonly size?: number
  arrayBuffer(): Promise<ArrayBuffer>
}

function refuse(name: string, why: string): never {
  throw new UnsupportedFileError(name, why)
}

/** 끝에서 거슬러 올라가며 목차의 머리를 찾는다. */
function findEndRecord(view: DataView): number {
  const floor = Math.max(0, view.byteLength - EOCD_SEARCH)
  for (let at = view.byteLength - 22; at >= floor; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  return -1
}

/**
 * 항목 이름을 글자로 바꾼다.
 *
 * 깃발이 UTF-8이라고 하면 그대로 믿는다. 아니면 UTF-8로 읽어 보고, 깨지면 EUC-KR로
 * 본다 — 윈도 탐색기로 압축한 zip은 한글 이름을 CP949로 적어 두고 깃발을 세우지
 * 않는다. 그대로 두면 사람이 자기 파일 이름을 알아보지 못한다.
 */
function nameOf(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

async function inflate(piece: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([piece as BlobPart]).stream()
  const opened = stream.pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(opened).arrayBuffer()
}

function copyOf(piece: Uint8Array): ArrayBuffer {
  return piece.buffer.slice(piece.byteOffset, piece.byteOffset + piece.byteLength) as ArrayBuffer
}

/**
 * DOS 날짜·시각을 보통 시각으로. zip은 1980년을 0년으로 세고 초를 2초 단위로 적는다.
 *
 * 이것을 읽는 까닭은 자산 id가 이름·크기·고친 때로 만들어지기 때문이다. 여기서
 * 넘기지 않으면 항목마다 "지금"이 박혀서, 같은 zip을 다시 열 때마다 다른 자산이
 * 되고 저장해 둔 작업 공간이 자기 자산을 못 알아본다.
 */
function whenOf(time: number, date: number): number {
  const year = 1980 + ((date >> 9) & 0x7f)
  const month = ((date >> 5) & 0x0f) - 1
  const day = date & 0x1f
  return new Date(
    year,
    month,
    day,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  ).getTime()
}

type CentralEntry = {
  readonly path: string
  readonly method: number
  readonly compressedSize: number
  readonly size: number
  readonly localOffset: number
  readonly modified: number
}

/** 중앙 목록을 훑는다. 폴더 항목과 모르는 압축 방식은 여기서 걸러진다. */
function readCentral(view: DataView, bytes: Uint8Array, start: number, count: number) {
  const entries: CentralEntry[] = []
  let at = start
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) break
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const compressedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const modified = whenOf(view.getUint16(at + 12, true), view.getUint16(at + 14, true))

    const path = nameOf(bytes.subarray(at + 46, at + 46 + nameLength), (flags & UTF8_FLAG) !== 0)
    at += 46 + nameLength + extraLength + commentLength

    // 폴더 항목은 이름이 슬래시로 끝나고 내용이 없다. 묶음은 파일만 담는다.
    if (path.endsWith('/')) continue
    // 저장과 deflate 말고는 거의 쓰이지 않는다. 모르는 것은 없는 셈 친다.
    if (method !== STORED && method !== DEFLATED) continue
    entries.push({ path, method, compressedSize, size, localOffset, modified })
  }
  return entries
}

/**
 * 항목의 내용이 어디서 시작하는지.
 *
 * 중앙 목록의 오프셋은 **지역 머리말**을 가리키고, 내용은 그 뒤다. 지역 머리말의
 * 이름·덧붙임 길이는 중앙 목록의 것과 다를 수 있으므로(덧붙임이 한쪽에만 붙는다)
 * 반드시 지역 머리말에서 다시 읽어야 한다. 중앙 목록 값으로 건너뛰면 몇 바이트씩
 * 어긋나 해제가 통째로 실패한다.
 */
function dataStart(view: DataView, entry: CentralEntry): number | null {
  const at = entry.localOffset
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_SIGNATURE) return null
  return at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true)
}

/**
 * zip을 풀어 `[경로, 파일]` 목록을 낸다. 그대로 `bundleOf`에 넣으면 된다.
 *
 * 푸는 것은 미루지만 **크기 검사는 미루지 않는다.** zip 폭탄은 첫 항목을 푸는 순간
 * 이미 늦어서, 목차에 적힌 합으로 먼저 막는다.
 */
export async function entriesOfZip(file: ReadableZip): Promise<[string, BundleFile][]> {
  /*
   * 상자 자체의 크기를 먼저 본다. 목차는 파일을 다 읽어야 나오는데, 3GB짜리 zip은
   * 그 한 줄(`arrayBuffer()`)에서 이미 탭을 죽인다. 눌린 것이 800MB를 넘으면 풀어서
   * 열 수 있는 zip이 아니다.
   */
  const packed = checkUnpackedSize(file.name, file.size ?? 0)
  if (packed.level === 'block') {
    refuse(
      file.name,
      `'${file.name}'은(는) ${formatBytes(file.size ?? 0)}라 열지 않았습니다. 압축 파일은 ${formatBytes(MAX_UNPACKED_BYTES)}까지 열 수 있습니다.`,
    )
  }

  const buffer = await file.arrayBuffer()

  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (buffer.byteLength < 22) refuse(file.name, '압축 파일이 비어 있거나 깨졌습니다.')

  const end = findEndRecord(view)
  if (end === -1) refuse(file.name, 'zip 파일로 읽히지 않습니다. 파일이 온전한지 확인해 주세요.')

  const count = view.getUint16(end + 10, true)
  const centralOffset = view.getUint32(end + 16, true)
  /*
   * 0xffff·0xffffffff는 "진짜 값은 ZIP64 쪽에 있다"는 표시다. 4GB가 넘거나 항목이
   * 65535개를 넘을 때만 나오는데, 여기까지 오면 어차피 크기 검사에 걸린다. 그래서
   * ZIP64를 읽는 대신 무엇을 하면 되는지 말해 준다.
   */
  if (count === 0xffff || centralOffset === 0xffffffff) {
    refuse(file.name, '4GB가 넘는 압축 파일(ZIP64)은 아직 열지 못합니다. 폴더째 넣어 주세요.')
  }

  const found = readCentral(view, bytes, centralOffset, count)
  if (found.length === 0) refuse(file.name, '압축 파일 안에서 열 수 있는 파일을 찾지 못했습니다.')

  const unpacked = found.reduce((total, entry) => total + entry.size, 0)
  const verdict = checkUnpackedSize(file.name, unpacked)
  if (verdict.level === 'block') refuse(file.name, verdict.message)

  const entries: [string, BundleFile][] = []
  for (const entry of found) {
    const at = dataStart(view, entry)
    if (at === null) continue
    const piece = bytes.subarray(at, at + entry.compressedSize)
    const unpack = async () => (entry.method === STORED ? copyOf(piece) : await inflate(piece))
    entries.push([
      entry.path,
      {
        name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
        size: entry.size,
        lastModified: entry.modified,

        arrayBuffer: unpack,
        // 인코딩은 읽개가 다시 본다(BOM, EUC-KR). 여기서는 UTF-8로 한 번 펴 줄 뿐이다.
        text: async () => new TextDecoder().decode(await unpack()),
      },
    ])
  }
  return entries
}

/** 이 파일이 zip인지. 확장자만 본다 — 안을 보는 것은 여는 쪽 일이다. */
export function looksLikeZip(name: string): boolean {
  return name.toLowerCase().endsWith('.zip')
}
