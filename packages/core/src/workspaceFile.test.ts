import { describe, expect, it } from 'vitest'
import type { SelectionClause, SelectionClauses } from './selection'
import {
  WORKSPACE_FORMAT_VERSION,
  fromWorkspaceFile,
  parseWorkspaceFile,
  toWorkspaceFile,
  type RestoreTarget,
} from './workspaceFile'

const ROWS = 8
const savedAt = new Date('2026-09-19T02:30:00.000Z')

const lasso = (...rows: number[]): SelectionClause => {
  const mask = new Uint8Array(ROWS)
  for (const row of rows) mask[row] = 1
  return { kind: 'rows', rows: mask }
}

const snapshot = (clauses: SelectionClauses, rowCount = ROWS, assetId: string | null = null) => ({
  clauses,
  rowCount,
  assetId,
  camera: { position: [1, 2, 3] as const, target: [0, 0, 0] as const },
  effect: 'normal',
})

const clausesOf = (...entries: [string, SelectionClause][]): SelectionClauses => new Map(entries)

/** 되살릴 대상. `columns`를 주지 않으면 어느 컬럼이든 있는 것으로 본다. */
const target = (
  rowCount = ROWS,
  assetId: string | null = null,
  columns: readonly string[] | null = null,
): RestoreTarget => ({
  rowCount,
  assetId,
  hasColumn: (column) => columns === null || columns.includes(column),
})

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

  it('자산 id를 같이 적고, 없으면 null로 둔다', () => {
    const withAsset = toWorkspaceFile(snapshot(clausesOf(), ROWS, 'file-1a2b3c4d'), savedAt)
    const without = toWorkspaceFile(snapshot(clausesOf()), savedAt)

    expect(withAsset.assetId).toBe('file-1a2b3c4d')
    expect(without.assetId).toBeNull()
  })
})

describe('fromWorkspaceFile', () => {
  it('같은 표에서는 고정 선택까지 되살린다', () => {
    const file = toWorkspaceFile(snapshot(clausesOf(['points', lasso(0, 7)])), savedAt)
    const restored = fromWorkspaceFile(file, target())

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
    const restored = fromWorkspaceFile(file, target(ROWS + 4))

    expect(restored.dropped).toEqual([{ source: 'points', reason: 'different-table' }])
    expect(restored.clauses.has('points')).toBe(false)
    expect(restored.clauses.get('bars')).toEqual({
      kind: 'category',
      column: 'category',
      values: [0, 3],
    })
  })

  it('자산 id가 다르면 행 수가 같아도 고정 선택을 버린다', () => {
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['points', lasso(1, 2)],
          ['bars', { kind: 'category', column: 'category', values: [0] }],
        ),
        ROWS,
        'file-1a2b3c4d',
      ),
      savedAt,
    )
    // 행이 같은 수인 다른 파일. 행 수만 보던 때는 남의 행 번호가 그대로 얹혔다.
    const restored = fromWorkspaceFile(file, target(ROWS, 'file-99887766'))

    expect(restored.dropped).toEqual([{ source: 'points', reason: 'different-table' }])
    expect(restored.clauses.has('points')).toBe(false)
    expect(restored.clauses.has('bars')).toBe(true)
  })

  it('자산 id가 같으면 고정 선택까지 되살린다', () => {
    const file = toWorkspaceFile(
      snapshot(clausesOf(['points', lasso(4)]), ROWS, 'file-1a2b3c4d'),
      savedAt,
    )
    const restored = fromWorkspaceFile(file, target(ROWS, 'file-1a2b3c4d'))

    expect(restored.dropped).toEqual([])
    expect(restored.clauses.has('points')).toBe(true)
  })

  it('한쪽이라도 자산 id를 모르면 행 수로 판단한다', () => {
    const unknown = toWorkspaceFile(snapshot(clausesOf(['points', lasso(4)])), savedAt)
    const known = toWorkspaceFile(
      snapshot(clausesOf(['points', lasso(4)]), ROWS, 'file-1a2b3c4d'),
      savedAt,
    )

    const gone = [{ source: 'points', reason: 'different-table' }]
    // 버전 1에서 온 파일. 지금 표의 자산 id를 알아도 견줄 것이 없다.
    expect(fromWorkspaceFile(unknown, target(ROWS, 'file-1a2b3c4d')).dropped).toEqual([])
    expect(fromWorkspaceFile(unknown, target(ROWS + 4, 'file-1a2b3c4d')).dropped).toEqual(gone)
    // 자산 개념이 없는 표. 파일 쪽만 알아도 마찬가지다.
    expect(fromWorkspaceFile(known, target()).dropped).toEqual([])
    expect(fromWorkspaceFile(known, target(ROWS + 4)).dropped).toEqual(gone)
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

    const restored = fromWorkspaceFile(parsed.file, target())
    expect(restored.dropped).toEqual([{ source: 'points', reason: 'different-table' }])
    expect(restored.clauses.size).toBe(0)
  })

  it('조건이 가리키는 컬럼이 지금 표에 없으면 그 조건을 버린다', () => {
    // 같은 파일이어도 불러오기가 바뀌면 범주이던 컬럼이 글이 되어 조회에서 빠진다.
    // 버리지 않고 두면 아무 행도 거르지 않는 조건이 되살아나, 저장한 것보다 넓게 뽑힌다.
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['bars', { kind: 'category', column: '주문번호', values: [0, 3] }],
          ['hist', { kind: 'range', column: 'sentiment', min: -0.5, max: 0.25 }],
        ),
        ROWS,
        'file-1a2b3c4d',
      ),
      savedAt,
    )

    const restored = fromWorkspaceFile(file, target(ROWS, 'file-1a2b3c4d', ['sentiment']))

    expect(restored.dropped).toEqual([{ source: 'bars', reason: 'missing-column' }])
    expect(restored.clauses.has('bars')).toBe(false)
    expect(restored.clauses.has('hist')).toBe(true)
  })

  it('자산 id가 같아도 컬럼이 사라진 것은 막지 못한다', () => {
    // 자산 id는 이름·크기·수정시각이라 불러오기가 바뀌어도 그대로다. "같은 파일"은
    // 통과하는데 컬럼 종류만 달라져 있는 자리가 이것이고, 그래서 검사가 둘 다 필요하다.
    const file = toWorkspaceFile(
      snapshot(clausesOf(['bars', { kind: 'category', column: '주문번호', values: [1] }])),
      savedAt,
    )

    const kept = fromWorkspaceFile(file, target(ROWS, null, ['주문번호']))
    const lost = fromWorkspaceFile(file, target(ROWS, null, []))

    expect(kept.dropped).toEqual([])
    expect(lost.dropped).toEqual([{ source: 'bars', reason: 'missing-column' }])
  })

  it('다른 표에서는 컬럼이 없다고 버리지 않는다', () => {
    // 화면은 파일을 열기 전에 샘플 표 위에서 저장된 작업 공간을 먼저 되살린다. 그때
    // 샘플에 없는 컬럼이라고 버리면, 사용자가 자기 파일을 열기도 전에 조건이 사라진다.
    // 버리는 것은 되돌릴 수 없으니, 판단할 수 없을 때는 그냥 둔다.
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['points', lasso(1, 2)],
          ['bars', { kind: 'category', column: '주문번호', values: [0] }],
        ),
      ),
      savedAt,
    )

    const restored = fromWorkspaceFile(file, target(ROWS + 4, null, []))

    // 고정 선택은 표가 다르니 버린다. 조건은 판단하지 않고 남긴다.
    expect(restored.dropped).toEqual([{ source: 'points', reason: 'different-table' }])
    expect(restored.clauses.has('bars')).toBe(true)
  })

  it('까닭이 섞이면 둘 다 담는다', () => {
    // 같은 표인데 고정 선택의 행 번호가 다 표 밖으로 나가고, 조건 하나는 컬럼이 없다.
    const file = toWorkspaceFile(
      snapshot(
        clausesOf(
          ['points', lasso(5, 6)],
          ['bars', { kind: 'category', column: '주문번호', values: [0] }],
          ['hist', { kind: 'range', column: 'sentiment', min: 0, max: 1 }],
        ),
        2,
      ),
      savedAt,
    )

    const restored = fromWorkspaceFile(file, target(2, null, ['sentiment']))

    expect(restored.dropped).toEqual([
      { source: 'points', reason: 'different-table' },
      { source: 'bars', reason: 'missing-column' },
    ])
    expect(restored.clauses.has('hist')).toBe(true)
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

  it('자산 id가 없던 버전 1 파일도 읽는다', () => {
    const parsed = parseWorkspaceFile({
      version: 1,
      rowCount: ROWS,
      clauses: [{ source: 'points', kind: 'rows', rows: [2] }],
      camera: null,
      effect: 'normal',
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.file.assetId).toBeNull()
  })

  it('자산 id가 문자열이 아니면 거절한다', () => {
    const base = { version: WORKSPACE_FORMAT_VERSION, rowCount: ROWS, clauses: [] }

    expect(parseWorkspaceFile({ ...base, assetId: null }).ok).toBe(true)
    expect(parseWorkspaceFile({ ...base, assetId: 'file-1a2b3c4d' }).ok).toBe(true)
    expect(parseWorkspaceFile({ ...base, assetId: 12345 }).ok).toBe(false)
    expect(parseWorkspaceFile({ ...base, assetId: ['file-1a2b3c4d'] }).ok).toBe(false)
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
