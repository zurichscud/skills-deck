import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const r = (p: string): string => resolve(import.meta.dirname, p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') },
    },
    build: {
      rollupOptions: {
        input: { index: r('src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') },
    },
    build: {
      rollupOptions: {
        input: { index: r('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@': r('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: r('src/renderer/index.html') },
      },
    },
  },
})
