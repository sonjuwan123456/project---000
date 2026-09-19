/**
 * 시각화층. 뷰 레지스트리와 뷰 구현.
 *
 * 뷰는 서로를 모른다. 선택은 조건으로만 발행하고 합치는 일은 코디네이터가 한다.
 * 3D 모델 뷰와 텍스트 패널은 M2, 뷰 레지스트리는 작업 공간을 붙이는 M4에서 채운다.
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
