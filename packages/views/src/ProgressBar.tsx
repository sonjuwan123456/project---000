import type { LoadProgress } from '@holo/data'

/**
 * 진행률 막대 — 설계 문서 9장의 불러오기·파생 계산 진행률이 화면에 닿는 자리.
 *
 * 2D HUD로 둔다(G8). 3D 무대 위 패널로 띄우는 길도 있었지만, 막대가 필요한 순간은
 * 무대에 그릴 것이 아직 없는 순간이다. 좌표가 나오기 전에 3D 패널을 띄우려면 그
 * 패널만을 위한 장면을 따로 세워야 하고, 첫 파일을 여는 동안에는 카메라도 아직
 * 자리를 못 잡았다. 나머지 알림이 전부 2D에 있기도 하다.
 *
 * 숫자와 함께 **단계 이름**을 보여 주는 것이 이 자리의 핵심이다. 막대가 잠깐
 * 멈춰도 "컬럼 종류 살피는 중"이 떠 있으면 사람은 기다리고, 아무것도 없으면
 * 죽은 줄 안다.
 */
export type ProgressBarProps = {
  /** 지금 진행률. null이면 아직 아무 소식도 오지 않은 것이라 막대만 비워 둔다. */
  progress: LoadProgress | null
  /** 막대 위에 함께 보일 이름. 보통 파일 이름이다. */
  title?: string
  /**
   * 첫 소식이 오기 전에 보여 줄 한 줄. 무슨 일을 기다리는지 이미 아는 자리에서 준다.
   * 주지 않으면 '여는 중'이다.
   */
  idleLabel?: string
}

export function ProgressBar({ progress, title, idleLabel = '여는 중' }: ProgressBarProps) {
  const fraction = progress?.fraction ?? 0
  const percent = Math.round(fraction * 100)
  /*
   * 셀 수 없는 단계(`ratio`가 null)는 막대를 흐리게 둔다. 같은 굵기로 그리면 그
   * 길이가 잰 값처럼 보이는데, 그 자리의 절반은 어림이다.
   */
  const vague = progress === null || progress.ratio === null
  const label = progress?.label ?? idleLabel

  return (
    <div className="holo-progress">
      <p className="holo-progress-line">
        {title === undefined ? null : <span className="holo-progress-name">{title}</span>}
        <span className="holo-progress-phase">{label}</span>
        {vague ? null : <span className="holo-progress-percent">{percent}%</span>}
      </p>
      <div
        className={vague ? 'holo-progress-track is-vague' : 'holo-progress-track'}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
      >
        <div className="holo-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
