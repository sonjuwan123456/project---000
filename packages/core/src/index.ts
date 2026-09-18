export { clamp, damp, lerp } from './math'
export { applyCommand, canUndo, createWorkspaceState } from './commands'
export type { Command, HistoryEntry, LogEntry, WorkspaceState } from './commands'
export { createLiveStore } from './live'
export type { LiveStore } from './live'
export { categoryColors, categoryPalette, cssVariables, hexToRgb01, holoColors } from './palette'
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
