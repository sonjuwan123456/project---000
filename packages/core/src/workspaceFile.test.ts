import { describe, expect, it } from 'vitest'
import type { SelectionClause, SelectionClauses } from './selection'
import {
  WORKSPACE_FORMAT_VERSION,
  fromWorkspaceFile,
  parseWorkspaceFile,
  toWorkspaceFile,
} from './workspaceFile'

const ROWS = 8
const savedAt = new Date('2026-09-19T02:30:00.000Z')

const lasso = (...rows: number[]): SelectionClause => {
  const mask = new Uint8Array(ROWS)
  for (const row of rows) mask[row] = 1
  return { kind: 'rows', rows: mask }
}

const snapshot = (clauses: SelectionClauses, rowCount = ROWS) => ({
  clauses,
  rowCount,
  camera: { position: [1, 2, 3] as const, target: [0, 0, 0] as const },
  effect: 'normal',
})

const clausesOf = (...entries: [string, SelectionClause][]): SelectionClauses => new Map(entries)

describe('toWorkspaceFile', () => {
  it('비트 배열이 아니라 행 번호로 저장한다', () => {
    const file = toWorkspaceFile(snapshot(clausesOf(['points', lasso(1, 5)])), savedAt)

    expect(file.version).toBe(WORKSPACE_FORMAT_VERSION)
    expect(file.savedAt).toBe('2026-09-19T02:30:00.000Z')
    expect(file.clauses).toEqual([{ source: 'points', kind: 'rows', rows: [1, 5] }])
  })

  it('되살릴 수 있는 조건은 그대로 적는다', () => {
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['bars', { kind: 'category', column: 'category', values: [2] }],
          ['hist', { kind: 'range', column: 'sentiment', min: -0.5, max: 0.25 }],
        ),
      ),
      savedAt,
    )

    expect(file.clauses).toEqual([
      { source: 'bars', kind: 'category', column: 'category', values: [2] },
      { source: 'hist', kind: 'range', column: 'sentiment', min: -0.5, max: 0.25 },
    ])
  })
})

describe('fromWorkspaceFile', () => {
  it('같은 표에서는 고정 선택까지 되살린다', () => {
    const file = toWorkspaceFile(snapshot(clausesOf(['points', lasso(0, 7)])), savedAt)
    const restored = fromWorkspaceFile(file, ROWS)

    const clause = restored.clauses.get('points')
    expect(clause?.kind).toBe('rows')
    expect(clause?.kind === 'rows' ? Array.from(clause.rows) : []).toEqual([1, 0, 0, 0, 0, 0, 0, 1])
    expect(restored.dropped).toEqual([])
    expect(restored.camera).toEqual({ position: [1, 2, 3], target: [0, 0, 0] })
  })

  it('행 수가 다르면 고정 선택만 버리고 나머지는 되살린다', () => {
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['points', lasso(1, 2)],
          ['bars', { kind: 'category', column: 'category', values: [0, 3] }],
        ),
      ),
      savedAt,
    )
    const restored = fromWorkspaceFile(file, ROWS + 4)

    expect(restored.dropped).toEqual(['points'])
    expect(restored.clauses.has('points')).toBe(false)
    expect(restored.clauses.get('bars')).toEqual({
      kind: 'category',
      column: 'category',
      values: [0, 3],
    })
  })

  it('행 번호가 표 밖으로 나가면 그 조건을 버린다', () => {
    const parsed = parseWorkspaceFile({
      version: WORKSPACE_FORMAT_VERSION,
      rowCount: ROWS,
      clauses: [{ source: 'points', kind: 'rows', rows: [99] }],
      camera: null,
      effect: 'normal',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const restored = fromWorkspaceFile(parsed.file, ROWS)
    expect(restored.dropped).toEqual(['points'])
    expect(restored.clauses.size).toBe(0)
  })
})

describe('parseWorkspaceFile', () => {
  it('내보낸 파일을 그대로 다시 읽는다', () => {
    const file = toWorkspaceFile(snapshot(clausesOf(['points', lasso(3)])), savedAt)
    const parsed = parseWorkspaceFile(JSON.parse(JSON.stringify(file)))

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.file).toEqual(file)
  })

  it('작업 공간 파일이 아니면 거절한다', () => {
    for (const value of [null, 42, 'workspace', [], {}, { version: '1' }]) {
      expect(parseWorkspaceFile(value).ok).toBe(false)
    }
  })

  it('더 새로운 형식은 이유를 말하고 거절한다', () => {
    const parsed = parseWorkspaceFile({
      version: WORKSPACE_FORMAT_VERSION + 1,
      rowCount: 1,
      clauses: [],
    })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('새로운 형식')
  })

  it('망가진 조건이 섞이면 통째로 거절한다', () => {
    const broken = [
      { source: 'points', kind: 'rows', rows: [1, -2] },
      { source: 'points', kind: 'rows', rows: ['1'] },
      { source: '', kind: 'rows', rows: [1] },
      { source: 'hist', kind: 'range', column: 'sentiment', min: 1, max: 0 },
      { source: 'hist', kind: 'range', column: 'sentiment', min: 0, max: Number.NaN },
      { source: 'bars', kind: 'category', column: 'category', values: [null] },
      { source: 'bars', kind: 'nope' },
    ]
    for (const clause of broken) {
      const parsed = parseWorkspaceFile({
        version: WORKSPACE_FORMAT_VERSION,
        rowCount: ROWS,
        clauses: [clause],
      })
      expect(parsed.ok, JSON.stringify(clause)).toBe(false)
    }
  })

  it('카메라는 없어도 되지만 망가져 있으면 거절한다', () => {
    const base = { version: WORKSPACE_FORMAT_VERSION, rowCount: ROWS, clauses: [] }

    expect(parseWorkspaceFile({ ...base }).ok).toBe(true)
    expect(parseWorkspaceFile({ ...base, camera: null }).ok).toBe(true)
    expect(
      parseWorkspaceFile({ ...base, camera: { position: [1, 2], target: [0, 0, 0] } }).ok,
    ).toBe(false)
    expect(parseWorkspaceFile({ ...base, camera: { position: [1, 2, 3] } }).ok).toBe(false)
  })
})
