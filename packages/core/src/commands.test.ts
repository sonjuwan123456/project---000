import { describe, expect, it } from 'vitest'
import { EMPTY_DOC, applyCommand, canUndo, createWorkspaceState, type Command } from './commands'
import type { SelectionClause, SelectionClauses } from './selection'

const pick = (values: number[]): SelectionClause => ({
  kind: 'category',
  column: 'category',
  values,
})

const select = (label: string, clause: SelectionClause): Command => ({
  kind: 'select',
  label,
  next: (clauses) => new Map(clauses).set('bars', clause),
})

const values = (clauses: SelectionClauses): readonly number[] => {
  const clause = clauses.get('bars')
  return clause?.kind === 'category' ? clause.values : []
}

describe('applyCommand', () => {
  it('선택을 바꾸고 기록을 남긴다', () => {
    const state = applyCommand(
      createWorkspaceState('작업 공간 열기', 1),
      select('배송', pick([0])),
      2,
    )

    expect(values(state.clauses)).toEqual([0])
    expect(state.log.map((entry) => entry.label)).toEqual(['배송', '작업 공간 열기'])
    expect(state.log[0]?.at).toBe(2)
  })

  it('선택을 바꾸지 않는 명령은 기록만 남긴다', () => {
    const before = applyCommand(createWorkspaceState('열기', 1), select('배송', pick([0])), 2)
    const after = applyCommand(before, { kind: 'note', label: '효과 강도 · 가볍게' }, 3)

    expect(after.clauses).toBe(before.clauses)
    expect(after.history).toBe(before.history)
    expect(after.log[0]?.label).toBe('효과 강도 · 가볍게')
  })

  it('되돌리기는 직전 선택으로 돌아가고 무엇을 되돌렸는지 남긴다', () => {
    let state = createWorkspaceState('열기', 1)
    expect(canUndo(state)).toBe(false)

    state = applyCommand(state, select('배송', pick([0])), 2)
    state = applyCommand(state, select('결제', pick([1])), 3)
    expect(canUndo(state)).toBe(true)

    state = applyCommand(state, { kind: 'undo' }, 4)
    expect(values(state.clauses)).toEqual([0])
    expect(state.log[0]?.label).toBe('되돌리기 · 결제')

    state = applyCommand(state, { kind: 'undo' }, 5)
    expect(state.clauses.size).toBe(0)
    expect(canUndo(state)).toBe(false)
  })

  it('되돌릴 것이 없으면 상태를 그대로 둔다', () => {
    const state = createWorkspaceState('열기', 1)
    expect(applyCommand(state, { kind: 'undo' }, 2)).toBe(state)
  })

  it('기록과 되돌리기 칸은 한없이 늘지 않는다', () => {
    let state = createWorkspaceState('열기', 0)
    for (let turn = 1; turn <= 60; turn += 1) {
      state = applyCommand(state, select(`선택 ${turn}`, pick([turn % 6])), turn)
    }

    expect(state.log).toHaveLength(30)
    expect(state.log[0]?.label).toBe('선택 60')
    expect(state.history).toHaveLength(40)
    // 가장 오래된 칸이 아니라 가장 최근 40칸이 남아야 한다.
    expect(state.history[39]?.label).toBe('선택 60')
  })

  it('효과·배치·북마크를 바꾼 것도 한 칸씩 되돌아간다', () => {
    let state = createWorkspaceState('열기', 1)
    state = applyCommand(state, select('배송', pick([0])), 2)
    state = applyCommand(
      state,
      {
        kind: 'edit',
        label: '효과 강도 · 가볍게',
        next: (doc) => ({ ...doc, effect: 'performance' }),
      },
      3,
    )
    state = applyCommand(
      state,
      {
        kind: 'edit',
        label: '패널 크기',
        next: (doc) => ({ ...doc, layout: { side: 420, bottom: 0.3 } }),
      },
      4,
    )

    expect(state.effect).toBe('performance')
    expect(state.layout).toEqual({ side: 420, bottom: 0.3 })

    state = applyCommand(state, { kind: 'undo' }, 5)
    expect(state.layout).toEqual(EMPTY_DOC.layout)
    // 되돌리기 한 번은 한 칸만 되돌린다. 효과 강도는 아직 그대로다.
    expect(state.effect).toBe('performance')
    expect(values(state.clauses)).toEqual([0])

    state = applyCommand(state, { kind: 'undo' }, 6)
    expect(state.effect).toBe('normal')
    expect(values(state.clauses)).toEqual([0])
  })

  it('선택을 바꾸는 명령은 효과·배치·북마크를 건드리지 않는다', () => {
    let state = createWorkspaceState('열기', 1)
    state = applyCommand(
      state,
      { kind: 'edit', label: '효과', next: (doc) => ({ ...doc, effect: 'high' }) },
      2,
    )
    state = applyCommand(state, select('배송', pick([0])), 3)
    expect(state.effect).toBe('high')
    state = applyCommand(state, { kind: 'undo' }, 4)
    expect(state.effect).toBe('high')
    expect(state.clauses.size).toBe(0)
  })
})
