/**
 * 파일 크기 안전장치 — 설계 문서 6장 "공통 로더 기능"의 안전장치 절반.
 *
 * 브라우저에는 "메모리가 모자랍니다"가 없다. 탭이 그냥 죽는다. 사용자가 보는 것은
 * 오류 메시지가 아니라 회색 화면이고, 방금 무엇을 했는지와 이어 붙일 단서가 없다.
 * 그래서 열기 전에 크기를 보고, 무거우면 미리 말하고, 못 열 것이면 열지 않는다.
 *
 * 설계 문서 10장은 기준값 자체를 남은 과제로 두었다(형식별 경고·거부 기준). 여기
 * 적은 값은 이 스레드가 정한 것이고, 근거를 값 옆에 적어 두었다. 고치는 자리는
 * `LIMITS` 한 곳이다.
 *
 * zip 폭탄(압축 해제 후 크기 제한)은 `checkUnpackedSize`가 본다. 설계 문서 6장이
 * 따로 적어 둔 항목이고, 앞의 검사로는 못 막는다 — 42KB짜리 zip이 4GB로 풀리는 일이
 * 있어서, 파일 크기만 보면 통과한 뒤에 탭이 죽는다.
 */

import { extensionOf, resolveFormat, type AssetKind } from './formats'
import type { LoadNotice } from './loadTable'

export type SizeVerdict =
  | { readonly level: 'ok' }
  | { readonly level: 'warn'; readonly message: string }
  | { readonly level: 'block'; readonly message: string }

type Limit = {
  /** 이 크기를 넘으면 열기는 하되 미리 말한다. */
  readonly warnBytes: number
  /** 이 크기를 넘으면 열지 않는다. */
  readonly blockBytes: number
}

const MB = 1024 * 1024

/**
 * 종류별 기준값.
 *
 * **표.** 거부선 400MB는 취향이 아니라 벽이다. 표를 읽으려면 파일 전체를 자바스크립트
 * 문자열로 풀어야 하는데, 그 문자열은 UTF-16이라 아스키 파일의 두 배가 되고, V8의
 * 문자열 최대 길이는 약 512MB다. 400MB짜리 CSV는 푸는 순간 그 한계에 부딪혀
 * "Invalid string length"로 죽는다. 경고선 100MB는 기준 작업량(5만 행 × 384차원 CSV가
 * 약 7MB)의 열 배가 넘는 자리이고, 그 위부터는 문자열·열 배열·타입 배열이 동시에
 * 얹혀서 눈에 띄게 느려진다.
 *
 * **3D 모델.** 메시와 텍스처는 결국 GPU로 올라가고 버퍼 크기가 파일 크기와 대체로
 * 같다. 600MB면 어지간한 통합 그래픽의 몫을 통째로 쓴다.
 *
 * **글자.** 기준이 없다. `readTextFile`은 파일이 아무리 커도 앞 32MB만 떼어다 풀고
 * 잘랐다고 말해 준다. 실제로 드는 메모리가 파일 크기를 따라가지 않으니, 크기를 보고
 * 겁을 줄 일도 막을 일도 없다. 잘렸다는 사실은 읽개가 자기 안내로 말한다.
 */
const LIMITS: Readonly<Record<AssetKind, Limit>> = {
  table: { warnBytes: 100 * MB, blockBytes: 400 * MB },
  model: { warnBytes: 150 * MB, blockBytes: 600 * MB },
  text: { warnBytes: Number.POSITIVE_INFINITY, blockBytes: Number.POSITIVE_INFINITY },
}

/** 사람이 읽을 크기. 1,234,567 → "1.2MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < MB) return `${Math.round(bytes / 1024)}KB`
  const megabytes = bytes / MB
  if (megabytes < 1024) return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)}MB`
  return `${(megabytes / 1024).toFixed(1)}GB`
}

const KIND_LABELS: Readonly<Record<AssetKind, string>> = {
  table: '표',
  model: '3D 모델',
  text: '글자',
}

/**
 * 열기 전에 크기를 본다.
 *
 * 종류를 모르면 표로 본다. 표가 셋 중 제일 빡빡해서, 모르는 것을 그쪽에 두면
 * 틀렸을 때 "열 수 있었는데 막았다"가 되지 "죽었다"가 되지 않는다.
 *
 * 크기를 모르면(`bytes`가 없는 파일) 통과시킨다. 모르는 것을 막으면 크기를 알려
 * 주지 않는 자리에서 온 파일이 전부 막힌다.
 */
export function checkFileSize(
  name: string,
  bytes: number | undefined,
  kind?: AssetKind,
): SizeVerdict {
  if (bytes === undefined) return { level: 'ok' }
  const resolved = kind ?? resolveFormat(name)?.kind ?? 'table'
  const limit = LIMITS[resolved]
  const size = formatBytes(bytes)

  if (bytes > limit.blockBytes) {
    return {
      level: 'block',
      message:
        `'${name}'은(는) ${size}라 열지 않았습니다. ` +
        `${KIND_LABELS[resolved]}는 ${formatBytes(limit.blockBytes)}까지 열 수 있습니다. ` +
        (resolved === 'table'
          ? '행을 나누거나 필요한 컬럼만 남겨서 내보내 주세요.'
          : '더 작게 내보내 주세요.'),
    }
  }

  if (bytes > limit.warnBytes) {
    return {
      level: 'warn',
      message: `'${name}'은(는) ${size}입니다. 여는 데 시간이 걸리고 브라우저가 느려질 수 있습니다.`,
    }
  }

  return { level: 'ok' }
}

/**
 * 경고를 읽개의 안내로 옮긴다. 막는 것과 달리 경고는 여는 일을 세우지 않으므로,
 * 불러온 자산에 얹혀 다른 안내와 같은 자리에 뜬다.
 */
export function sizeNotices(verdict: SizeVerdict): LoadNotice[] {
  return verdict.level === 'warn' ? [{ level: 'warning', message: verdict.message }] : []
}

/** 이 종류의 기준값. 화면이 "몇 MB까지 됩니다"를 말할 때 쓴다. */
export function limitsOf(kind: AssetKind): Limit {
  return LIMITS[kind]
}

/**
 * 압축을 풀었을 때의 크기. zip 폭탄을 막는 자리다.
 *
 * 이 검사가 따로 있는 까닭은 zip 파일 자체의 크기로는 아무것도 알 수 없기 때문이다.
 * 같은 바이트가 반복되면 압축률이 수천 배가 나오므로, 42KB짜리 zip이 4GB로 풀리는
 * 일이 실제로 있다. 앞의 `checkFileSize`는 그런 zip을 아무 말 없이 통과시킨다.
 *
 * **재지 않고 적힌 값을 본다.** zip의 중앙 목록에는 항목마다 푼 뒤의 크기가 적혀
 * 있어서, 한 바이트도 풀기 전에 합을 낼 수 있다. 풀어 가며 세는 방법도 있지만 그때는
 * 이미 메모리를 쓴 뒤다. 적힌 값이 거짓말일 수는 있는데, 그건 푼 결과가 안 맞는
 * 문제이지 탭이 죽는 문제가 아니다.
 *
 * 800MB는 모델 거부선(600MB)에 텍스처 몫을 얹은 자리다. 묶음 하나가 그보다 크면
 * 어차피 그 안의 모델 하나가 따로 막힌다.
 */
export const MAX_UNPACKED_BYTES = 800 * MB

export function checkUnpackedSize(label: string, bytes: number): SizeVerdict {
  if (bytes > MAX_UNPACKED_BYTES) {
    return {
      level: 'block',
      message:
        `'${label}'은(는) 풀면 ${formatBytes(bytes)}라 열지 않았습니다. ` +
        `압축 파일은 풀었을 때 ${formatBytes(MAX_UNPACKED_BYTES)}까지 열 수 있습니다. ` +
        '필요한 파일만 담아 다시 압축하거나, 폴더째 넣어 주세요.',
    }
  }
  if (bytes > MAX_UNPACKED_BYTES / 4) {
    return {
      level: 'warn',
      message: `'${label}'은(는) 풀면 ${formatBytes(bytes)}입니다. 푸는 데 시간이 걸립니다.`,
    }
  }
  return { level: 'ok' }
}

/** 확장자만 보고 종류를 낸다. 크기 검사 전에 파일을 열어 볼 필요가 없게. */

export function kindOfName(name: string): AssetKind {
  if (extensionOf(name) === '') return 'table'
  return resolveFormat(name)?.kind ?? 'table'
}
