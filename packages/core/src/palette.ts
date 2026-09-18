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
 * 어두운 배경에서 서로 구분되는 순서로 골랐고, 마지막은 "기타"용 무채색이다.
 */
export const categoryColors = [
  '#5bd1e8',
  '#a98bff',
  '#ff7d9c',
  '#5fe3a1',
  '#f2a65a',
  '#c9cedc',
] as const

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
