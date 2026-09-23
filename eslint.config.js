import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * 설계 문서 3장의 층 구조를 그대로 옮긴 표다.
 * 위층은 아래층만 알고, 아래층은 위층을 모른다.
 * 각 패키지가 import 해도 되는 내부 패키지만 적는다.
 */
const ALLOWED_DEPENDENCIES = {
  'packages/core': [],
  'packages/data': ['@holo/core'],
  'packages/holo-fx': ['@holo/core'],
  'packages/input': ['@holo/core'],
  'packages/views': ['@holo/core', '@holo/data', '@holo/holo-fx'],
  'apps/web': ['@holo/core', '@holo/data', '@holo/views', '@holo/holo-fx', '@holo/input'],
}

const ALL_INTERNAL = Object.values(ALLOWED_DEPENDENCIES).flat()
const INTERNAL_PACKAGES = [...new Set(ALL_INTERNAL)]

const layerBoundaries = Object.entries(ALLOWED_DEPENDENCIES).map(([dir, allowed]) => {
  const forbidden = INTERNAL_PACKAGES.filter((name) => !allowed.includes(name))
  return {
    files: [`${dir}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: forbidden.map((name) => ({
            name,
            message: `${dir}은(는) ${name}에 의존할 수 없다. 설계 문서 3장의 층 구조를 확인할 것.`,
          })),
        },
      ],
    },
  }
})

export default tseslint.config(
  // 샘플은 코드가 아니라 데이터다. 문법 강조가 무엇을 갈라 주는지 보려고 둔 파일이라,
  // 쓰지 않는 값이나 돌아가지 않는 조각이 일부러 들어 있다.
  { ignores: ['**/dist/**', '**/coverage/**', 'samples/예시.*'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  ...layerBoundaries,
)
