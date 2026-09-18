# 홀로그램 데이터 뷰어

데이터를 연결하면 군집, 표, 그래프, 3D 모델, 문서가 하나의 3D 공간에 펼쳐지고, 어느 뷰에서
데이터를 골라도 모든 뷰가 함께 반응하는 공간형 분석 캔버스.

설계 문서와 요구사항 정리는 이 저장소 밖(프로젝트 자료)에 있다. 가칭 `holoviewer`.

## 시작하기

```bash
pnpm install
pnpm dev        # apps/web 개발 서버
pnpm check      # 포맷·린트·타입·테스트 한 번에
```

Node 22 이상, pnpm 10 이상이 필요하다.

## 저장소 구조

| 패키지 | 역할 | 상태 |
| --- | --- | --- |
| `apps/web` | React 앱, HUD, 작업 공간 화면 | 빈 작업 공간 화면만 |
| `packages/core` | 개념 모델 타입, 스키마, 명령 체계, 공용 수학 함수 | 수학 함수만 |
| `packages/data` | 로더 레지스트리, Arrow 데이터층, 계산 워커 | 껍데기 (M1·M2) |
| `packages/views` | 뷰 레지스트리와 뷰 구현 | 껍데기 (M2·M3) |
| `packages/holo-fx` | 홀로그램 셰이더, 등장 연출, 후처리 | 껍데기 (M2) |
| `packages/input` | 제스처 해석, 손 추적, 입력-명령 연결 | 껍데기 (M6) |

설계 문서의 `packages/sdk-js`는 2단계 항목이라 아직 만들지 않았다.

### 의존 방향

위층은 아래층만 알고, 아래층은 위층을 모른다.

```
apps/web  →  views  →  data ┐
              ↓  holo-fx    ├→  core
             input ─────────┘
```

이 방향은 문서로만 두지 않고 `eslint.config.js`의 `ALLOWED_DEPENDENCIES` 표로 강제한다.
`packages/core`에서 `@holo/views`를 import 하면 `pnpm lint`가 막는다. 층 구조가 바뀌면
그 표를 고치는 것이 곧 규칙을 고치는 것이다.

## 버전 조합

`pnpm install`로 확인한 결과이며, 깨지기 쉬운 두 곳은 범위가 아니라 값으로 고정했다.

| 대상 | 정한 값 | 이유 |
| --- | --- | --- |
| react, react-dom | **19.2.8 고정** | `@react-three/fiber@9.7.0`의 peer가 `react >=19 <19.3`이다. 최신인 19.3.0을 쓰면 조합이 깨진다 |
| typescript | **~5.9.3** | `typescript-eslint@8.70.0`의 peer가 `typescript >=4.8.4 <6.1.0`이다. 최신인 7.0.2는 아직 못 쓴다 |

나머지는 최신을 그대로 썼다. three 0.186, R3F 9.7, drei 10.7, postprocessing 6.39,
`@react-three/postprocessing` 3.1, uikit 1.0.76, Vite 8.3, Vitest 5.0, ESLint 10.10.
다섯 3D 라이브러리 모두 이 조합에서 타입 검사와 빌드를 통과한다.

`@react-three/uikit`은 M5의 3D 공간 소형 컨트롤에서 쓸 예정이라 설치만 해 두었고,
호환은 임시 파일로 타입 검사까지 확인한 뒤 지웠다. 아직 어디서도 import 하지 않는다.

## 아직 없는 것

- 프로토타입에서 재사용하기로 한 코드(`gesture/gestures.ts`, `utils/math.ts`,
  홀로그램·발광 점 재질, `CameraRig`, `HandCursors` 등). 원본 프로젝트를 아직 받지 못했다.
- 색상 토큰 통합. 지금은 `apps/web/src/global.css`에 CSS 변수 세 개만 있고,
  TypeScript 하나에서 CSS 변수와 셰이더 팔레트를 함께 만드는 구조는 만들지 않았다.
- CI. 워크플로 파일이 없다.
- 기준 기기 사양. 60fps를 잴 대상이 아직 정해지지 않았다.
