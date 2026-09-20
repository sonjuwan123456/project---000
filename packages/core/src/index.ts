export { clamp, damp, lerp } from './math'
export type { CameraDrive } from './camera'
export { applyCommand, canUndo, createWorkspaceState } from './commands'
export type { Command, HistoryEntry, LogEntry, WorkspaceState } from './commands'
export { createLiveStore } from './live'
export type { LiveStore } from './live'
export {
  MAX_COLORED_CATEGORIES,
  OVERFLOW_CATEGORY,
  categoryColors,
  categoryPalette,
  cssVariables,
  hexToRgb01,
  holoColors,
} from './palette'
export type { HoloColorName } from './palette'
export { composeSelection, maskToRowIndices } from './selection'
export type {
  ColumnLookup,
  ComposeOptions,
  ComposedSelection,
  NumericColumn,
  RowMask,
  SelectionClause,
  SelectionClauses,
  SelectionSource,
} from './selection'
export { layoutLabels } from './labelLayout'
export type { LabelBox, LabelLayoutOptions, PlacedLabel } from './labelLayout'

export {
  WORKSPACE_FORMAT_VERSION,
  fromWorkspaceFile,
  parseWorkspaceFile,
  toWorkspaceFile,
} from './workspaceFile'
export type {
  DropReason,
  DroppedClause,
  ParseResult,
  RestoreTarget,
  RestoredWorkspace,
  StoredCamera,
  StoredClause,
  WorkspaceFile,
  WorkspaceSnapshot,
} from './workspaceFile'
