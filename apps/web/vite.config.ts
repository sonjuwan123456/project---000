import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@holo/core': resolve('../../packages/core/src/index.ts'),
      '@holo/data': resolve('../../packages/data/src/index.ts'),
      '@holo/views': resolve('../../packages/views/src/index.ts'),
      '@holo/holo-fx': resolve('../../packages/holo-fx/src/index.ts'),
      '@holo/input': resolve('../../packages/input/src/index.ts'),
    },
  },
})
