// 视频元数据刮削服务：批量任务、单条预览与手动应用、封面下载与落盘。
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import type { Entry, ScrapeCandidate, ScrapeInfo, ScrapeMeta, ScrapePreview, ScrapeProviderInfo, ScrapeStats, Selection, Task } from '../../../../packages/contracts'
import type { WorkerClient } from './worker'
import type { MediaService } from './media'
import { extractCodesFromName } from './scrape/parse'
import { providers, providerById } from './scrape/providers'
import { ScrapeNotFound, downloadImage } from './scrape/http'

const LOG_NAME = 'scrape.log'
const LOG_MAX_BYTES = 5 * 1024 * 1024
const COVERS_DIR = 'scrape-covers'

type TaskControl = { cancel: boolean }

export class ScrapeService {
  private controls = new Map<string, TaskControl>()
  constructor(private dataDir: string, private db: WorkerClient, private media: MediaService, private emit: (task: Task) => void, private changed: () => void, private onEntryChanged?: (entry: Entry) => void) {}

  private async settings(): Promise<Record<string, unknown>> { return this.db.call<Record<string, unknown>>('settings') }

  private async assertEnabled(): Promise<void> {
    const settings = await this.settings()
    if (!settings.scrapeEnabled) throw Error('视频刮削未启用，请先在「设置 → 视频刮削」中开启')
  }

  private async activeProviders(): Promise<string[]> {
    const settings = await this.settings()
    const configured = Array.isArray(settings.scrapeProviders) ? settings.scrapeProviders.filter(id => typeof id === 'string' && providerById(id)) : []
    return configured.length ? configured : providers.filter(provider => provider.kind === 'movie').map(provider => provider.id)
  }

  private async concurrency(): Promise<number> {
    const settings = await this.settings()
    return Math.max(1, Math.min(8, Math.round(Number(settings.scrapeConcurrency) || 2)))
  }

  private coversDir(): string { return path.join(this.dataDir, COVERS_DIR) }

  // 封面下载的 Referer：部分站点（如 JavBus）校验来源，其余回退到图片自身的站点。
  private coverReferer(provider: string, coverUrl: string): string {
    const known: Record<string, string> = {
      javbus: 'https://www.javbus.com/',
      javdb: 'https://javdb.com/',
      avmoo: 'https://avmoo.shop/',
      avsox: 'https://avsox.click/',
      javmenu: 'https://javmenu.com/',
      javdatabase: 'https://www.javdatabase.com/'
    }
    try { return known[provider] ?? new URL(coverUrl).origin + '/' } catch { return known[provider] ?? coverUrl }
  }

  // 公开日志入口：记录代理检测等系统级事件。
  async logEvent(event: string, subject: string, detail?: unknown): Promise<void> { return this.log(event, subject, detail) }

  // 刮削日志：JSON 行追加，超过 5MB 时轮转保留最近内容。
  private async log(event: string, subject: string, detail?: unknown): Promise<void> {
    try {
      const file = path.join(this.dataDir, 'logs', LOG_NAME)
      await fs.mkdir(path.dirname(file), { recursive: true })
      const stat = await fs.stat(file).catch(() => null)
      if (stat && stat.size > LOG_MAX_BYTES) {
        const content = await fs.readFile(file, 'utf8').catch(() => '')
        await fs.writeFile(file, content.slice(Math.floor(content.length / 2)))
      }
      const line = { at: new Date().toISOString(), event, subject: subject.slice(0, 200), ...(detail !== undefined ? { detail: String(detail).slice(0, 600) } : {}) }
      await fs.appendFile(file, JSON.stringify(line) + '\n')
    } catch { /* 日志失败不影响刮削 */ }
  }

  // 依次尝试候选番号与数据源，返回第一个成功结果。
  // hooks.onProvider 在每个数据源开始查询时回调（用于进度细分）；budgetMs 限制单条目总查询时长，超时后跳过剩余数据源。
  private async lookupFirst(name: string, providerIds: string[], hooks?: {
    onProvider?: (index: number, total: number, providerId: string, code: string) => void
    budgetMs?: number
  }): Promise<ScrapeInfo | null> {
    const codes = extractCodesFromName(name)
    if (!codes.length) throw Error('无法从文件名解析出番号')
    const errors: string[] = []
    const startedAt = Date.now()
    const budgetMs = hooks?.budgetMs ?? 120000
    const active = providerIds.filter(id => providerById(id))
    let index = 0
    for (const providerId of active) {
      const provider = providerById(providerId)!
      if (Date.now() - startedAt > budgetMs) {
        errors.push(`查询预算（${Math.round(budgetMs / 1000)} 秒）耗尽，跳过 ${provider.label} 等剩余数据源`)
        break
      }
      hooks?.onProvider?.(index++, active.length, provider.id, codes[0] ?? '')
      for (const code of codes.slice(0, 3)) {
        try {
          const info = await provider.lookup(code)
          if (info) { await this.log('matched', name, `${provider.id} · ${info.code} · ${info.title}`); return info }
        } catch (error) {
          if (error instanceof ScrapeNotFound) break // 该站无此番号，换下一个数据源
          errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
      }
    }
    if (errors.length) await this.log('provider-errors', name, errors.join(' | '))
    return null
  }

  private grantCover(file: string): string | null {
    try { return this.media.grant(file, 'image/jpeg') } catch { return null }
  }

  private toMeta(row: Record<string, unknown>): ScrapeMeta {
    const coverFile = String(row.coverFile ?? '')
    return {
      entryId: String(row.entryId),
      provider: String(row.provider ?? ''),
      code: String(row.code ?? ''),
      title: String(row.title ?? ''),
      studio: String(row.studio ?? ''),
      series: String(row.series ?? ''),
      releaseDate: String(row.releaseDate ?? ''),
      durationMin: Number(row.durationMin ?? 0),
      tags: Array.isArray(row.tags) ? row.tags as string[] : [],
      actors: Array.isArray(row.actors) ? row.actors as string[] : [],
      description: String(row.description ?? ''),
      coverUrl: String(row.coverUrl ?? ''),
      status: row.status === 'manual' ? 'manual' : 'auto',
      scrapedAt: Number(row.scrapedAt ?? 0),
      cover: coverFile ? this.grantCover(coverFile) : null,
      isUncensored: row.isUncensored === null || row.isUncensored === undefined ? null : Boolean(row.isUncensored)
    }
  }

  // 下载封面（若可用）并写库；开启自动设封面时，把下载的封面应用为条目手动封面。
  private async persist(entryId: string, info: ScrapeInfo, status: 'auto' | 'manual', downloadCover: boolean, autoSetCover: boolean): Promise<ScrapeMeta> {
    let coverFile = ''
    if (downloadCover && info.coverUrl) {
      try {
        await fs.mkdir(this.coversDir(), { recursive: true })
        const file = path.join(this.coversDir(), `${entryId}.jpg`)
        await downloadImage(info.coverUrl, file, { referer: this.coverReferer(info.provider, info.coverUrl), intervalMs: 400, retries: 1 })
        coverFile = file
      } catch (error) {
        await this.log('cover-failed', entryId, `${info.coverUrl} → ${error instanceof Error ? error.message : error}`)
      }
    }
    const row = {
      entryId, code: info.code, title: info.title, originalTitle: '', studio: info.studio, series: info.series,
      releaseDate: info.releaseDate, durationMin: info.durationMin, actors: info.actors, tags: info.tags,
      description: info.description, coverUrl: info.coverUrl, coverFile, provider: info.provider, status, scrapedAt: Date.now()
    }
    await this.db.call('scrapePut', entryId, row)
    if (coverFile && autoSetCover) {
      try {
        const entry = await this.media.saveExternalCover(entryId, coverFile)
        this.onEntryChanged?.(entry)
      } catch (error) {
        await this.log('autocover-failed', entryId, `${coverFile} → ${error instanceof Error ? error.message : error}`)
      }
    }
    return this.toMeta(row)
  }

  // 预览缓存：temp 下按 URL 哈希缓存，供刮削弹窗显示候选封面。
  private async previewCover(url: string): Promise<string | null> {
    try {
      const key = createHash('sha1').update(url).digest('hex').slice(0, 24)
      const file = path.join(this.dataDir, 'temp', 'scrape-preview', `${key}.jpg`)
      await fs.access(file).catch(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await downloadImage(url, file, { intervalMs: 300, retries: 0 })
      })
      return this.grantCover(file)
    } catch { return null }
  }

  async providersInfo(): Promise<ScrapeProviderInfo[]> {
    return providers.map(({ id, label, description, kind }) => ({ id, label, description, kind }))
  }

  async stats(): Promise<ScrapeStats> { return this.db.call<ScrapeStats>('scrapeStats') }

  async meta(entryId: string): Promise<ScrapeMeta | null> {
    const row = await this.db.call<Record<string, unknown> | null>('scrapeGet', entryId)
    return row ? this.toMeta(row) : null
  }

  // 并发查询所有启用数据源，返回候选列表供手动选择。
  async preview(entryId: string): Promise<ScrapePreview> {
    await this.assertEnabled()
    const entry = await this.db.call<Entry>('entry', entryId)
    if (entry.kind !== 'video') throw Error('只能对视频文件刮削元数据')
    const codes = extractCodesFromName(entry.name)
    const providerIds = await this.activeProviders()
    const candidates = await Promise.all(providerIds.map(async providerId => {
      const provider = providerById(providerId)!
      try {
        if (!codes.length) throw new ScrapeNotFound()
        let info: ScrapeInfo | null = null
        for (const code of codes.slice(0, 3)) {
          try { info = await provider.lookup(code); break } catch (error) { if (!(error instanceof ScrapeNotFound)) throw error }
        }
        if (!info) throw new ScrapeNotFound()
        const cover = info.coverUrl ? await this.previewCover(info.coverUrl) : null
        return { provider: provider.id, label: provider.label, ok: true, info, cover }
      } catch (error) {
        const message = error instanceof ScrapeNotFound ? '未找到匹配结果' : error instanceof Error ? error.message : String(error)
        await this.log('preview-error', entry.name, `${provider.id}: ${message}`)
        return { provider: provider.id, label: provider.label, ok: false, error: message, cover: null }
      }
    }))
    return { entryId, codes, candidates, meta: await this.meta(entryId) }
  }

  // 只查询单个数据源，返回候选（不写库），用于手动重试某个站点。
  async searchOne(entryId: string, providerId: string): Promise<ScrapeCandidate> {
    await this.assertEnabled()
    const provider = providerById(providerId)
    if (!provider) throw Error('未知的数据源')
    const entry = await this.db.call<Entry>('entry', entryId)
    if (entry.kind !== 'video') throw Error('只能对视频文件刮削元数据')
    const codes = extractCodesFromName(entry.name)
    try {
      if (!codes.length) throw new ScrapeNotFound()
      let info: ScrapeInfo | null = null
      for (const code of codes.slice(0, 3)) {
        try { info = await provider.lookup(code); break } catch (error) { if (!(error instanceof ScrapeNotFound)) throw error }
      }
      if (!info) throw new ScrapeNotFound()
      const cover = info.coverUrl ? await this.previewCover(info.coverUrl) : null
      return { provider: provider.id, label: provider.label, ok: true, info, cover }
    } catch (error) {
      const message = error instanceof ScrapeNotFound ? '未找到匹配结果' : error instanceof Error ? error.message : String(error)
      await this.log('preview-error', entry.name, `${provider.id}: ${message}`)
      return { provider: provider.id, label: provider.label, ok: false, error: message, cover: null }
    }
  }

  // 用指定数据源重新查询并应用结果（手动选择）。
  async apply(entryId: string, providerId: string): Promise<ScrapeMeta> {
    await this.assertEnabled()
    const provider = providerById(providerId)
    if (!provider) throw Error('未知的数据源')
    const entry = await this.db.call<Entry>('entry', entryId)
    if (entry.kind !== 'video') throw Error('只能对视频文件刮削元数据')
    const codes = extractCodesFromName(entry.name)
    if (!codes.length) throw Error('无法从文件名解析出番号')
    let info: ScrapeInfo | null = null
    for (const code of codes.slice(0, 3)) {
      try { info = await provider.lookup(code); break } catch (error) { if (!(error instanceof ScrapeNotFound)) throw error }
    }
    if (!info) throw Error('该数据源未找到匹配结果')
    const settings = await this.settings()
    const meta = await this.persist(entryId, info, 'manual', true, settings.scrapeAutoSetCover !== false)
    await this.log('applied', entry.name, `${provider.id} · ${info.code}`)
    this.changed()
    return meta
  }

  // 把已刮削的封面应用为条目手动封面。
  async setCover(entryId: string): Promise<Entry> {
    const row = await this.db.call<Record<string, unknown> | null>('scrapeGet', entryId)
    const file = row ? String(row.coverFile ?? '') : ''
    if (!file) throw Error('尚未刮削到封面，无法设置为条目封面')
    await fs.access(file)
    const entry = await this.db.call<Entry>('entry', entryId)
    const quality = (entry.coverQuality === 'original' ? 'high' : entry.coverQuality ?? 'balanced') as 'high' | 'balanced' | 'fast' | 'compact'
    return this.media.saveExternalCover(entryId, file, quality)
  }

  async clear(entryId: string): Promise<void> {
    await this.db.call('scrapeDelete', entryId)
    await fs.rm(path.join(this.coversDir(), `${entryId}.jpg`), { force: true })
    this.changed()
  }

  // 导出 Kodi 兼容的 NFO 与海报：写到视频同目录（<文件名>.nfo + <文件名>-poster.jpg）。
  async exportNfo(entryIds: string[]): Promise<{ written: number; skipped: number }> {
    const escape = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char)
    let written = 0
    let skipped = 0
    for (const entryId of entryIds) {
      try {
        const entry = await this.db.call<Entry>('entry', entryId)
        if (entry.kind !== 'video') { skipped++; continue }
        const row = await this.db.call<Record<string, unknown> | null>('scrapeGet', entryId)
        if (!row || (!row.code && !row.title)) { skipped++; continue }
        const file = await this.media.sourcePath(entry)
        const base = entry.ext ? file.slice(0, -(entry.ext.length + 1)) : file
        const tags = Array.isArray(row.tags) ? row.tags as string[] : []
        const actors = Array.isArray(row.actors) ? row.actors as string[] : []
        const year = /^\d{4}/.test(String(row.releaseDate)) ? String(row.releaseDate).slice(0, 4) : ''
        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
  <title>${escape(String(row.title ?? ''))}</title>
  <originaltitle>${escape(String(row.originalTitle ?? row.title ?? ''))}</originaltitle>
  <uniqueid type="${escape(String(row.provider ?? 'custom'))}" default="true">${escape(String(row.code ?? ''))}</uniqueid>
  <studio>${escape(String(row.studio ?? ''))}</studio>
  <set>${escape(String(row.series ?? ''))}</set>
  <premiered>${escape(String(row.releaseDate ?? ''))}</premiered>
  <year>${year}</year>
  <runtime>${Number(row.durationMin ?? 0)}</runtime>
  <mpaa>XXX</mpaa>
  <plot>${escape(String(row.description ?? ''))}</plot>
  <outline>${escape(String(row.description ?? ''))}</outline>
${actors.map(actor => `  <actor><name>${escape(actor)}</name><type>Actor</type></actor>`).join('\n')}
${tags.map(tag => `  <genre>${escape(tag)}</genre>\n  <tag>${escape(tag)}</tag>`).join('\n')}
  <fileinfo><streamdetails><durationinseconds>${Number(row.durationMin ?? 0) * 60}</durationinseconds></streamdetails></fileinfo>
</movie>
`
        await fs.writeFile(`${base}.nfo`, xml, 'utf8')
        const coverFile = String(row.coverFile ?? '')
        if (coverFile) {
          try { await fs.access(coverFile); await fs.copyFile(coverFile, `${base}-poster.jpg`) } catch { /* 海报缺失不阻断 NFO */ }
        }
        written++
        await this.log('nfo-exported', entry.name, `${base}.nfo`)
      } catch (error) {
        skipped++
        await this.log('nfo-failed', entryId, error instanceof Error ? error.message : String(error))
      }
    }
    return { written, skipped }
  }

  // 批量刮削：按数据源优先级逐个尝试，首个成功结果自动应用。
  async run(selection: Selection): Promise<Task> {
    await this.assertEnabled()
    if (this.controls.size) throw Error('已有刮削任务正在进行，请等待完成或取消')
    const targets = await this.db.call<Entry[]>('scrapeTargets', selection)
    if (!targets.length) throw Error('所选内容中不包含视频文件')
    const id = randomUUID()
    const task: Task = {
      id, kind: 'scrape', name: `刮削元数据 · ${targets.length} 个视频`, state: 'running',
      discovered: targets.length, processed: 0, total: targets.length, failed: 0,
      message: '正在开始刮削', progress: 0, results: []
    }
    const control: TaskControl = { cancel: false }
    this.controls.set(id, control)
    this.emit({ ...task })
    void this.execute(task, targets, control).catch(error => {
      task.state = 'failed'; task.message = String(error); this.emit({ ...task }); this.controls.delete(id)
      void this.log('task-failed', task.name, error)
    })
    return task
  }

  private async execute(task: Task, targets: Entry[], control: TaskControl): Promise<void> {
    try {
      const providerIds = await this.activeProviders()
      const settings = await this.settings()
      const downloadCover = settings.scrapeDownloadCover !== false
      const autoSetCover = settings.scrapeAutoSetCover !== false
      const concurrency = Math.max(1, Math.min(8, Math.round(Number(settings.scrapeConcurrency) || 2)))
      let cursor = 0
      const advance = (value: number) => { task.progress = Math.max(task.progress ?? 0, Math.min(99, Math.round(value))) }
      const worker = async () => {
        while (cursor < targets.length) {
          if (control.cancel) { task.state = 'cancelled'; return }
          const entry = targets[cursor++]!
          task.message = `刮削 · ${entry.name}`
          this.emit({ ...task })
          try {
            const info = await this.lookupFirst(entry.name, providerIds, {
              onProvider: (index, total, providerId, code) => {
                // 进度细分到数据源粒度：条目内部的查询进度也会推进进度条，避免长时间停在 0%。
                if (!task.total) return
                const entryShare = 1 / task.total
                const inner = Math.min(0.9, (index + 1) / (total + 1))
                task.message = `刮削 · ${entry.name} · 正在查询 ${providerId}（${index + 1}/${total}）· ${code}`
                advance((task.processed + inner) * entryShare * 100)
                this.emit({ ...task })
              }
            })
            if (!info) {
              task.results!.push({ name: entry.name, source: entry.rel, destination: null, state: 'skipped', message: '未在所选数据源中找到匹配结果', entryId: entry.id })
            } else {
              const meta = await this.persist(entry.id, info, 'auto', downloadCover, autoSetCover)
              task.results!.push({ name: entry.name, source: entry.rel, destination: null, state: 'completed', message: `${meta.provider} · ${meta.code} · ${meta.title.slice(0, 80)}`, entryId: entry.id })
            }
          } catch (error) {
            task.failed++
            task.results!.push({ name: entry.name, source: entry.rel, destination: null, state: 'failed', message: error instanceof Error ? error.message : String(error), entryId: entry.id })
            await this.log('entry-failed', entry.name, error)
          }
          task.processed++
          if (task.total) advance(task.processed / task.total * 100)
          this.emit({ ...task })
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))
      if (control.cancel) task.state = 'cancelled'
      else if (task.failed) task.state = 'completed-errors'
      else task.state = 'completed'
      task.progress = 100
      task.message = control.cancel ? `已取消：已处理 ${task.processed}/${task.total} 项`
        : task.failed ? `刮削完成，${task.failed} 项失败，可在逐项结果中查看原因`
        : `刮削完成：成功 ${task.processed} 项，未匹配 ${task.results!.filter(result => result.state === 'skipped').length} 项`
      this.emit({ ...task })
      this.changed()
    } finally {
      this.controls.delete(task.id)
    }
  }

  cancel(taskId: string): void {
    const control = this.controls.get(taskId)
    if (control) control.cancel = true
  }

  cancelAll(): void {
    for (const control of this.controls.values()) control.cancel = true
  }
}
