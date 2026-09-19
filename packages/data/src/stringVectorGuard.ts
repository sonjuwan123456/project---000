/**
 * 문자열 안에 담긴 벡터를 감지해서 막는다 — 요구사항 문서 2.3.
 *
 * 파싱해 주지 않는 이유는 성능이 아니라 **조용한 손실** 때문이다.
 * 판다스에서 `df.to_csv()`로 임베딩을 내보내면 셀 값에 `str()`이 적용되는데,
 * 값이 numpy 배열이면 구분자가 쉼표가 아니라 공백이고 긴 배열은 가운데가 `...`로 잘린다.
 * 겉보기가 비슷한 두 가지가 섞여 들어오고 그중 하나는 이미 데이터가 없어진 상태라,
 * "최선을 다해 파싱"하면 잘린 벡터로 UMAP을 돌려 놓고 아무도 모르는 결과가 나온다.
 */

export type StringVectorFlavor = 'numpy' | 'list'

export type StringVectorFinding = {
  readonly column: string
  readonly flavor: StringVectorFlavor
  /** numpy 기본 출력 옵션이 가운데를 `...`로 잘라낸 흔적. */
  readonly truncated: boolean
  readonly message: string
}

/** 대괄호로 감싼 수들. 구분자가 쉼표인지 공백인지로 갈린다. */
const BRACKETED = /^\[\s*([^[\]]*?)\s*\]$/
const NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
/** 이 개수 이상 붙어 있어야 벡터로 본다. `[1, 2]`는 그냥 값이 둘인 리스트일 수 있다. */
const MIN_TOKENS = 4
/** 표본 중 이 비율 이상이 같은 모양이어야 컬럼 전체를 그렇게 본다. */
const MIN_RATIO = 0.9

type Shape = { flavor: StringVectorFlavor; truncated: boolean } | null

function shapeOf(value: string): Shape {
  const match = BRACKETED.exec(value.trim())
  if (match === null) return null
  const body = match[1] ?? ''
  if (body === '') return null

  const truncated = body.includes('...')
  const cleaned = truncated ? body.replaceAll('...', ' ') : body
  const flavor: StringVectorFlavor = cleaned.includes(',') ? 'list' : 'numpy'
  const tokens = cleaned
    .split(flavor === 'list' ? ',' : /\s+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')

  if (tokens.length < MIN_TOKENS) return null
  if (!tokens.every((token) => NUMBER_TOKEN.test(token))) return null
  return { flavor, truncated }
}

function messageFor(column: string, flavor: StringVectorFlavor, truncated: boolean): string {
  if (truncated) {
    return `'${column}' 컬럼은 가운데가 잘린 numpy 출력으로 보입니다. 값의 일부가 파일에 남아 있지 않아 불러올 수 없습니다. Parquet으로 내보내거나 컬럼을 ${column}_0, ${column}_1 … 형태로 펼쳐 주세요.`
  }
  const kind = flavor === 'numpy' ? '공백으로 구분된 numpy 출력' : '문자열로 저장된 배열'
  return `'${column}' 컬럼은 ${kind}입니다. 문자열 안의 배열은 불러오지 않습니다. Parquet으로 내보내거나 컬럼을 ${column}_0, ${column}_1 … 형태로 펼쳐 주세요.`
}

/**
 * 문자열 벡터로 보이면 안내 내용을, 아니면 `null`을 돌려준다.
 * 한 컬럼 안에 numpy 출력과 파이썬 리스트가 섞여 있으면 잘린 쪽을 우선해 알린다.
 */
export function detectStringVector(
  column: string,
  values: readonly (string | null | undefined)[],
  sampleSize = 200,
): StringVectorFinding | null {
  const limit = Math.min(values.length, sampleSize)
  let seen = 0
  let matched = 0
  let truncated = false
  const flavors = new Set<StringVectorFlavor>()

  for (let row = 0; row < limit; row += 1) {
    const raw = values[row]
    if (raw === null || raw === undefined || raw.trim() === '') continue
    seen += 1
    const shape = shapeOf(raw)
    if (shape === null) continue
    matched += 1
    flavors.add(shape.flavor)
    if (shape.truncated) truncated = true
  }

  if (seen === 0 || matched / seen < MIN_RATIO) return null
  const flavor: StringVectorFlavor = flavors.has('numpy') ? 'numpy' : 'list'
  return { column, flavor, truncated, message: messageFor(column, flavor, truncated) }
}
