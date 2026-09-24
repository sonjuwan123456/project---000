/**
 * 시각화층. 뷰 레지스트리와 뷰 구현.
 *
 * 뷰는 서로를 모른다. 선택은 조건으로만 발행하고 합치는 일은 코디네이터가 한다.
 * 3D 모델 뷰가 M2에서, 뷰 레지스트리와 패널 표면이 M5에서 들어왔다.
 */
export const PACKAGE_NAME = '@holo/views'

export { PointCloudView } from './PointCloudView'
export type { PointCloudViewProps } from './PointCloudView'
export { TableView } from './TableView'
export type { TableViewProps } from './TableView'
export { DistributionView } from './DistributionView'
export type { DistributionViewProps } from './DistributionView'
export { CommandPalette } from './CommandPalette'
export type { CommandPaletteProps, PaletteCommand } from './CommandPalette'
export { FileDropZone } from './FileDropZone'
export type { FileDropZoneProps } from './FileDropZone'
export { ClusterLabels } from './ClusterLabels'
export type { ClusterLabelsProps } from './ClusterLabels'
export { VIEW_REGISTRY, arrangeViews, viewEntry, viewsFor } from './viewRegistry'
export type {
  Arrangement,
  AssetShape,
  SelectionReaction,
  ViewArea,
  ViewAssetKind,
  ViewEntry,
  ViewKind,
  ViewSurface,
} from './viewRegistry'
export { createPanelSurface, detectSurfaceSupport, surfaceKindFor } from './panelSurface'
export type {
  PanelSurface,
  SurfaceKind,
  SurfaceNode,
  SurfacePlacement,
  SurfacePoint,
  SurfaceSupport,
} from './panelSurface'
export { Splitter } from './Splitter'
export type { SplitterProps } from './Splitter'
export { BookmarkList } from './BookmarkList'
export type { BookmarkListProps } from './BookmarkList'
export { ActivityLog } from './ActivityLog'
export type { ActivityLogProps } from './ActivityLog'
export { TextPanel } from './TextPanel'
export type { TextPanelProps } from './TextPanel'
export { parseInline, parseMarkdown, safeHref } from './markdown'
export type { MarkdownBlock, MarkdownSpan } from './markdown'
export { ProgressBar } from './ProgressBar'
export type { ProgressBarProps } from './ProgressBar'
export { ModelView, fitToStage } from './ModelView'
export type { ModelDisplayMode, ModelViewProps } from './ModelView'
export { MAX_DROPPED_FILES, collectDropped, entriesOfPicked } from './fileEntries'
export type { DroppedEntry, DroppedFiles } from './fileEntries'
export {
  THUMBNAIL_CAMERA,
  THUMBNAIL_SIZE,
  frameBox,
  hasThumbnail,
  thumbnailOf,
  useThumbnail,
} from './thumbnail'

export { disposeScene, parseGltf } from './gltfParse'
export { parseModel } from './modelParse'
export type { ParsedModel } from './modelParse'
export { HIGHLIGHT_LINE_LIMIT, canHighlight, highlightLines, styleOf } from './highlight'
export type { CodeToken } from './highlight'
