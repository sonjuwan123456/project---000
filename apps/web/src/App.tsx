import { EmptyWorkspace } from './EmptyWorkspace'

export function App() {
  return (
    <main style={{ position: 'relative', height: '100%' }}>
      <EmptyWorkspace />

      <div
        style={{
          position: 'absolute',
          inset: 'auto auto 3rem 3rem',
          maxWidth: '32ch',
          pointerEvents: 'none',
        }}
      >
        <h1 style={{ fontSize: '2.25rem', fontWeight: 400, margin: 0 }}>빈 작업 공간</h1>
        <p style={{ color: 'var(--holo-dim)', marginTop: '0.75rem', lineHeight: 1.6 }}>
          파일을 끌어다 놓으면 여기에 펼쳐진다. 불러오기는 M1에서 붙인다.
        </p>
      </div>
    </main>
  )
}
