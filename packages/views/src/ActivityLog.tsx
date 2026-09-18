import type { LogEntry } from '@holo/core'

/**
 * 활동 기록 — 무엇을 눌러서 지금 화면이 이렇게 됐는지 되짚는 곳.
 *
 * 선택이 뷰 셋에 동시에 반영되므로, 몇 번 누르다 보면 지금 보이는 것이 어느
 * 조건 때문인지 잊는다. 명령이 전부 이름을 갖고 한 곳을 지나가니 그 이름을
 * 순서대로 보여 주면 된다.
 */
export type ActivityLogProps = {
  entries: readonly LogEntry[]
  /** 보여 줄 줄 수. 넘치는 것은 감춘다. */
  limit?: number
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function ActivityLog({ entries, limit = 8 }: ActivityLogProps) {
  return (
    <section className="holo-chart">
      <h3>활동 기록</h3>
      <ul className="holo-log">
        {entries.slice(0, limit).map((entry) => (
          <li key={`${entry.at}/${entry.label}`}>
            <time dateTime={new Date(entry.at).toISOString()}>{timeFormat.format(entry.at)}</time>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
