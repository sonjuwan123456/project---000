/**
 * 연결층·데이터층. 로더 레지스트리, Arrow 데이터층, 계산 워커.
 *
 * M0에서는 패키지 경계와 의존 방향만 잡아 둔다.
 * 실제 구현은 M1(로더)과 M2(파생 계산) 에서 채운다.
 */
export const PACKAGE_NAME = '@holo/data'

export { SAMPLE_CATEGORIES, createSampleTable, type SampleTable } from './sampleTable'
