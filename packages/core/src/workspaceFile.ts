/**
 * 작업 공간 파일 — 조건만 저장하고 불러올 때 다시 계산한다.
 *
 * 설계 문서 6장: 선택 비트 배열은 저장하지 않는다. 행 수만큼 긴 배열을 파일에 넣으면
 * 용량도 문제지만, 데이터가 바뀌면 조용히 틀린 선택이 되살아난다. 조건만 남기면
 * 불러올 때 지금 데이터로 다시 계산한 결과가 나온다.
 *
 * 다만 올가미처럼 행을 직접 고른 선택은 조건으로 되살릴 수 없다. 설계 문서 2장이
 * 작업 공간에 "고정 선택"을 두기로 한 자리가 이것이고, 여기서는 행 번호 배열로 저장한다.
 * 행 번호는 표가 같아야 뜻이 있으므로 어느 표였는지를 함께 적어 두고, 불러올 때 다르면
 * 그 조건만 버린다. 다른 표에 남의 행 번호를 얹는 것보다 조건 하나를 잃는 편이 낫다.
 *
 * 어느 표였는지는 `assetId`로 본다(버전 2에서 들어왔다). 행 수만으로는 행이 같은 수인
 * 다른 파일을 구별할 수 없다. `assetId`를 모르는 쪽이 있으면 예전처럼 행 수만 본다.
 *
 * 형식 버전을 맨 앞에 둔다. 옛 파일은 읽을 때 지금 형식으로 바꿔 받는다.
 *
 * - 버전 1: 조건, 카메라, 효과 강도.
 * - 버전 2: 자산 id가 들어왔다.
 * - 버전 3: 패널 배치와 카메라 북마크가 들어왔다(M5). 옛 파일은 기본 배치와 빈 북마크로 받는다.
 */
import type { CameraBookmark } from './bookmarks'
import { clampLayout, type PanelLayout } from './layout'
import type { SelectionClause, SelectionClauses, SelectionSource } from './selection'

export const WORKSPACE_FORMAT_VERSION = 3

/** 버전 2부터 `assetId`가 있다. 그보다 옛 파일은 자산을 모르는 것으로 보고 받아들인다. */
const OLDEST_READABLE_VERSION = 1

/** 배치와 북마크가 들어온 버전. */
const LAYOUT_VERSION = 3

export type StoredCamera = {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
}

export type StoredClause =
  | { readonly source: SelectionSource; readonly kind: 'rows'; readonly rows: readonly number[] }
  | {
      readonly source: SelectionSource
      readonly kind: 'category'
      readonly column: string
      readonly values: readonly number[]
    }
  | {
      readonly source: SelectionSource
      readonly kind: 'range'
      readonly column: string
      readonly min: number
      readonly max: number
    }

export type WorkspaceFile = {
  readonly version: number
  readonly savedAt: string
  /** 저장된 행 번호가 어느 표를 가리키는지 알아보는 값. */
  readonly rowCount: number
  /** 그 표의 자산 id. 버전 1 파일에서 불러왔으면 모르는 것이라 null이다. */
  readonly assetId: string | null
  readonly clauses: readonly StoredClause[]
  readonly camera: StoredCamera | null
  /** 뷰 명세에 해당하는 것 중 지금 있는 것 하나. */
  readonly effect: string
  /** 버전 3 전 파일이면 null이다. 기본 배치로 연다. */
  readonly layout: PanelLayout | null
  readonly bookmarks: readonly CameraBookmark[]
}

export type WorkspaceSnapshot = {
  readonly clauses: SelectionClauses
  readonly rowCount: number
  /** 지금 표의 자산 id. 아직 자산 개념이 없는 표라면 null. */
  readonly assetId: string | null
  readonly camera: StoredCamera | null
  readonly effect: string
  readonly layout: PanelLayout
  readonly bookmarks: readonly CameraBookmark[]
}

/**
 * 되살릴 대상 표.
 *
 * 세 가지를 다 받는다. 선택 인자로 두면 부르는 쪽이 조용히 빠뜨리고, 그래도 컴파일이
 * 되니까 아무도 모른다. 실제로 그렇게 비어 있었다 — 자산 id를 파일에 적기만 하고
 * 되살릴 때 넘기지 않아, 검사가 늘 행 수로 물러서고 있었다.
 */
export type RestoreTarget = {
  readonly rowCount: number
  /** 지금 표의 자산 id. 아직 자산 개념이 없는 표라면 null. */
  readonly assetId: string | null
  /**
   * 그 이름을 지금 표에서 조건에 쓸 수 있는지.
   *
   * 같은 파일이어도 불러오기가 바뀌면 컬럼 종류가 달라진다. 범주이던 컬럼이 글이 되면
   * 조회에서 빠지는데, 조건은 그대로 남아 아무 행도 거르지 않는 채로 되살아난다.
   * 자산 id로는 못 막는다. 이름·크기·수정시각이 그대로라 "같은 파일"은 통과한다.
   */
  readonly hasColumn: (column: string) => boolean
}

/** 조건을 버린 까닭. 사람에게 알리는 문구가 달라진다. */
export type DropReason = 'different-table' | 'missing-column'

export type DroppedClause = {
  readonly source: SelectionSource
  readonly reason: DropReason
}

/** 되살린 작업 공간. 버린 조건이 있으면 `dropped`에 그 뷰 id와 까닭이 담긴다. */
export type RestoredWorkspace = {
  readonly clauses: SelectionClauses
  readonly camera: StoredCamera | null
  readonly effect: string
  /** 파일에 배치가 없었으면(버전 3 전) null. 부르는 쪽이 지금 배치를 그대로 둔다. */
  readonly layout: PanelLayout | null
  /** 북마크는 자산마다 매여 있어 표가 달라도 버리지 않는다. 그 자산을 열면 돌아온다. */
  readonly bookmarks: readonly CameraBookmark[]
  readonly dropped: readonly DroppedClause[]
}

export type ParseResult =
  | { readonly ok: true; readonly file: WorkspaceFile }
  | { readonly ok: false; readonly reason: string }

export function toWorkspaceFile(snapshot: WorkspaceSnapshot, savedAt: Date): WorkspaceFile {
  const clauses: StoredClause[] = []
  for (const [source, clause] of snapshot.clauses) {
    clauses.push(storeClause(source, clause))
  }
  return {
    version: WORKSPACE_FORMAT_VERSION,
    savedAt: savedAt.toISOString(),
    rowCount: snapshot.rowCount,
    assetId: snapshot.assetId,
    clauses,
    camera: snapshot.camera,
    effect: snapshot.effect,
    layout: snapshot.layout,
    bookmarks: snapshot.bookmarks,
  }
}

function storeClause(source: SelectionSource, clause: SelectionClause): StoredClause {
  if (clause.kind === 'rows') {
    const rows: number[] = []
    for (let row = 0; row < clause.rows.length; row += 1) {
      if (clause.rows[row] === 1) rows.push(row)
    }
    return { source, kind: 'rows', rows }
  }
  if (clause.kind === 'category') {
    return { source, kind: 'category', column: clause.column, values: [...clause.values] }
  }
  return { source, kind: 'range', column: clause.column, min: clause.min, max: clause.max }
}

/**
 * 파일을 지금 표에 맞춰 되살린다.
 *
 * 두 가지를 본다. 표가 그때와 다르면 고정 선택을 버리고, 조건이 가리키는 컬럼이 지금
 * 조건에 쓸 수 없으면 그 조건을 버린다. 버린 것은 까닭과 함께 `dropped`에 담아 돌려주니,
 * 부르는 쪽이 사람에게 알릴 수 있다.
 *
 * 버리지 않고 그냥 두면 조용히 틀린다. 없는 컬럼을 가리키는 조건은 합칠 때 무시되어
 * 아무 행도 거르지 않는데(`composeSelection`), 사람에게는 다 되살렸다고 말하게 된다.
 * 저장한 것보다 넓은 선택이 복원되는 셈이다.
 */
export function fromWorkspaceFile(file: WorkspaceFile, target: RestoreTarget): RestoredWorkspace {
  const clauses = new Map<SelectionSource, SelectionClause>()
  const dropped: DroppedClause[] = []
  const sameTable = isSameTable(file, target)

  for (const stored of file.clauses) {
    if (stored.kind === 'rows') {
      if (!sameTable) {
        dropped.push({ source: stored.source, reason: 'different-table' })
        continue
      }
      const rows = new Uint8Array(target.rowCount)
      let kept = 0
      for (const row of stored.rows) {
        if (row >= 0 && row < target.rowCount) {
          rows[row] = 1
          kept += 1
        }
      }
      if (kept === 0) dropped.push({ source: stored.source, reason: 'different-table' })
      else clauses.set(stored.source, { kind: 'rows', rows })
      continue
    }

    // 컬럼으로 버리는 것은 **같은 표일 때만** 한다. 다른 표 위에서 "그 컬럼이 없다"는
    // 말은 뜻이 없다. 화면은 파일을 열기 전 샘플 표 위에서 저장된 작업 공간을 먼저
    // 되살리는데, 거기서 버리면 사용자가 자기 파일을 열기도 전에 조건이 사라진다.
    // 브라우저로 보고서야 알았다 — 단위 시험은 늘 같은 표를 넘기고 있었다.
    if (sameTable && !target.hasColumn(stored.column)) {
      dropped.push({ source: stored.source, reason: 'missing-column' })
      continue
    }

    if (stored.kind === 'category') {
      clauses.set(stored.source, {
        kind: 'category',
        column: stored.column,
        values: [...stored.values],
      })
      continue
    }
    clauses.set(stored.source, {
      kind: 'range',
      column: stored.column,
      min: stored.min,
      max: stored.max,
    })
  }

  return {
    clauses,
    camera: file.camera,
    effect: file.effect,
    layout: file.layout,
    bookmarks: file.bookmarks,
    dropped,
  }
}

/**
 * 저장했을 때의 표와 지금 표가 같은 것인지 본다.
 *
 * 자산 id를 양쪽 다 알 때는 그것만 믿는다. 행 수가 같은 다른 파일을 고정 선택이 넘어가는
 * 일을 막는 것이 이 값을 넣은 이유다. 한쪽이라도 모르면 행 수로 물러선다. 버전 1 파일과,
 * 아직 자산 개념이 없는 표가 그렇다.
 */
function isSameTable(file: WorkspaceFile, target: RestoreTarget): boolean {
  if (file.assetId !== null && target.assetId !== null) return file.assetId === target.assetId
  return file.rowCount === target.rowCount
}

/**
 * 밖에서 들어온 값을 작업 공간 파일로 받아들인다.
 *
 * 내보낸 파일은 사람이 고칠 수 있고 다른 버전이 만든 것일 수도 있다. 믿지 않고 하나씩 본다.
 * 옛 형식을 변환해야 할 때가 오면 버전을 보고 갈라지는 자리가 여기다.
 */
export function parseWorkspaceFile(value: unknown): ParseResult {
  if (!isRecord(value)) return fail('작업 공간 파일이 아니다.')

  const version = value['version']
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return fail('형식 버전이 없다.')
  }
  if (version > WORKSPACE_FORMAT_VERSION) {
    return fail(`더 새로운 형식이다(버전 ${version}). 뷰어를 새로 고쳐야 한다.`)
  }
  if (version < OLDEST_READABLE_VERSION) {
    return fail(`읽을 수 없는 옛 형식이다(버전 ${version}).`)
  }

  const rowCount = value['rowCount']
  if (typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 0) {
    return fail('행 수가 없다.')
  }

  // 버전 1 파일에는 없는 값이다. 없으면 모르는 것으로 두고, 있는데 문자열이 아니면 거른다.
  const rawAssetId = value['assetId']
  if (rawAssetId !== undefined && rawAssetId !== null && typeof rawAssetId !== 'string') {
    return fail('자산 id가 잘못됐다.')
  }

  const rawClauses = value['clauses']
  if (!Array.isArray(rawClauses)) return fail('선택 조건 목록이 없다.')

  const clauses: StoredClause[] = []
  for (const raw of rawClauses) {
    const clause = parseClause(raw)
    if (clause === null) return fail('알 수 없는 선택 조건이 섞여 있다.')
    clauses.push(clause)
  }

  const camera = parseCamera(value['camera'])
  if (camera === undefined) return fail('카메라 값이 잘못됐다.')

  const effect = value['effect']
  const savedAt = value['savedAt']

  // 버전 3 전 파일에는 둘 다 없다. 옛 파일은 읽지 않고 기본값으로 둔다. 버전 3에서도
  // 빠져 있는 것은 받아 준다(사람이 줄여 쓴 파일). 있는데 모양이 틀리면 거른다.
  let layout: PanelLayout | null = null
  let bookmarks: CameraBookmark[] = []
  if (version >= LAYOUT_VERSION) {
    const parsedLayout = parseLayout(value['layout'])
    if (parsedLayout === undefined) return fail('패널 배치 값이 잘못됐다.')
    layout = parsedLayout
    const rawBookmarks = value['bookmarks'] ?? []
    if (!Array.isArray(rawBookmarks)) return fail('카메라 북마크 목록이 잘못됐다.')
    for (const raw of rawBookmarks) {
      const bookmark = parseBookmark(raw)
      if (bookmark === null) return fail('알 수 없는 카메라 북마크가 섞여 있다.')
      bookmarks.push(bookmark)
    }
    // 같은 id가 둘이면 하나를 지울 때 둘 다 지워진다. 뒤의 것을 버린다.
    const seen = new Set<string>()
    bookmarks = bookmarks.filter((one) => !seen.has(one.id) && seen.add(one.id))
  }

  return {
    ok: true,
    file: {
      version,
      savedAt: typeof savedAt === 'string' ? savedAt : new Date(0).toISOString(),
      rowCount,
      assetId: typeof rawAssetId === 'string' ? rawAssetId : null,
      clauses,
      camera,
      effect: typeof effect === 'string' ? effect : 'normal',
      layout,
      bookmarks,
    },
  }
}

/** 값이 잘못되면 undefined, 없으면 null. 범위를 벗어난 값은 범위 안으로 넣어 받는다. */
function parseLayout(raw: unknown): PanelLayout | null | undefined {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) return undefined
  const side = raw['side']
  const bottom = raw['bottom']
  if (typeof side !== 'number' || !Number.isFinite(side)) return undefined
  if (typeof bottom !== 'number' || !Number.isFinite(bottom)) return undefined
  return clampLayout({ side, bottom })
}

function parseBookmark(raw: unknown): CameraBookmark | null {
  if (!isRecord(raw)) return null
  const id = raw['id']
  const name = raw['name']
  const assetId = raw['assetId']
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof assetId !== 'string' || assetId === '') return null
  const camera = parseCamera(raw['camera'])
  if (camera === null || camera === undefined) return null
  return { id, name: name.trim(), assetId, camera }
}

function parseClause(raw: unknown): StoredClause | null {
  if (!isRecord(raw)) return null
  const source = raw['source']
  if (typeof source !== 'string' || source === '') return null

  if (raw['kind'] === 'rows') {
    const rows = raw['rows']
    if (!Array.isArray(rows)) return null
    const kept: number[] = []
    for (const row of rows) {
      if (typeof row !== 'number' || !Number.isInteger(row) || row < 0) return null
      kept.push(row)
    }
    return { source, kind: 'rows', rows: kept }
  }

  if (raw['kind'] === 'category') {
    const column = raw['column']
    const values = raw['values']
    if (typeof column !== 'string' || !Array.isArray(values)) return null
    const kept: number[] = []
    for (const item of values) {
      if (typeof item !== 'number' || !Number.isFinite(item)) return null
      kept.push(item)
    }
    return { source, kind: 'category', column, values: kept }
  }

  if (raw['kind'] === 'range') {
    const column = raw['column']
    const min = raw['min']
    const max = raw['max']
    if (typeof column !== 'string') return null
    if (typeof min !== 'number' || !Number.isFinite(min)) return null
    if (typeof max !== 'number' || !Number.isFinite(max)) return null
    if (min > max) return null
    return { source, kind: 'range', column, min, max }
  }

  return null
}

/** 값이 잘못되면 undefined, 없으면 null. */
function parseCamera(raw: unknown): StoredCamera | null | undefined {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) return undefined
  const position = parseTriple(raw['position'])
  const target = parseTriple(raw['target'])
  if (position === null || target === null) return undefined
  return { position, target }
}

function parseTriple(raw: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null
  const [x, y, z] = raw
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  if (typeof z !== 'number' || !Number.isFinite(z)) return null
  return [x, y, z]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(reason: string): ParseResult {
  return { ok: false, reason }
}
