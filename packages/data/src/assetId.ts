/**
 * 자산 id — 불러온 표를 "같은 표"로 알아보는 열쇠.
 *
 * 작업 공간 파일은 올가미로 고정한 선택을 행 번호로 저장한다. 행 수만 맞으면
 * 남의 파일에 남의 행 번호를 얹게 되므로, 표를 갈아 끼울 수 있게 된 이상
 * 행 수보다 좁은 식별자가 필요하다.
 *
 * 내용을 해시하지 않는 이유는 비용이다. 5만 행짜리 파일을 열 때마다 전체를 한 번 더
 * 읽는 값을 치를 만큼 정확도가 필요하지는 않다. 파일 이름·크기·수정 시각이면
 * "같은 파일을 다시 열었다"와 "고친 파일을 열었다"를 가르는 데 충분하고,
 * 고친 파일이 다른 id를 받는 것은 오히려 원하는 동작이다.
 */

/** FNV-1a 32비트. 짧고 의존성이 없다. 보안용이 아니라 구분용이다. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function fingerprint(parts: readonly (string | number)[]): string {
  return fnv1a(parts.join('\u0000')).toString(16).padStart(8, '0')
}

/** 파일에서 뽑을 수 있는 것들. 브라우저 File이 그대로 들어맞는다. */
export type FileIdentity = {
  readonly name: string
  readonly size?: number
  readonly lastModified?: number
}

export function assetIdOfFile(file: FileIdentity): string {
  return `file-${fingerprint([file.name, file.size ?? -1, file.lastModified ?? -1])}`
}

/**
 * 파일이 없을 때(직접 만든 표, 붙여 넣은 데이터)의 id.
 * 컬럼 이름·종류와 행 수로 만든다. 같은 모양이면 같은 id를 받는다.
 */
export function assetIdOfShape(
  rowCount: number,
  columns: readonly (readonly [string, string])[],
  vectors: readonly (readonly [string, number])[],
): string {
  const parts: (string | number)[] = [rowCount]
  for (const [name, kind] of columns) parts.push(name, kind)
  for (const [name, dimension] of vectors) parts.push(name, dimension)
  return `shape-${fingerprint(parts)}`
}
