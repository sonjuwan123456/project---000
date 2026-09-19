/**
 * 작업 공간 파일 — 조건만 저장하고 불러올 때 다시 계산한다.
 *
 * 설계 문서 6장: 선택 비트 배열은 저장하지 않는다. 행 수만큼 긴 배열을 파일에 넣으면
 * 용량도 문제지만, 데이터가 바뀌면 조용히 틀린 선택이 되살아난다. 조건만 남기면
 * 불러올 때 지금 데이터로 다시 계산한 결과가 나온다.
 *
 * 다만 올가미처럼 행을 직접 고른 선택은 조건으로 되살릴 수 없다. 설계 문서 2장이
 * 작업 공간에 "고정 선택"을 두기로 한 자리가 이것이고, 여기서는 행 번호 배열로 저장한다.
 * 행 번호는 표가 같아야 뜻이 있으므로 `rowCount`를 함께 적어 두고, 불러올 때 다르면
 * 그 조건만 버린다. 다른 표에 남의 행 번호를 얹는 것보다 조건 하나를 잃는 편이 낫다.
 *
 * 형식 버전을 맨 앞에 둔다. 옛 파일을 자동으로 변환할 자리를 미리 비워 두는 것이다.
 */
import type { SelectionClause, SelectionClauses, SelectionSource } from './selection'

export const WORKSPACE_FORMAT_VERSION = 1

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
  readonly clauses: readonly StoredClause[]
  readonly camera: StoredCamera | null
  /** 뷰 명세에 해당하는 것 중 지금 있는 것 하나. */
  readonly effect: string
}

export type WorkspaceSnapshot = {
  readonly clauses: SelectionClauses
  readonly rowCount: number
  readonly camera: StoredCamera | null
  readonly effect: string
}

/** 되살린 작업 공간. 버린 조건이 있으면 `dropped`에 그 뷰 id가 담긴다. */
export type RestoredWorkspace = {
  readonly clauses: SelectionClauses
  readonly camera: StoredCamera | null
  readonly effect: string
  readonly dropped: readonly SelectionSource[]
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
    clauses,
    camera: snapshot.camera,
    effect: snapshot.effect,
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
 * 행 수가 다르면 고정 선택은 버리고 나머지 조건만 되살린다.
 */
export function fromWorkspaceFile(file: WorkspaceFile, rowCount: number): RestoredWorkspace {
  const clauses = new Map<SelectionSource, SelectionClause>()
  const dropped: SelectionSource[] = []

  for (const stored of file.clauses) {
    if (stored.kind === 'rows') {
      if (file.rowCount !== rowCount) {
        dropped.push(stored.source)
        continue
      }
      const rows = new Uint8Array(rowCount)
      let kept = 0
      for (const row of stored.rows) {
        if (row >= 0 && row < rowCount) {
          rows[row] = 1
          kept += 1
        }
      }
      if (kept === 0) dropped.push(stored.source)
      else clauses.set(stored.source, { kind: 'rows', rows })
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

  return { clauses, camera: file.camera, effect: file.effect, dropped }
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
  if (version < WORKSPACE_FORMAT_VERSION) {
    return fail(`읽을 수 없는 옛 형식이다(버전 ${version}).`)
  }

  const rowCount = value['rowCount']
  if (typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 0) {
    return fail('행 수가 없다.')
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

  return {
    ok: true,
    file: {
      version,
      savedAt: typeof savedAt === 'string' ? savedAt : new Date(0).toISOString(),
      rowCount,
      clauses,
      camera,
      effect: typeof effect === 'string' ? effect : 'normal',
    },
  }
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
