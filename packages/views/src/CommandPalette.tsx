import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 명령 팔레트 — 화면에 버튼을 늘리지 않고 명령을 꺼내는 곳.
 *
 * 뷰가 늘어날수록 도구 모음에 버튼을 붙이는 방식은 무너진다. 명령은 전부 이름이
 * 있으니 검색으로 찾게 하고, 화면에는 자주 쓰는 것만 남긴다.
 *
 * 키보드만으로 끝까지 쓸 수 있어야 한다. 열자마자 입력란에 초점이 가고,
 * 위아래로 고르고 Enter로 실행하고 Esc로 닫는다.
 */
export type PaletteCommand = {
  /** 묶음 이름. 목록 오른쪽에 회색으로 붙는다. */
  readonly group: string
  readonly label: string
  /** 흐리게 보이고 실행되지 않는다. 되돌릴 것이 없을 때의 "되돌리기"처럼. */
  readonly disabled?: boolean
  run: () => void
}

export type CommandPaletteProps = {
  commands: readonly PaletteCommand[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return commands
    return commands.filter((command) =>
      `${command.label} ${command.group}`.toLowerCase().includes(needle),
    )
  }, [commands, query])

  // 검색어가 좁아지면 커서가 목록 밖에 남을 수 있다.
  const selected = Math.min(cursor, Math.max(0, found.length - 1))

  // 흐린 항목에 커서를 얹어 두면 Enter가 아무 일도 하지 않아 고장으로 보인다.
  useEffect(() => {
    if (found.length === 0) return
    if (found[selected]?.disabled !== true) return
    const next = found.findIndex((command) => command.disabled !== true)
    if (next !== -1) setCursor(next)
  }, [found, selected])

  /** 실행할 수 있는 다음 항목으로 옮긴다. 흐린 항목은 건너뛴다. */
  function move(step: number) {
    for (let index = selected + step; index >= 0 && index < found.length; index += step) {
      if (found[index]?.disabled !== true) {
        setCursor(index)
        return
      }
    }
  }

  function runAt(index: number) {
    const command = found[index]
    if (!command || command.disabled === true) return
    command.run()
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runAt(selected)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="holo-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="holo-palette" role="dialog" aria-label="명령 팔레트">
        <input
          ref={input}
          value={query}
          placeholder="명령 검색 — 선택, 뷰, 효과"
          autoComplete="off"
          aria-label="명령 검색"
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={onKeyDown}
        />
        <ul>
          {found.length === 0 ? (
            <li className="holo-palette-empty">맞는 명령이 없다</li>
          ) : (
            found.map((command, index) => (
              <li
                key={`${command.group}/${command.label}`}
                className={
                  (index === selected ? 'is-selected' : '') +
                  (command.disabled === true ? ' is-disabled' : '')
                }
                onPointerEnter={() => setCursor(index)}
                onClick={() => runAt(index)}
              >
                <span>{command.label}</span>
                <span className="holo-palette-group">{command.group}</span>
              </li>
            ))
          )}
        </ul>
        <div className="holo-palette-foot">
          <span>↑↓ 이동</span>
          <span>Enter 실행</span>
          <span>Esc 닫기</span>
        </div>
      </div>
    </div>
  )
}
