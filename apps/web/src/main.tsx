import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { cssVariables } from '@holo/core'
import { App } from './App'
import './global.css'

/**
 * 색상 토큰을 CSS 변수로 심는다. 값의 출처는 packages/core의 palette.ts 하나뿐이고,
 * 셰이더 팔레트도 같은 파일에서 나온다. CSS와 GLSL에 색을 따로 적지 않기 위한 것이다.
 */
for (const [name, value] of Object.entries(cssVariables())) {
  document.documentElement.style.setProperty(name, value)
}

const container = document.getElementById('root')
if (!container) throw new Error('#root 엘리먼트를 찾을 수 없다.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
