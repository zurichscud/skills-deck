import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared')
    }
  }
})
