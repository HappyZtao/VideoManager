import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('apps/desktop/src/main/index.ts'), database: resolve('apps/desktop/src/workers/database.ts'), indexer: resolve('apps/desktop/src/workers/indexer.ts'), images: resolve('apps/desktop/src/workers/images.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('apps/desktop/src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { root: 'apps/desktop/src/renderer', plugins: [react()], build: { rollupOptions: { input: resolve('apps/desktop/src/renderer/index.html') } } }
})
