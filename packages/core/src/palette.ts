/**
 * 색상 토큰 한 곳 — CSS 변수와 셰이더 팔레트를 같은 값에서 만든다.
 *
 * 설계 문서 7장: 시각 언어는 따뜻한 검정 배경, 유리 카드, 세리프 제목이다.
 * 색을 CSS와 GLSL 양쪽에 손으로 적으면 반드시 어긋나므로 여기서만 정의한다.
 */
export const holoColors = {
  /** 따뜻한 검정. 배경. */
  bg: '#060507',
  /** 패널 바닥. */
  surface: '#0a0810',
  /** 경계선. */
  line: '#241f2e',
  /** 본문 글자. */
  text: '#ece9f4',
  /** 보조 글자. */
  dim: '#938ea6',
  /** 캡션·수치 단위처럼 더 약한 글자. */
  faint: '#635d74',
  /** 강조 한 가지. 선택, 초점, 활성 상태에만 쓴다. */
  accent: '#5bd1e8',
} as const

export type HoloColorName = keyof typeof holoColors

/**
 * 범주 컬럼을 색으로 나눌 때 쓰는 순서 있는 팔레트.
 *
 * 요구사항 2.2가 3D 점 색상을 "상위 12개 + 기타"로 정해서 유채색 12개와
 * 마지막 무채색 하나를 둔다. 색상환을 도는 순서가 아니라 **앞에서부터 잘라 써도
 * 구분되는 순서**로 놓았다. 범주가 셋뿐인 표가 훨씬 흔하고, 그때 앞 세 개가
 * 비슷한 색이면 화면이 못 쓰게 된다.
 *
 * 12개는 사람이 색만으로 구별할 수 있는 한계에 가깝다. 뒤쪽 색끼리는 헷갈릴 수
 * 있으므로 색 하나만으로 뜻을 전하지 말고 범례와 이름을 함께 둘 것.
 */
export const categoryColors = [
  '#5bd1e8',
  '#a98bff',
  '#ff7d9c',
  '#5fe3a1',
  '#f2a65a',
  '#6fb0ff',
  '#e8d15c',
  '#ff8f6b',
  '#a8e05f',
  '#e07fd8',
  '#4fd0c0',
  '#c2b280',
  '#c9cedc',
] as const

/** 색을 받는 범주의 최대 개수. 이 수를 넘는 값은 전부 "기타"로 모은다. */
export const MAX_COLORED_CATEGORIES = categoryColors.length - 1

/** "기타"가 쓰는 자리. 팔레트의 마지막이다. */
export const OVERFLOW_CATEGORY = MAX_COLORED_CATEGORIES

/** `#rrggbb`를 셰이더가 쓰는 0~1 세 값으로 바꾼다. */
export function hexToRgb01(hex: string): readonly [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`색상 토큰은 #rrggbb 형식이어야 한다: ${hex}`)
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

/** `:root`에 넣을 CSS 변수 이름과 값. global.css가 이 결과를 그대로 쓴다. */
export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(holoColors)) {
    vars[`--holo-${name}`] = value
  }
  categoryColors.forEach((value, index) => {
    vars[`--holo-cat-${index}`] = value
  })
  return vars
}

/** 범주 색을 셰이더 팔레트(0~1 값)로 펼친다. 팔레트 길이를 넘으면 앞에서부터 돌려 쓴다. */
export function categoryPalette(): Float32Array {
  const palette = new Float32Array(categoryColors.length * 3)
  categoryColors.forEach((hex, index) => {
    const [r, g, b] = hexToRgb01(hex)
    palette[index * 3] = r
    palette[index * 3 + 1] = g
    palette[index * 3 + 2] = b
  })
  return palette
}
