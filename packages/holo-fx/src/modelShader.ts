/**
 * 3D 모델의 홀로그램 표시 모드 셰이더.
 *
 * 설계 문서 7장이 모델 뷰에 표시 모드 둘을 뒀다. 원본은 만든 사람이 넣은 재질
 * 그대로고, 홀로그램은 이 프로젝트의 시각 언어로 다시 칠한 것이다. 둘 다 필요한
 * 까닭은 쓰임이 다르기 때문이다. 원본은 "블렌더에서 보던 그것이 맞나"를 확인하는
 * 모드고, 홀로그램은 같은 공간에 있는 점·표와 한 화면으로 읽히게 하는 모드다.
 *
 * 테두리가 밝고 가운데가 비치는 모양(프레넬)으로 만든다. 표면을 고르게 칠하면
 * 덩어리가 실루엣으로만 보여서 안쪽 구조가 사라지는데, 보는 방향과 면이 이루는
 * 각으로 밝기를 주면 굴곡이 그대로 드러난다. 더하기 합성이라 겹친 면이 쌓이면서
 * 두께도 읽힌다.
 */

import { hexToRgb01, holoColors } from '@holo/core'
import type { EffectLevel } from './pointsShader'

export const modelVertexShader = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vPositionView;
  varying float vHeight;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vPositionView = viewPosition.xyz;
    // 주사선은 모델이 돌아도 제자리에 있어야 한다. 그래서 화면이 아니라 모델 높이를 쓴다.
    vHeight = (modelMatrix * vec4(position, 1.0)).y;
    gl_Position = projectionMatrix * viewPosition;
  }
`

export const modelFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uColor;
  uniform float uRimPower;
  uniform float uBase;
  uniform float uScanStrength;
  uniform float uScanDensity;
  uniform float uTime;

  varying vec3 vNormalView;
  varying vec3 vPositionView;
  varying float vHeight;

  void main() {
    // 양면을 그리므로 뒷면은 법선이 뒤집혀 들어온다. 부호를 맞춰야 테두리가 끊기지 않는다.
    vec3 normal = normalize(vNormalView) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 toEye = normalize(-vPositionView);

    float facing = clamp(dot(normal, toEye), 0.0, 1.0);
    float rim = pow(1.0 - facing, uRimPower);

    float scan = 1.0;
    if (uScanStrength > 0.0) {
      float wave = sin(vHeight * uScanDensity - uTime * 1.6) * 0.5 + 0.5;
      scan = mix(1.0, wave, uScanStrength);
    }

    float intensity = (uBase + rim) * scan;
    gl_FragColor = vec4(uColor * intensity, intensity);
  }
`

export type ModelUniformValues = {
  uColor: readonly [number, number, number]
  uRimPower: number
  uBase: number
  uScanStrength: number
  uScanDensity: number
  uTime: number
}

/**
 * 효과 강도별 홀로그램 값.
 *
 * `performance`에서 주사선을 끄는 것은 그리는 값이 비싸서가 아니라, 매 프레임 시각을
 * 올려 주어야 해서다. 정지 화면으로 둘 수 있으면 프레임 루프 하나가 통째로 빠진다.
 */
export function modelUniforms(level: EffectLevel): ModelUniformValues {
  const color = hexToRgb01(holoColors.accent)
  if (level === 'performance') {
    return { uColor: color, uRimPower: 2, uBase: 0.22, uScanStrength: 0, uScanDensity: 0, uTime: 0 }
  }
  return level === 'high'
    ? {
        uColor: color,
        uRimPower: 2.6,
        uBase: 0.16,
        uScanStrength: 0.35,
        uScanDensity: 26,
        uTime: 0,
      }
    : {
        uColor: color,
        uRimPower: 2.2,
        uBase: 0.18,
        uScanStrength: 0.22,
        uScanDensity: 22,
        uTime: 0,
      }
}
