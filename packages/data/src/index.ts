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

export {
  UnsupportedFileError,
  loadJson,
  loadJsonLines,
  loadRecords,
  readTableFile,
} from './readTableFile'
export type { ReadableFile } from './readTableFile'

export { DEFAULT_PCA, pcaTo3D } from './pca'
export type { PcaOptions, PcaResult } from './pca'

export { canUseWorker, startPca } from './pcaClient'
export type { PcaJob } from './pcaClient'

export type { PcaRequest, PcaResponse } from './pcaWorker'

export { toViewModel, vectorToReduce } from './viewModel'
export type {
  CategoryRole,
  CellKind,
  MeasureRole,
  Positions,
  ViewColumn,
  ViewModel,
  ViewModelOptions,
} from './viewModel'

export { buildTable, loadDelimitedText } from './loadTable'
export type {
  BuildOptions,
  LoadDelimitedOptions,
  LoadNotice,
  LoadedCategoryColumn,
  LoadedColumn,
  LoadedDatetimeColumn,
  LoadedNumberColumn,
  LoadedTable,
  LoadedTextColumn,
} from './loadTable'
