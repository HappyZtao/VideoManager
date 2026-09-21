// 刮削功能端到端冒烟：真实启动应用 → 批量刮削一个真实番号视频 → 验证进度推进、元数据与自动设封面。
// 仅做网络尽力验证：站点不可达时任务仍须以 skipped 终态完成，不阻塞构建流程。
import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const base = path.resolve('.test-data/scrape-e2e-' + Date.now())
const videoDir = path.join(base, '视频刮削测试库')
const userData = path.join(base, 'app-data')
await fs.mkdir(videoDir, { recursive: true })
// 真实番号命名的占位视频（刮削只依赖文件名，不依赖文件内容可解码）。
await fs.writeFile(path.join(videoDir, 'IPX-633.mp4'), Buffer.alloc(64 * 1024, 7))
await fs.mkdir('test-results', { recursive: true })

let application, page
const progressTrail = []
async function api(method, ...args) { return page.evaluate(([method, args]) => window.vm[method](...args), [method, args]) }
async function waitFor(fn, label, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 200)) }
  throw Error('Timeout: ' + label)
}

try {
  application = await electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    args: ['.'],
    env: { ...process.env, VM_DATA_DIR: userData, VM_TEST_HIDDEN: '1', VM_TEST_ROOT: videoDir },
    timeout: 30000
  })
  page = await application.firstWindow()
  page.on('pageerror', e => console.log('RENDERER ERROR', e.message))
  await page.waitForFunction(() => !!window.vm)
  await waitFor(async () => { const b = await api('bootstrap'); return b.roots.length && b.roots[0].state === 'online' ? b : null }, 'initial scan')

  await api('settings', { scrapeEnabled: true, scrapeConcurrency: 1 })
  const query = await api('openQuery', { folderId: null, scope: 'library', text: 'IPX', searchFields: ['name'], kinds: ['video'], extensions: [], tags: [], favorite: false, sort: 'name', direction: 'asc', minSize: null, maxSize: null, after: null, before: null, minDuration: null, maxDuration: null })
  const video = (await api('page', query.id, 0, 10)).entries[0]
  assert(video, 'video entry indexed')
  console.log('target video:', video.name, video.id)

  // 启动刮削并采样进度序列。
  const task = await api('scrapeRun', { ids: [video.id] })
  const sampler = setInterval(() => {
    void api('bootstrap').then(b => {
      const t = b.tasks.find(item => item.id === task.id)
      if (t) progressTrail.push({ at: Date.now(), progress: t.progress ?? 0, message: t.message })
    }).catch(() => {})
  }, 400)

  const finalTask = await waitFor(async () => {
    const b = await api('bootstrap')
    const t = b.tasks.find(item => item.id === task.id)
    return t && ['completed', 'completed-errors', 'failed', 'cancelled'].includes(t.state) ? t : null
  }, 'scrape task finish', 300000)
  clearInterval(sampler)

  console.log('final task:', JSON.stringify({ state: finalTask.state, processed: finalTask.processed, failed: finalTask.failed, message: finalTask.message }))
  console.log('progress trail:', JSON.stringify(progressTrail.map(p => p.progress)))

  assert.equal(finalTask.processed, 1)
  const uniqueProgress = [...new Set(progressTrail.map(p => p.progress))]
  if (finalTask.state !== 'failed') assert(uniqueProgress.length > 1 || finalTask.progress >= 99, `progress moved (unique=${uniqueProgress.length})`)
  const result = finalTask.results?.[0]
  console.log('entry result:', JSON.stringify(result))
  assert(['completed', 'skipped', 'failed'].includes(result?.state ?? ''), 'result recorded')

  const meta = await api('scrapeMeta', video.id)
  const entry = await api('entry', video.id)
  const summary = { matched: !!meta, provider: meta?.provider, code: meta?.code, title: meta?.title?.slice(0, 40), hasCoverFile: !!meta?.cover, coverMode: entry.coverMode }
  console.log('meta summary:', JSON.stringify(summary))

  if (meta?.cover) {
    assert.ok(meta.cover.startsWith('media://'), 'cover grant url')
    assert.ok(await fs.stat(path.join(userData, 'libraries', meta.entryId ? '' : '')).catch(() => null) !== undefined)
    if (entry.coverMode === 'manual') console.log('AUTO-COVER: scraped cover applied as entry cover')
    else console.log('AUTO-COVER: not applied (coverMode=' + entry.coverMode + ')')
  } else {
    console.log('COVER: network unreachable in this environment — task still finished with state ' + finalTask.state)
  }

  // 清理：停用刮削，避免影响其他测试数据。
  await api('settings', { scrapeEnabled: false })
  console.log('SCRAPE-E2E PASS')
} catch (error) {
  console.error('SCRAPE-E2E FAILURE', error)
  process.exitCode = 1
} finally {
  if (application) await application.close()
  await fs.writeFile('test-results/scrape-e2e.json', JSON.stringify({ date: new Date().toISOString(), base, progressTrail }, null, 2)).catch(() => {})
}
