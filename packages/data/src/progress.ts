/**
 * 불러오기·파생 계산 진행률 — 설계 문서 9장이 M1과 M2에 하나씩 둔 것.
 *
 * 5만 행짜리 파일은 읽는 데 몇 초가 걸린다. 그동안 화면이 굳지 않는 것은 워커가
 * 이미 해결했지만(그래서 M1 완료 기준을 넘겼지만), 사용자가 보는 것은 여전히
 * "읽는 중…" 한 줄뿐이다. 3초짜리와 30초짜리가 똑같이 생겼고, 그러면 기다릴지
 * 새로고침할지 정할 근거가 없다.
 *
 * ## 단계로 나눈 까닭
 *
 * 한 줄짜리 퍼센트를 매끄럽게 만들려면 없는 숫자를 지어내야 한다. 파일을 바이트로
 * 읽는 일은 통째로 일어나서 중간이 없고(`File.text()`에 중간은 없다), 파싱은 글자
 * 수로 잴 수 있고, 종류 판별은 컬럼 수로 잴 수 있다. 재는 방법이 다른 것을 한 막대로
 * 뭉치면 막대가 거짓말을 한다.
 *
 * 그래서 **단계 이름을 같이 보여 준다.** 막대가 잠깐 멈춰도 "컬럼 종류 살피는 중"이
 * 떠 있으면 사람은 기다린다. 아무것도 안 뜨면 죽은 줄 안다.
 *
 * ## 가중치는 어림이다
 *
 * `PHASE_WEIGHTS`는 잰 값이 아니라 어림이다. 파일마다 어느 단계가 오래 걸리는지가
 * 달라서(384차원 임베딩이면 종류 판별이, 따옴표가 많으면 파싱이) 정확한 값이란 것이
 * 없다. 막대가 할 일은 정확한 예측이 아니라 **뒤로 가지 않고 계속 움직이는 것**이고,
 * 가중치는 그 순서만 지키면 된다.
 */

export type LoadPhase = 'reading' | 'parsing' | 'profiling' | 'building' | 'reducing'

export const PHASE_LABELS: Readonly<Record<LoadPhase, string>> = {
  reading: '파일 읽는 중',
  parsing: '표로 푸는 중',
  profiling: '컬럼 종류 살피는 중',
  building: '표 만드는 중',
  reducing: '차원 줄이는 중',
}

/** 표 읽기의 단계 순서와 몫. 합이 1이다. */
const PHASE_WEIGHTS: Readonly<Record<LoadPhase, number>> = {
  reading: 0.15,
  parsing: 0.35,
  profiling: 0.35,
  building: 0.15,
  // 파생 계산은 읽기와 다른 일감이라 같은 막대에 얹지 않는다. 혼자 1이다.
  reducing: 1,
}

const TABLE_PHASES: readonly LoadPhase[] = ['reading', 'parsing', 'profiling', 'building']

export type LoadProgress = {
  readonly phase: LoadPhase
  /** 이 단계 안에서 끝난 몫(0~1). 잴 수 없는 단계면 null. */
  readonly ratio: number | null
  /** 일감 전체에서 끝난 몫(0~1). 막대 길이가 이것이다. */
  readonly fraction: number
  /** 사람에게 보여 줄 한 줄. 단계 이름과, 셀 수 있으면 센 것. */
  readonly label: string
}

export type ProgressReporter = (progress: LoadProgress) => void

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 표 읽기에서 이 단계가 시작되기 전까지 이미 끝나 있는 몫. */
function baseOf(phase: LoadPhase): number {
  let base = 0
  for (const one of TABLE_PHASES) {
    if (one === phase) return base
    base += PHASE_WEIGHTS[one]
  }
  return 0
}

/**
 * 단계와 그 안의 진척으로 진행률 하나를 만든다.
 *
 * `ratio`가 null이면 그 단계를 반쯤 지난 것으로 둔다. 0으로 두면 파일을 읽는 내내
 * 막대가 0에 붙어 있고, 1로 두면 아직 안 한 일을 끝났다고 말하게 된다.
 */
export function progressOf(phase: LoadPhase, ratio: number | null, note?: string): LoadProgress {
  const within = ratio === null ? 0.5 : clamp01(ratio)
  const fraction =
    phase === 'reducing' ? within : clamp01(baseOf(phase) + PHASE_WEIGHTS[phase] * within)
  const label = note === undefined ? PHASE_LABELS[phase] : `${PHASE_LABELS[phase]} · ${note}`
  return { phase, ratio: ratio === null ? null : within, fraction, label }
}

/**
 * 너무 자주 알리지 않게 거른다.
 *
 * 5만 행을 한 줄마다 알리면 postMessage가 5만 번이고, 그 값이 파싱보다 크다. 시간으로
 * 거르는 까닭은 일감 단위(행·컬럼)가 단계마다 달라서다 — 시간은 어느 단계에서나 같다.
 *
 * 단계가 바뀔 때는 시간과 상관없이 통과시킨다. 그 순간이 사람에게 제일 쓸모 있는
 * 소식이고, 짧은 단계가 통째로 안 보이는 일도 막는다. 마지막 알림도 항상 통과시킨다
 * (`flush`) — 안 그러면 막대가 98%에서 멈춘 채로 끝난다.
 */
export function throttleProgress(
  report: ProgressReporter,
  everyMs = 80,
  now: () => number = () => Date.now(),
): ProgressReporter & { flush(progress: LoadProgress): void } {
  let lastAt = 0
  let lastPhase: LoadPhase | null = null

  const throttled = (progress: LoadProgress) => {
    const at = now()
    if (progress.phase !== lastPhase || at - lastAt >= everyMs) {
      lastAt = at
      lastPhase = progress.phase
      report(progress)
    }
  }
  throttled.flush = (progress: LoadProgress) => {
    lastAt = now()
    lastPhase = progress.phase
    report(progress)
  }
  return throttled
}
