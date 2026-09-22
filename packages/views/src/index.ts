/**
 * 시각화층. 뷰 레지스트리와 뷰 구현.
 *
 * 뷰는 서로를 모른다. 선택은 조건으로만 발행하고 합치는 일은 코디네이터가 한다.
 * 3D 모델 뷰가 M2에서 들어왔다. 뷰 레지스트리는 작업 공간을 붙이는 M5에서 채운다.
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
