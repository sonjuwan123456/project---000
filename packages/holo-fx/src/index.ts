/**
 * 홀로그램 셰이더, 등장 연출, 후처리. WebGPU 전환 대상.
 *
 * M2에서 점 뷰의 셰이더와 3D 모델 뷰의 홀로그램 표시 모드가 들어왔다.
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

export {
  modelFragmentShader,
  modelUniforms,
  modelVertexShader,
  type ModelUniformValues,
} from './modelShader'
