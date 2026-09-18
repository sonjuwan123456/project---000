/**
 * 홀로그램 셰이더, 등장 연출, 후처리. WebGPU 전환 대상.
 *
 * M0에서는 패키지 경계와 의존 방향만 잡아 둔다.
 * 실제 구현은 M2 에서 채운다.
 */
export const PACKAGE_NAME = '@holo/holo-fx'

export {
  POINT_ATTRIBUTES,
  glowPass,
  maxPixelRatio,
  pointsFragmentShader,
  pointsVertexShader,
  type EffectLevel,
  type PointsUniforms,
} from './pointsShader'
