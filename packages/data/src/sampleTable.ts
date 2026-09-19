import type { ColumnLookup } from '@holo/core'

/**
 * 개발용 샘플 표 — 고객 문의 임베딩을 본뜬 컬럼 데이터.
 *
 * M1의 로더가 붙기 전까지 3D 점 뷰·표·분포 그래프를 붙여 보려면 데이터가 필요하다.
 * 실제 Arrow 테이블과 같은 모양으로 두려고 값은 전부 컬럼별 TypedArray에 담고,
 * 원문 문자열은 보관하지 않고 행 번호로 그때그때 만든다. 5만 행에서도 메모리가 늘지 않는다.
 *
 * 군집 다섯 개와, 어느 카테고리에도 속하지 않는 작은 덩어리 하나(실제로는 개발자 API 문의)를
 * 함께 만든다. 설계 문서 2장의 대표 사용 흐름 3~4단계를 그대로 시험해 볼 수 있다.
 */

export const SAMPLE_CATEGORIES = ['배송', '결제', '환불', '계정', '품질', '기타'] as const

export type SampleTable = {
  readonly rowCount: number
  /** 3차원으로 줄인 임베딩 좌표. */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 범주 컬럼. SAMPLE_CATEGORIES의 자리 번호. */
  readonly category: Uint8Array
  /** -1(부정) ~ +1(긍정). */
  readonly sentiment: Float32Array
  readonly charCount: Uint16Array
  /** 기준일로부터 지난 날 수. */
  readonly dayOffset: Uint16Array
  /** 선택 코디네이터에 그대로 넘길 수 있는 컬럼 조회 함수. */
  readonly columns: ColumnLookup
  /** 원문. 저장하지 않고 행마다 만들어 돌려준다. */
  textOf(row: number): string
  dateOf(row: number): Date
}

type Cluster = {
  readonly category: number
  readonly center: readonly [number, number, number]
  readonly spread: number
  readonly share: number
  readonly sentimentBias: number
}

const CLUSTERS: readonly Cluster[] = [
  { category: 0, center: [-4.6, -0.8, 1.2], spread: 1.45, share: 0.26, sentimentBias: -0.15 },
  { category: 1, center: [3.9, 1.1, 2.4], spread: 1.35, share: 0.22, sentimentBias: -0.32 },
  { category: 2, center: [0.4, 2.6, -4.2], spread: 1.3, share: 0.18, sentimentBias: -0.55 },
  { category: 3, center: [-2.2, -2.4, -3.6], spread: 1.4, share: 0.14, sentimentBias: -0.05 },
  { category: 4, center: [4.4, -2.2, -1.4], spread: 1.25, share: 0.17, sentimentBias: -0.45 },
  { category: 5, center: [6.6, 3.4, 4.8], spread: 0.52, share: 0.03, sentimentBias: 0.1 },
]

const TEMPLATES: readonly (readonly string[])[] = [
  [
    '주문한 상품이 아직 도착하지 않았습니다',
    '배송 예정일이 지났는데 출고 상태 그대로입니다',
    '운송장 번호를 조회해도 정보가 없습니다',
    '부재중이라 재배송을 요청하고 싶습니다',
  ],
  [
    '카드 결제가 두 번 청구되었습니다',
    '결제창에서 오류가 나고 진행이 안 됩니다',
    '무이자 할부가 적용되지 않았습니다',
    '현금영수증을 다시 발행해 주세요',
  ],
  [
    '반품 접수 후 환불이 들어오지 않습니다',
    '부분 취소했는데 금액이 맞지 않습니다',
    '교환 대신 환불로 바꾸고 싶습니다',
    '회수 기사님이 오지 않았습니다',
  ],
  [
    '비밀번호 재설정 메일이 오지 않습니다',
    '휴대폰 번호가 바뀌어 본인인증이 안 됩니다',
    '2단계 인증 앱을 새 폰으로 옮기고 싶습니다',
    '소셜 로그인 연동이 풀렸습니다',
  ],
  [
    '받은 제품에 스크래치가 있습니다',
    '사진과 색상이 많이 다릅니다',
    '부속품 하나가 빠져 있습니다',
    '설명서대로 해도 연결되지 않습니다',
  ],
  [
    'SDK 토큰 발급 API가 401을 반환합니다',
    '웹훅 재전송 정책이 문서와 다르게 동작합니다',
    '레이트 리밋 헤더 값이 항상 0으로 옵니다',
    '배치 조회 API의 커서가 같은 페이지를 반복합니다',
  ],
]

const BASE_DATE = Date.UTC(2026, 5, 20)
const DAY_MS = 86_400_000

/** 씨앗을 주면 언제나 같은 수열을 만드는 난수. 화면 비교 테스트가 흔들리지 않게 한다. */
function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  const u = 1 - random()
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function createSampleTable(rowCount = 10_000, seed = 20260918): SampleTable {
  const random = mulberry32(seed)
  const x = new Float32Array(rowCount)
  const y = new Float32Array(rowCount)
  const z = new Float32Array(rowCount)
  const category = new Uint8Array(rowCount)
  const sentiment = new Float32Array(rowCount)
  const charCount = new Uint16Array(rowCount)
  const dayOffset = new Uint16Array(rowCount)

  const totalShare = CLUSTERS.reduce((sum, cluster) => sum + cluster.share, 0)
  let row = 0
  CLUSTERS.forEach((cluster, index) => {
    const isLast = index === CLUSTERS.length - 1
    const wanted = isLast
      ? rowCount - row
      : Math.min(rowCount - row, Math.round((cluster.share / totalShare) * rowCount))
    const [cx, cy, cz] = cluster.center

    for (let made = 0; made < wanted; made += 1, row += 1) {
      x[row] = cx + gaussian(random) * cluster.spread
      y[row] = cy + gaussian(random) * cluster.spread * 0.8
      z[row] = cz + gaussian(random) * cluster.spread
      category[row] = cluster.category
      sentiment[row] = Math.max(-1, Math.min(1, cluster.sentimentBias + gaussian(random) * 0.34))
      charCount[row] = Math.round(24 + Math.abs(gaussian(random)) * 160)
      dayOffset[row] = Math.floor(random() * 90)
    }
  })

  const columns: ColumnLookup = (name) => {
    switch (name) {
      case 'x':
        return x
      case 'y':
        return y
      case 'z':
        return z
      case 'category':
        return category
      case 'sentiment':
        return sentiment
      case 'charCount':
        return charCount
      case 'dayOffset':
        return dayOffset
      default:
        return undefined
    }
  }

  return {
    rowCount,
    x,
    y,
    z,
    category,
    sentiment,
    charCount,
    dayOffset,
    columns,
    textOf(target) {
      const list = TEMPLATES[category[target] ?? 0] ?? []
      return list.length === 0 ? '' : (list[(target * 7 + list.length) % list.length] ?? '')
    },
    dateOf(target) {
      return new Date(BASE_DATE + (dayOffset[target] ?? 0) * DAY_MS)
    },
  }
}

/** CSV 한 칸으로 만든다. 따옴표와 쉼표가 든 값만 감싼다. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * 샘플 표를 CSV 글자로 낸다.
 *
 * 개발용 화면도 파일을 거쳐 들어오게 하려는 것이다. 샘플만 다른 길로 들어오면
 * 로더가 깨져도 화면은 멀쩡해 보인다.
 */
export function sampleCsv(rowCount = 10_000, seed = 20260918): string {
  const table = createSampleTable(rowCount, seed)
  const lines: string[] = ['원문,범주,감성,글자수,접수일,x,y,z']
  for (let row = 0; row < rowCount; row += 1) {
    lines.push(
      [
        cell(table.textOf(row)),
        cell(SAMPLE_CATEGORIES[table.category[row] ?? 0] ?? '기타'),
        (table.sentiment[row] ?? 0).toFixed(3),
        String(table.charCount[row] ?? 0),
        table.dateOf(row).toISOString().split('T')[0] ?? '',
        (table.x[row] ?? 0).toFixed(3),
        (table.y[row] ?? 0).toFixed(3),
        (table.z[row] ?? 0).toFixed(3),
      ].join(','),
    )
  }
  return lines.join('\n')
}
