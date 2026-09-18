import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@holo/core': resolve('./packages/core/src/index.ts'),
      '@holo/data': resolve('./packages/data/src/index.ts'),
      '@holo/views': resolve('./packages/views/src/index.ts'),
      '@holo/holo-fx': resolve('./packages/holo-fx/src/index.ts'),
      '@holo/input': resolve('./packages/input/src/index.ts'),
    },
  },
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'],
  },
})
