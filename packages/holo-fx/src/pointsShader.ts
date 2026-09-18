/**
 * 발광 점 셰이더 — 점 수만 개를 draw call 한 번으로 그린다.
 *
 * 프로토타입에서 확인한 전제 두 가지를 그대로 옮겼다.
 * 1. 점마다 오브젝트를 만들지 않는다. 위치·색·선택 상태를 각각 버퍼 하나에 담는다.
 * 2. 선택이 바뀌어도 위치와 색 버퍼는 건드리지 않는다. `aSelected` 버퍼만 덮어쓴다.
 *
 * WebGPU(TSL)로 옮길 때 바뀌는 곳은 이 파일 하나다.
 */

/**
 * 점마다 필요한 정점 속성.
 * `aSelected`만 매번 바뀌므로 동적 버퍼로 두고 나머지는 정적 버퍼로 둔다.
 */
export const POINT_ATTRIBUTES = {
  /** vec3 — 점 위치. */
  position: 'position',
  /** vec3 — 범주 색. 0~1. */
  color: 'aColor',
  /** float — 1이면 선택, 0이면 흐리게. */
  selected: 'aSelected',
  /** float — 0~1 난수. 등장 연출을 점마다 조금씩 어긋나게 한다. */
  seed: 'aSeed',
} as const

export type PointsUniforms = {
  /** 거리 1에서의 점 크기(픽셀). 화면 높이와 픽셀 비율을 곱해서 넘긴다. */
  uSize: number
  /** 글로우 패스에서만 키운다. 코어 패스는 1. */
  uSizeScale: number
  /** 글로우 패스에서만 낮춘다. 코어 패스는 1. */
  uAlpha: number
  /** 등장 연출 진행도 0~1. 움직임을 줄인 환경에서는 바로 1로 둔다. */
  uReveal: number
}

export const pointsVertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSelected;
  attribute float aSeed;

  uniform float uSize;
  uniform float uSizeScale;
  uniform float uAlpha;
  uniform float uReveal;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float distance = max(0.35, -viewPosition.z);
    float reveal = smoothstep(aSeed * 0.55, aSeed * 0.55 + 0.45, uReveal);

    // 원근에 따라 점이 작아진다. 가까운 점이 화면을 덮지 않도록 위를 막는다.
    gl_PointSize = min(72.0, uSize * uSizeScale * (0.72 + aSelected * 0.55) * reveal / distance);

    // 선택 반응은 강조다. 선택되지 않은 점은 지우지 않고 색을 빼고 흐리게 둔다.
    // 군집의 전체 모양이 남아 있어야 어디를 골랐는지 읽을 수 있다.
    vColor = mix(vec3(0.23, 0.23, 0.26) + aColor * 0.16, aColor, aSelected);
    vAlpha = mix(0.17, 1.0, aSelected) * uAlpha * reveal;
  }
`

export const pointsFragmentShader = /* glsl */ `
  precision mediump float;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = length(offset) * 2.0;
    if (radius > 1.0) discard;

    float core = smoothstep(1.0, 0.0, radius);
    gl_FragColor = vec4(vColor * (0.5 + 0.6 * core), pow(core, 2.0) * vAlpha);
  }
`

/**
 * 효과 강도별 패스 설정.
 *
 * 글로우는 같은 점을 크고 흐리게 한 번 더 그려서 만든다. 후처리 블룸보다 싸고,
 * 점 개수가 늘어도 비용이 예측 가능하다. 성능 우선에서는 이 패스를 뺀다.
 */
export type EffectLevel = 'high' | 'normal' | 'performance'

export function glowPass(level: EffectLevel): { uSizeScale: number; uAlpha: number } | null {
  if (level === 'performance') return null
  return level === 'high' ? { uSizeScale: 3.2, uAlpha: 0.2 } : { uSizeScale: 2.4, uAlpha: 0.14 }
}

/** 픽셀 비율 상한. 효과 강도를 내리면 그리는 픽셀 수부터 줄인다. */
export function maxPixelRatio(level: EffectLevel): number {
  return level === 'high' ? 2 : level === 'normal' ? 1.6 : 1
}
