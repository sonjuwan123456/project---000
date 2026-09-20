import { describe, expect, it } from 'vitest'
import {
  extensionsOfFlavor,
  flavorOf,
  flavorOfExtension,
  hasLogTimestamp,
  looksLikeLog,
  looksLikeMarkdown,
  parseLogLevel,
} from './textFlavor'

const lines = (text: string) => text.trim().split('\n')

describe('parseLogLevel', () => {
  it('감싼 레벨을 대소문자 가리지 않고 읽는다', () => {
    expect(parseLogLevel('2026-09-20 12:01:35 [ERROR] 연결 실패')).toBe('error')
    expect(parseLogLevel('12:01:35 (warn) 느립니다')).toBe('warn')
    expect(parseLogLevel('<Info> 시작')).toBe('info')
  })

  it('맨 대문자도 읽는다', () => {
    expect(parseLogLevel('2026-09-20T12:01:35.123Z DEBUG main 캐시 적중')).toBe('debug')
  })

  it('줄 앞머리에 붙은 것도 읽는다', () => {
    expect(parseLogLevel('error: 파일을 찾지 못했습니다')).toBe('error')
    expect(parseLogLevel('  Warning - 곧 만료됩니다')).toBe('warn')
  })

  it('같은 뜻의 다른 낱말을 한곳으로 모은다', () => {
    for (const line of ['[FATAL] 죽음', '[SEVERE] 죽음', '[CRIT] 죽음', '[ERR] 죽음']) {
      expect(parseLogLevel(line)).toBe('error')
    }
    expect(parseLogLevel('[WARNING] 조심')).toBe('warn')
    expect(parseLogLevel('[VERBOSE] 수다')).toBe('debug')
  })

  /*
   * 아래 둘이 이 판별기의 존재 이유다. 느슨하게 잡으면 산문이 전부 로그가 되고,
   * 그러면 소설 한 편이 레벨 색이 칠해진 채로 뜬다.
   */
  it('산문 속의 낱말을 레벨로 보지 않는다', () => {
    expect(parseLogLevel('이 함수는 error 값을 돌려주지 않는다')).toBeNull()
    expect(parseLogLevel('사용자에게 warning 문구를 보여 줄지 정해야 한다')).toBeNull()
  })

  it('낱말 가운데에 든 것을 레벨로 보지 않는다', () => {
    expect(parseLogLevel('ERROR_CODE,MESSAGE,COUNT')).toBeNull()
    expect(parseLogLevel('const INFORMATIONAL = 1')).toBeNull()
  })

  it('줄 뒤쪽의 낱말은 본문으로 본다', () => {
    // 레벨 자리가 비어 있고 본문 끝에만 낱말이 있는 줄. 앞쪽만 보지 않으면 오류가 된다.
    const long = `2026-09-20 12:01:35 사용자가 ${'가'.repeat(200)} 라고 적었다: ERROR`
    expect(parseLogLevel(long)).toBeNull()
    // 앞쪽에 제대로 적힌 레벨은 본문에 무엇이 오든 그대로 읽는다.
    expect(parseLogLevel(`2026-09-20 12:01:35 [INFO] ${'가'.repeat(200)} ERROR`)).toBe('info')
  })

  it('레벨이 없으면 null이다', () => {
    expect(parseLogLevel('그냥 한 줄')).toBeNull()
    expect(parseLogLevel('')).toBeNull()
  })

  it('INFO와 INFORMATION을 헷갈리지 않는다', () => {
    expect(parseLogLevel('[INFORMATION] 알림')).toBe('info')
    expect(parseLogLevel('[WARNING] 알림')).toBe('warn')
    expect(parseLogLevel('[ERROR] 알림')).toBe('error')
  })
})

describe('hasLogTimestamp', () => {
  it('흔한 앞머리 시각들을 알아본다', () => {
    expect(hasLogTimestamp('2026-09-20T12:01:35.123Z 시작')).toBe(true)
    expect(hasLogTimestamp('2026/09/20 12:01 시작')).toBe(true)
    expect(hasLogTimestamp('[12:01:35] 시작')).toBe(true)
  })

  it('줄 뒤쪽의 시각은 앞머리가 아니다', () => {
    expect(hasLogTimestamp('예약 시각은 12:01:35 입니다')).toBe(false)
  })
})

describe('looksLikeLog', () => {
  const LOG = lines(`
2026-09-20 12:01:30 [INFO] 서버 시작
2026-09-20 12:01:31 [INFO] 포트 8080 대기
2026-09-20 12:01:35 [ERROR] 연결 실패
2026-09-20 12:01:35 [WARN] 다시 시도합니다
2026-09-20 12:01:40 [INFO] 연결됨
`)

  it('로그를 로그로 본다', () => {
    expect(looksLikeLog(LOG)).toBe(true)
  })

  /*
   * 절반을 기준으로 두면 이 시험이 실패한다. 예외 하나가 스무 줄을 차지하는데
   * 레벨이 붙은 줄은 첫 줄뿐이라, 스택 트레이스가 많은 로그가 통째로 빠진다.
   */
  it('스택 트레이스가 길어도 로그로 본다', () => {
    const withStack = [
      ...LOG,
      ...Array.from({ length: 8 }, (_, index) => `\tat com.example.Thing.run(Thing.java:${index})`),
    ]
    expect(looksLikeLog(withStack)).toBe(true)
  })

  it('산문을 로그로 보지 않는다', () => {
    expect(
      looksLikeLog(
        lines(`
홀로그램 데이터 뷰어는 파일을 공간에 놓고 보는 도구다.
표를 3D 점으로 바꾸고, 점을 고르면 표가 따라 좁혀진다.
손으로 카메라를 돌릴 수 있지만 마우스만으로도 전부 된다.
이 문서는 그 설계를 적어 둔 것이다.
읽는 사람은 프런트엔드 개발자를 가정한다.
아직 정하지 못한 것은 따로 표로 모아 두었다.
`),
      ),
    ).toBe(false)
  })

  it('CSV를 로그로 보지 않는다', () => {
    expect(
      looksLikeLog(
        lines(`
이름,분류,값
김한글,배송,12
박세종,환불,7
이순신,배송,3
최무선,문의,9
정약용,환불,4
`),
      ),
    ).toBe(false)
  })

  it('줄이 몇 개 없으면 로그로 보지 않는다', () => {
    expect(looksLikeLog(['[ERROR] 하나', '[ERROR] 둘'])).toBe(false)
  })
})

describe('looksLikeMarkdown', () => {
  it('표시가 둘 이상이면 마크다운으로 본다', () => {
    expect(
      looksLikeMarkdown(
        lines(`
# 제목

- 첫째
- 둘째
`),
      ),
    ).toBe(true)
  })

  it('표시가 하나뿐이면 마크다운으로 보지 않는다', () => {
    // '- '로 시작하는 줄 하나는 그냥 글머리표를 쓴 평문일 수 있다.
    expect(
      looksLikeMarkdown(
        lines(`
장 보기
- 우유
`),
      ),
    ).toBe(false)
  })
})

describe('flavorOf', () => {
  it('확장자가 못 박으면 내용을 보지 않는다', () => {
    // 마크다운 표시가 하나도 없는 .md도 마크다운이다. 제목만 적은 메모가 그렇다.
    expect(flavorOf('메모.md', ['그냥 한 줄'])).toBe('markdown')
    // 산문만 든 .log도 로그다. 사람이 그렇게 이름 붙였다.
    expect(flavorOf('app.log', ['그냥 한 줄'])).toBe('log')
    expect(flavorOf('Workspace.tsx', ['const a = 1'])).toBe('code')
  })

  it('확장자가 애매하면 내용을 본다', () => {
    const log = lines(`
2026-09-20 12:01:30 [INFO] 서버 시작
2026-09-20 12:01:31 [INFO] 포트 대기
2026-09-20 12:01:35 [ERROR] 연결 실패
2026-09-20 12:01:36 [WARN] 재시도
2026-09-20 12:01:40 [INFO] 연결됨
`)
    expect(flavorOf('출력.txt', log)).toBe('log')
    expect(flavorOf('읽어주세요.txt', lines('# 제목\n\n- 하나\n- 둘'))).toBe('markdown')
    expect(flavorOf('메모.txt', ['오늘 할 일을 적어 둔다'])).toBe('plain')
  })

  it('확장자가 없어도 터지지 않는다', () => {
    expect(flavorOf('README', ['그냥 한 줄'])).toBe('plain')
  })
})

describe('extensionsOfFlavor', () => {
  it('갈래별로 갈라 준다', () => {
    expect(extensionsOfFlavor('log')).toEqual(['log'])
    expect(extensionsOfFlavor('markdown')).toContain('md')
    expect(extensionsOfFlavor('code')).toContain('tsx')
    // 갈래가 겹치면 형식 표에서 같은 확장자가 두 줄에 걸린다.
    expect(extensionsOfFlavor('code')).not.toContain('md')
    expect(extensionsOfFlavor('markdown')).not.toContain('log')
  })

  it('모르는 확장자는 null이다', () => {
    expect(flavorOfExtension('csv')).toBeNull()
    expect(flavorOfExtension('glb')).toBeNull()
  })
})
