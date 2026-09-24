/**
 * 뷰 레지스트리 — 어떤 뷰가 있고, 어떤 자산을 보며, 화면 어디에 앉는지.
 *
 * 설계 문서 3장: "새 시각화는 시각화층의 뷰 레지스트리에 등록만 하면 된다." 그 등록부가
 * 이 표다. 작업 공간은 자산 모양을 넘겨 어떤 뷰를 띄울지 묻고(`viewsFor`), 뷰마다 앉을
 * 자리를 받아(`arrangeViews`) 그대로 그린다. 뷰를 하나 더하려면 여기 한 줄을 적고,
 * 작업 공간의 그리기 표(`Record<ViewKind, …>`)에 한 줄을 더한다. 둘 중 하나를 빠뜨리면
 * 타입 검사가 멈춘다.
 *
 * 뷰가 무엇을 그리는지(컴포넌트)는 여기 적지 않는다. 뷰마다 받는 값이 달라서, 공통 모양으로
 * 묶으면 모든 뷰가 모든 값을 받게 된다. 여기는 **무엇을 어디에** 만 쥔다.
 */

export type ViewKind = 'points' | 'model' | 'text' | 'table' | 'distribution'

/** 뷰가 보는 자산 종류. 설계 문서 5장 "뷰 하나는 자산 하나만 본다"(MVP). */
export type ViewAssetKind = 'table' | 'model' | 'text'

/**
 * 화면의 세 자리.
 *
 * - stage: 가운데 큰 자리. 3D 무대이거나, 3D가 없으면 그 자산의 주인공 뷰.
 * - side: 오른쪽 좁은 자리. 요약·그래프.
 * - bottom: 무대 아래. 긴 표.
 */
export type ViewArea = 'stage' | 'side' | 'bottom'

/**
 * 선택에 어떻게 반응하는지(설계 문서 5장 "선택 반응 기본값").
 *
 * - highlight: 선택 안 된 것을 흐리게. 전체 모양을 잃지 않는다.
 * - filter: 선택된 것만 남긴다.
 * - none: 선택과 무관하다.
 */
export type SelectionReaction = 'highlight' | 'filter' | 'none'

/**
 * 뷰가 어떤 표면에 그려지는지(설계 문서 7장). canvas는 WebGL 무대에 직접, dom은 HTML로.
 * dom 뷰는 나중에 3D 공간에 뜰 때 패널 표면(`panelSurface.ts`)을 거친다.
 */
export type ViewSurface = 'canvas' | 'dom'

export type ViewEntry = {
  readonly kind: ViewKind
  /** 명령 팔레트와 패널 머리에 쓸 이름. */
  readonly label: string
  readonly asset: ViewAssetKind
  readonly area: ViewArea
  readonly reaction: SelectionReaction
  readonly surface: ViewSurface
  /**
   * 대용량을 다루는 뷰인지. 수만 행 표는 텍스처로 옮기면 스크롤이 끊기고 글자를 복사할 수
   * 없어서, 설계 문서 7장이 "대용량 표는 항상 DOM"으로 못 박았다.
   */
  readonly large: boolean
}

export const VIEW_REGISTRY: readonly ViewEntry[] = [
  {
    kind: 'points',
    label: '3D 점',
    asset: 'table',
    area: 'stage',
    reaction: 'highlight',
    surface: 'canvas',
    large: false,
  },
  {
    kind: 'model',
    label: '3D 모델',
    asset: 'model',
    area: 'stage',
    reaction: 'none',
    surface: 'canvas',
    large: false,
  },
  {
    kind: 'text',
    label: '텍스트',
    asset: 'text',
    area: 'stage',
    reaction: 'none',
    surface: 'dom',
    large: true,
  },
  {
    kind: 'table',
    label: '표',
    asset: 'table',
    area: 'bottom',
    reaction: 'filter',
    surface: 'dom',
    large: true,
  },
  {
    kind: 'distribution',
    label: '분포 그래프',
    asset: 'table',
    area: 'side',
    reaction: 'filter',
    surface: 'dom',
    large: false,
  },
]

export function viewEntry(kind: ViewKind): ViewEntry {
  const entry = VIEW_REGISTRY.find((one) => one.kind === kind)
  // 타입이 막으므로 여기 올 일은 없다. 온다면 등록부에서 한 줄이 지워진 것이다.
  if (entry === undefined) throw new Error(`뷰 레지스트리에 '${kind}'가 없다.`)
  return entry
}

/** 뷰를 고르는 데 필요한 만큼만 본 자산 모양. */
export type AssetShape =
  | {
      readonly kind: 'table'
      /** 3D 좌표가 있거나 만드는 중인지. 벡터 컬럼이 있거나 숫자 컬럼이 셋 이상. */
      readonly placeable: boolean
      /** 분포 그래프로 그릴 범주나 숫자 컬럼이 있는지. */
      readonly chartable: boolean
    }
  | { readonly kind: 'model' }
  | { readonly kind: 'text' }

/**
 * 자산을 열었을 때 띄울 뷰(요구사항 3.3, G1).
 *
 * 벡터가 있거나 숫자 컬럼이 셋 이상이면 3D 점 + 표 + 분포 그래프. 그렇지 않으면 3D를
 * 빼고 표 + 분포 그래프만 둔다. 좌표를 못 만드는 표에 빈 무대를 띄워 두면 화면 절반이
 * "그릴 수 없습니다"로 남는다. 그래프로 그릴 컬럼이 하나도 없으면 그래프도 뺀다.
 */
export function viewsFor(shape: AssetShape): readonly ViewKind[] {
  if (shape.kind === 'model') return ['model']
  if (shape.kind === 'text') return ['text']
  const views: ViewKind[] = []
  if (shape.placeable) views.push('points')
  views.push('table')
  if (shape.chartable) views.push('distribution')
  return views
}

export type Arrangement = {
  readonly stage: ViewKind | null
  readonly side: readonly ViewKind[]
  readonly bottom: readonly ViewKind[]
}

/**
 * 뷰를 자리에 앉힌다.
 *
 * 무대에 앉을 뷰가 없으면 아래 자리의 첫 뷰를 무대로 올린다. 3D가 없는 표는 표가
 * 가운데 큰 자리를 쓰고, 아래 칸은 사라진다.
 */
export function arrangeViews(views: readonly ViewKind[]): Arrangement {
  const stage = views.filter((kind) => viewEntry(kind).area === 'stage')
  const side = views.filter((kind) => viewEntry(kind).area === 'side')
  const bottom = views.filter((kind) => viewEntry(kind).area === 'bottom')
  const main = stage[0] ?? bottom[0] ?? null
  return {
    stage: main,
    side,
    bottom: bottom.filter((kind) => kind !== main),
  }
}
