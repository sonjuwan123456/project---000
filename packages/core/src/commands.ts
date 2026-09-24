/**
 * 명령 — 작업 공간을 바꾸는 유일한 경로.
 *
 * 설계 문서 2장의 개념 모델에서 "명령"은 자산·선택·뷰 명세를 바꾸는 모든 동작이다.
 * 선택을 여기서만 바꾸기로 하면 되돌리기와 활동 기록을 뷰마다 따로 만들 필요가 없다.
 * 뷰는 명령을 부르기만 하고 자기 상태를 직접 고치지 않는다.
 *
 * 되돌리기가 덮는 것은 선택만이 아니다. M5 완료 기준이 "모든 조작 `Ctrl+Z` 가능"이라,
 * 효과 강도·패널 배치·카메라 북마크도 같은 문서(`WorkspaceDoc`)에 들어 있고 한 칸씩
 * 함께 되돌아간다. 카메라를 끌어 돌리는 것은 넣지 않았다. 보는 자리를 옮기는 것이지
 * 작업 공간을 고치는 것이 아니고, 넣으면 되돌리기 칸이 손으로 한 번 돌릴 때마다 찬다.
 *
 * 화면에 쓸 문장은 명령을 부르는 쪽이 만들어 넘긴다. 여기서 만들면 상태층이
 * 표시 문구를 알게 되고, 말투를 바꿀 때 이 파일을 고쳐야 한다.
 */
import type { CameraBookmark } from './bookmarks'
import { DEFAULT_LAYOUT, type PanelLayout } from './layout'
import type { SelectionClauses } from './selection'

/** 활동 기록 한 줄. 시각은 epoch 밀리초로 담고 사람이 읽을 형식은 뷰가 만든다. */
export type LogEntry = {
  readonly at: number
  readonly label: string
}

/** 되돌리기가 한꺼번에 되돌리는 것들. 저장·내보내기되는 것과 같다. */
export type WorkspaceDoc = {
  readonly clauses: SelectionClauses
  /** 효과 강도. 값의 종류는 `@holo/holo-fx`가 쥐고, 여기서는 이름으로만 든다. */
  readonly effect: string
  readonly layout: PanelLayout
  readonly bookmarks: readonly CameraBookmark[]
}

/** 되돌리기 한 칸. label은 이 상태를 밀어낸 명령의 이름이다. */
export type HistoryEntry = {
  readonly doc: WorkspaceDoc
  readonly label: string
}

export type WorkspaceState = WorkspaceDoc & {
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
  /** 선택 말고 다른 것(효과 강도, 배치, 북마크)까지 바꾼다. 역시 되돌리기 칸에 쌓인다. */
  | {
      readonly kind: 'edit'
      readonly label: string
      readonly next: (doc: WorkspaceDoc) => WorkspaceDoc
    }
  /** 작업 공간을 바꾸지 않는 동작(자산 열기, 올가미 켜기)을 기록에만 남긴다. */
  | { readonly kind: 'note'; readonly label: string }
  | { readonly kind: 'undo' }

/** 되돌리기 칸 수. 이만큼 넘으면 오래된 것부터 버린다. */
const HISTORY_LIMIT = 40
/** 활동 기록 줄 수. 화면에 보이는 것보다 넉넉하게 둔다. */
const LOG_LIMIT = 30

/** 아무것도 고르지 않고 아무것도 바꾸지 않은 문서. "비우기"가 돌아가는 자리다. */
export const EMPTY_DOC: WorkspaceDoc = {
  clauses: new Map(),
  effect: 'normal',
  layout: DEFAULT_LAYOUT,
  bookmarks: [],
}

export function createWorkspaceState(label: string, now: number = Date.now()): WorkspaceState {
  return { ...EMPTY_DOC, history: [], log: [{ at: now, label }] }
}

/** 상태에서 되돌리기가 다루는 부분만 떼어 낸다. */
export function docOf(state: WorkspaceDoc): WorkspaceDoc {
  return {
    clauses: state.clauses,
    effect: state.effect,
    layout: state.layout,
    bookmarks: state.bookmarks,
  }
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
      ...previous.doc,
      history: state.history.slice(0, -1),
      log: withLog(state.log, { at: now, label: `되돌리기 · ${previous.label}` }),
    }
  }

  const before = docOf(state)
  const after =
    command.kind === 'select'
      ? { ...before, clauses: command.next(state.clauses) }
      : docOf(command.next(before))
  return {
    ...after,
    history: [...state.history, { doc: before, label: command.label }].slice(-HISTORY_LIMIT),
    log: withLog(state.log, { at: now, label: command.label }),
  }
}

function withLog(log: readonly LogEntry[], entry: LogEntry): readonly LogEntry[] {
  return [entry, ...log].slice(0, LOG_LIMIT)
}
