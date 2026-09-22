import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 仅原生模块保持 external（无法被 bundle），其余依赖全部打进产物，
// 使打包后的 app.asar 无需携带全部 node_modules，显著缩小安装包体积。
// 注意：main 与 worker 入口经 utilityProcess 加载，必须输出 CJS
// （package.json 为 type:module 时 rollup 默认输出 ESM，需显式指定 format）。
const nativeOnly = externalizeDepsPlugin({ include: ['better-sqlite3', 'sharp'] })
const cjs = { format: 'cjs' as const }

export default defineConfig({
  main: { plugins: [nativeOnly], build: { rollupOptions: { input: { index: resolve('apps/desktop/src/main/index.ts'), database: resolve('apps/desktop/src/workers/database.ts'), indexer: resolve('apps/desktop/src/workers/indexer.ts'), images: resolve('apps/desktop/src/workers/images.ts') }, output: cjs } } },
  preload: { plugins: [nativeOnly], build: { rollupOptions: { input: resolve('apps/desktop/src/preload/index.ts'), output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { root: 'apps/desktop/src/renderer', plugins: [react()], build: { minify: 'esbuild', sourcemap: false, rollupOptions: { input: resolve('apps/desktop/src/renderer/index.html') } } }
})
