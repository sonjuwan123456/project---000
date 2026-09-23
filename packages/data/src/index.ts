/**
 * 연결층·데이터층. 로더 레지스트리, Arrow 데이터층, 계산 워커.
 *
 * M1에서 표 데이터 자산을 불러오는 길이 들어왔고, M2에서 임베딩을 주성분 셋으로
 * 줄이는 계산이 워커로 들어갔다.
 */
export const PACKAGE_NAME = '@holo/data'

export { SAMPLE_CATEGORIES, createSampleTable, sampleCsv, type SampleTable } from './sampleTable'

export { DEFAULT_INFERENCE, isBlank, parseDatetime, parseNumber, profileColumn } from './columnType'
export type { ColumnProfile, InferenceOptions, ScalarColumnKind } from './columnType'

export { detectDelimiter, parseDelimitedText } from './delimitedText'
export type { DelimitedTable } from './delimitedText'

export { detectStringVector } from './stringVectorGuard'
export type { StringVectorFinding, StringVectorFlavor } from './stringVectorGuard'

export { groupWideVectorColumns, vectorFromLists, vectorFromWideColumns } from './vectorColumn'
export type { VectorColumn, WideVectorGroup } from './vectorColumn'

export { assetIdOfFile, assetIdOfShape, fingerprint } from './assetId'
export type { FileIdentity } from './assetId'

export { FORMATS, extensionOf, plannedMessage, resolveFormat, supportedLabels } from './formats'
export type { AssetKind, FormatEntry } from './formats'

export { kindOfFile, readAssetFile } from './loaderRegistry'
export type { Asset, ReadableAsset } from './loaderRegistry'

export { PreferTextError, UnsupportedFileError } from './unsupported'

export {
  TEXT_BYTE_LIMIT,
  buildText,
  countByLevel,
  levelAt,
  levelsOfLines,
  readTextFile,
  splitLines,
} from './readTextFile'
export type { LoadedText, ReadableTextFile } from './readTextFile'

export {
  LOG_LEVELS,
  LOG_LEVEL_LABELS,
  extensionsOfFlavor,
  flavorOf,
  flavorOfExtension,
  hasLogTimestamp,
  looksLikeLog,
  looksLikeMarkdown,
  parseLogLevel,
} from './textFlavor'
export type { LogLevel, TextFlavor } from './textFlavor'

export {
  ENCODING_LABELS,
  SELECTABLE_ENCODINGS,
  decodeText,
  readBom,
  trimToUtf8Boundary,
} from './encoding'
export type { DecodedText, DetectedEncoding } from './encoding'

export { noticesOfModel, readModelFile } from './readModelFile'
export type { LoadedModel, ReadableBinaryFile } from './readModelFile'

export { looksLikeGlb, readGlb, readGltfJson, summarizeGltf } from './gltf'
export type { GltfDocument, GltfFormat, GltfSummary } from './gltf'

export {
  loadJson,
  loadJsonLines,
  loadRecords,
  prefersTextPanel,
  readTableFile,
} from './readTableFile'
export type { ReadableFile } from './readTableFile'

export { DEFAULT_PCA, pcaTo3D } from './pca'
export type { PcaOptions, PcaResult } from './pca'

export { PHASE_LABELS, progressOf, throttleProgress } from './progress'
export type { LoadPhase, LoadProgress, ProgressReporter } from './progress'

export {
  MAX_BUNDLE_FILES,
  bundleBytes,
  bundleOf,
  findInBundle,
  normalizePath,
  pickPrimary,
  resolveResources,
} from './fileBundle'
export type { BundleFile, FileBundle } from './fileBundle'
export {
  MAX_UNPACKED_BYTES,
  checkFileSize,
  checkUnpackedSize,
  formatBytes,
  kindOfName,
  limitsOf,
  sizeNotices,
} from './sizeGuard'
export type { SizeVerdict } from './sizeGuard'

export { entriesOfZip, looksLikeZip } from './readZip'
export type { ReadableZip } from './readZip'

export { canUseWorker } from './workerSupport'

export { startPca } from './pcaClient'
export type { PcaJob } from './pcaClient'

export { startUmap } from './umapClient'
export type { UmapJob } from './umapClient'

export { DEFAULT_UMAP, umapTo3D } from './umap'
export type { UmapOptions, UmapResult } from './umap'

export { startTableRead } from './tableClient'
export type { TableJob } from './tableClient'

export type { TableRequest, TableResponse, TableResult } from './tableWorker'

export type { PcaRequest, PcaRequestOptions, PcaResponse, PcaWorkerResult } from './pcaWorker'
export type { UmapRequest, UmapRequestOptions, UmapResponse, UmapWorkerResult } from './umapWorker'

export { toViewModel, vectorToReduce } from './viewModel'
export type {
  Reduced,
  CategoryRole,
  CellKind,
  MeasureRole,
  Positions,
  ViewColumn,
  ViewModel,
  ViewModelOptions,
} from './viewModel'

export { anchorsOf } from './clusterAnchors'
export type { ClusterAnchor } from './clusterAnchors'

export { attachLookup, buildTable, loadDelimitedText } from './loadTable'
export type {
  BuildOptions,
  LoadDelimitedOptions,
  LoadNotice,
  LoadedCategoryColumn,
  LoadedColumn,
  LoadedDatetimeColumn,
  LoadedNumberColumn,
  LoadedTable,
  LoadedTableData,
  LoadedTextColumn,
} from './loadTable'
