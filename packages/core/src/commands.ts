/**
 * 명령 — 선택을 바꾸는 유일한 경로.
 *
 * 설계 문서 2장의 개념 모델에서 "명령"은 자산·선택·뷰 명세를 바꾸는 모든 동작이다.
 * 선택을 여기서만 바꾸기로 하면 되돌리기와 활동 기록을 뷰마다 따로 만들 필요가 없다.
 * 뷰는 명령을 부르기만 하고 자기 상태를 직접 고치지 않는다.
 *
 * 화면에 쓸 문장은 명령을 부르는 쪽이 만들어 넘긴다. 여기서 만들면 상태층이
 * 표시 문구를 알게 되고, 말투를 바꿀 때 이 파일을 고쳐야 한다.
 */
import type { SelectionClauses } from './selection'

/** 활동 기록 한 줄. 시각은 epoch 밀리초로 담고 사람이 읽을 형식은 뷰가 만든다. */
export type LogEntry = {
  readonly at: number
  readonly label: string
}

/** 되돌리기 한 칸. label은 이 선택을 밀어낸 명령의 이름이다. */
export type HistoryEntry = {
  readonly clauses: SelectionClauses
  readonly label: string
}

export type WorkspaceState = {
  readonly clauses: SelectionClauses
  /** 오래된 것이 앞. */
  readonly history: readonly HistoryEntry[]
  /** 최근 기록이 앞. */
  readonly log: readonly LogEntry[]
}

export type Command =
  /** 선택을 바꾼다. 바뀌기 전 선택이 되돌리기 스택에 쌓인다. */
  | {
      readonly kind: 'select'
      readonly label: string
      readonly next: (clauses: SelectionClauses) => SelectionClauses
    }
  /** 선택을 바꾸지 않는 동작(효과 강도, 카메라 초기화)을 기록에만 남긴다. */
  | { readonly kind: 'note'; readonly label: string }
  | { readonly kind: 'undo' }

/** 되돌리기 칸 수. 이만큼 넘으면 오래된 것부터 버린다. */
const HISTORY_LIMIT = 40
/** 활동 기록 줄 수. 화면에 보이는 것보다 넉넉하게 둔다. */
const LOG_LIMIT = 30

export function createWorkspaceState(label: string, now: number = Date.now()): WorkspaceState {
  return { clauses: new Map(), history: [], log: [{ at: now, label }] }
}

/** 되돌릴 것이 있는지. 팔레트가 항목을 흐리게 만들 때 쓴다. */
export function canUndo(state: WorkspaceState): boolean {
  return state.history.length > 0
}

export function applyCommand(
  state: WorkspaceState,
  command: Command,
  now: number = Date.now(),
): WorkspaceState {
  if (command.kind === 'note') {
    return { ...state, log: withLog(state.log, { at: now, label: command.label }) }
  }

  if (command.kind === 'undo') {
    const previous = state.history[state.history.length - 1]
    if (previous === undefined) return state
    return {
      clauses: previous.clauses,
      history: state.history.slice(0, -1),
      log: withLog(state.log, { at: now, label: `되돌리기 · ${previous.label}` }),
    }
  }

  return {
    clauses: command.next(state.clauses),
    history: [...state.history, { clauses: state.clauses, label: command.label }].slice(
      -HISTORY_LIMIT,
    ),
    log: withLog(state.log, { at: now, label: command.label }),
  }
}

function withLog(log: readonly LogEntry[], entry: LogEntry): readonly LogEntry[] {
  return [entry, ...log].slice(0, LOG_LIMIT)
}
