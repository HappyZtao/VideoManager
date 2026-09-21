// 刮削数据源注册表：每个数据源实现 lookup(番号) → ScrapeInfo。
// 移植自 JavBoss internal/jav 各 provider（javbus/javdb/avmoo/avsox/javmenu/javdatabase/theporndb/javmodel/minnanoav）。
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import type { ScrapeInfo } from '../../../../../packages/contracts'
import { absoluteUrl, extractCsrfToken, fetchText, postJson, ScrapeNotFound, ScrapeBlocked } from './http'
import { providerCatalog,type ScrapeProviderKind } from './registry'

// cheerio 节点选择器的宽松类型（仅用于刮削解析内部）。
type Sel = ReturnType<CheerioAPI>

const cleanText = (value: string) => value.replace(/\s+/g, ' ').trim()

// 规范化番号用于比较：大写并去掉非字母数字。
const normalizeCodeKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

function normalizeLabel(value: string): string {
  return cleanText(value).toLowerCase().replace(/[:：]\s*$/, '').trim()
}

function labelMatches(text: string, labels: string[]): boolean {
  return labels.some(label => text === label || text.includes(label))
}

// 按 JavBoss extractJavBusField 的方式在 span 标签旁查找字段值。
function fieldByLabels($: CheerioAPI, labels: string[]): string {
  const normalized = labels.map(normalizeLabel).filter(Boolean)
  let value = ''
  $('span').each((_, element) => {
    if (value) return false
    const node = $(element)
    const labelText = normalizeLabel(node.text())
    if (!labelMatches(labelText, normalized)) return
    const next = cleanText(node.next().text())
    if (next) { value = next; return false }
    const own = cleanText(node.text())
    const line = cleanText(node.parent().text())
    value = line.startsWith(own) ? line.slice(own.length).trim() : ''
    return false
  })
  return value
}

// ---------------------------------------------------------------- JavBus ----

// JavBus：详情页直达 https://www.javbus.com/{code}。
type CodeRewrite = { input: string; request: string }
const javBusRewrites: CodeRewrite[] = [
  { input: 'GANA', request: '200gana' },
  { input: 'MIUM', request: '300mium' },
  { input: 'LUXU', request: '259luxu' }
]

function javBusRewriteCode(code: string): { request: string; added: number } {
  const upper = code.toUpperCase()
  for (const rewrite of javBusRewrites) {
    if (upper.length <= rewrite.input.length) continue
    if (!upper.startsWith(rewrite.input)) continue
    const next = upper.charAt(rewrite.input.length)
    if (next === '-' || next === '_' || next === ' ' || (next >= '0' && next <= '9')) return { request: rewrite.request + code.slice(rewrite.input.length), added: rewrite.request.length - rewrite.input.length }
  }
  return { request: code, added: 0 }
}

function stripAddedPrefix(value: string, rewrite: { request: string; added: number }): string {
  const text = cleanText(value)
  if (rewrite.added <= 0 || text.length <= rewrite.added) return text
  if (!text.toUpperCase().startsWith(rewrite.request.toUpperCase())) return text
  return cleanText(text.slice(rewrite.added))
}

function cleanJavBusTitle(raw: string): string {
  let title = cleanText(raw).replace(/\s*-\s*JavBus\s*$/i, '').trim()
  title = title.replace(/^[a-z]{2,6}[-_ ]?\d{2,5}\s*/i, '').trim()
  return title
}

async function lookupJavBus(code: string): Promise<ScrapeInfo> {
  const rewrite = javBusRewriteCode(code.trim().toUpperCase())
  const { body } = await fetchText(`https://www.javbus.com/${rewrite.request}`, {
    referer: 'https://www.javbus.com/',
    intervalMs: 500,
    headers: { Cookie: 'age=verified; existmag=mag' }
  })
  const $ = cheerio.load(body)
  const rawTitle = cleanText($('h3').first().text()) || cleanText($('title').first().text())
  const title = cleanJavBusTitle(rawTitle)
  const codeText = fieldByLabels($, ['識別碼', '识别码', 'id:'])
  const studio = fieldByLabels($, ['製作', '制作', 'studio']) || fieldByLabels($, ['發行', '发行', 'label'])
  const series = fieldByLabels($, ['系列', 'series'])
  let releaseDate = ''
  let durationMin = 0
  const dateRe = /\d{4}-\d{2}-\d{2}/
  const durationRe = /(\d{1,4})\s*(分鐘|分钟|分|分間|min)?/i
  $('p').each((_, element) => {
    const text = cleanText($(element).text())
    const lower = text.toLowerCase()
    if (!releaseDate && (text.includes('發行日期') || text.includes('発売日') || text.includes('发行日期') || lower.includes('release'))) releaseDate = dateRe.exec(text)?.[0] ?? ''
    if (!durationMin && (text.includes('長度') || text.includes('時長') || text.includes('长度') || text.includes('時間') || lower.includes('length') || lower.includes('duration'))) durationMin = Number(durationRe.exec(text)?.[1] ?? 0) || 0
  })
  const isUncensored = $('li.active a').toArray().some(element => {
    const href = ($(element).attr('href') ?? '').toLowerCase()
    const text = $(element).text().toLowerCase()
    return href.includes('/uncensored') || text.includes('無碼') || text.includes('无码') || text.includes('uncensored')
  })
  const scope = $('div.movie.row').first()
  const tags: string[] = []
  const actors: string[] = []
  const container = scope.length ? scope : ($('body').length ? $('body') : $('html'))
  container.find('span.genre a').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    if (href.includes('/star/')) return
    const text = cleanText($(element).text())
    if (text && !tags.includes(text)) tags.push(text)
  })
  container.find('a[href*="/star/"]').each((_, element) => {
    const text = cleanText($(element).text())
    if (text && !actors.includes(text)) actors.push(text)
  })
  const coverUrl = absoluteUrl('https://www.javbus.com/', $('meta[property="og:image"]').attr('content') ?? $('a.bigImage').attr('href') ?? $('img.cover, .bigImage img').first().attr('src') ?? '')
  if (!title && !tags.length && !actors.length) throw new ScrapeNotFound()
  const finalCode = stripAddedPrefix(codeText || rewrite.request, rewrite)
  return {
    provider: 'javbus',
    code: finalCode.toUpperCase(),
    title: stripAddedPrefix(title, rewrite),
    studio,
    series,
    releaseDate,
    durationMin,
    tags,
    actors,
    description: '',
    coverUrl,
    isUncensored
  }
}

// ---------------------------------------------------------------- JavDB ----

// JavDB：搜索 https://javdb.com/search?q={code}&f=all → 唯一结果 → 详情页。
async function lookupJavDB(code: string): Promise<ScrapeInfo> {
  const query = code.trim().toUpperCase()
  const searchHeaders = { Cookie: 'over18=1' }
  const search = await fetchText(`https://javdb.com/search?q=${encodeURIComponent(query)}&f=all`, { intervalMs: 500, headers: searchHeaders, referer: 'https://javdb.com/' })
  const $search = cheerio.load(search.body)
  let detailUrl = ''
  $search('div.movie-list div.item').each((_, element) => {
    if (detailUrl) return false
    const item = $search(element)
    const title = cleanText(item.find('div.video-title strong').first().text())
    if (normalizeCodeKey(title) !== normalizeCodeKey(query)) return
    const href = item.find('a').first().attr('href') ?? ''
    if (href) detailUrl = absoluteUrl(search.finalUrl, href)
    return false
  })
  if (!detailUrl) throw new ScrapeNotFound()
  const { body } = await fetchText(detailUrl, { intervalMs: 500, headers: searchHeaders, referer: search.finalUrl })
  const $ = cheerio.load(body)
  const title = cleanText($('span.origin-title').first().text()) || cleanText($('strong.current-title').first().text()) || cleanText($('h2').first().text())
  // 面板字段：nav.movie-panel-info 下每个 div.panel-block，label 为 strong，值为 span.value。
  const blocks: { label: string; value: string; node: Sel }[] = []
  $('nav.movie-panel-info div.panel-block').each((_, element) => {
    const node = $(element)
    blocks.push({ label: normalizeLabel(node.find('strong').first().text()), value: cleanText(node.find('span.value').first().text()), node })
  })
  const pick = (labels: string[]) => blocks.find(block => labelMatches(block.label, labels))?.value ?? ''
  let actors: string[] = []
  let tags: string[] = []
  const actorBlock = blocks.find(block => labelMatches(block.label, ['演员', '演員', 'actor']))
  if (actorBlock) actors = actorBlock.node.find('a').toArray()
    .map(element => ({ text: cleanText($(element).text()), male: $(element).find('strong.symbol.male').length > 0 || cleanText($(element).text()) === '♂' }))
    .filter(entry => entry.text && !entry.male)
    .map(entry => entry.text)
  const tagBlock = blocks.find(block => labelMatches(block.label, ['类别', '類別', 'genre', 'tags']))
  if (tagBlock) tags = tagBlock.node.find('a').toArray().map(element => cleanText($(element).text())).filter(Boolean)
  const releaseDate = pick(['日期', 'release date']).slice(0, 10)
  const durationRaw = pick(['时长', '時長', 'duration'])
  const durationMin = Number(/\d{1,4}/.exec(durationRaw)?.[0] ?? 0) || 0
  const coverUrl = absoluteUrl(detailUrl, $('meta[property="og:image"]').attr('content') ?? $('img.video-cover').first().attr('src') ?? '')
  if (!title) throw new ScrapeNotFound()
  return {
    provider: 'javdb',
    code: (pick(['番号', '番號', 'id']) || query).toUpperCase(),
    title,
    studio: pick(['片商', 'maker', 'studio']),
    series: pick(['系列', 'series']),
    releaseDate,
    durationMin,
    tags,
    actors,
    description: '',
    coverUrl,
    isUncensored: null
  }
}

// ------------------------------------------------- Avmoo / Avsox (API) ----

// Avmoo 与 Avsox 共用同一套 CSRF + JSON API 协议，仅域名与语言路径不同。
type AvmooStyleSite = {
  provider: 'avmoo' | 'avsox'
  base: string
  lang: string
  apiPrefix: string
  searchLimit: number
  intervalMs: number
  referer: string
}

const avmooSite: AvmooStyleSite = { provider: 'avmoo', base: 'https://avmoo.shop', lang: 'tw', apiPrefix: '/jav', searchLimit: 30, intervalMs: 1500, referer: 'https://avmoo.shop/' }
const avsoxSite: AvmooStyleSite = { provider: 'avsox', base: 'https://avsox.click', lang: 'cn', apiPrefix: '/javu', searchLimit: 60, intervalMs: 1500, referer: 'https://avsox.click/' }

type AvmooMovie = {
  movieId?: number | string
  movieFanHao?: string
  title?: string
  releaseDate?: string
  length?: number | string
  posterLarge?: string
  posterSmall?: string
  studio?: { studioName?: string }
  series?: { seriesName?: string }
  genre?: { genreName?: string }[]
  star?: { starName?: string }[]
}

async function lookupAvmooStyle(site: AvmooStyleSite, code: string): Promise<ScrapeInfo> {
  const query = code.trim().toUpperCase()
  // 第一步：打开搜索页获取 CSRF 与 Cookie 会话。
  const searchPage = await fetchText(`${site.base}/${site.lang}/search/${encodeURIComponent(query)}`, {
    intervalMs: site.intervalMs,
    referer: site.referer,
    headers: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }
  })
  const csrf = extractCsrfToken(searchPage.body)
  if (!csrf) throw new ScrapeBlocked('未能取得站点会话，请稍后重试')
  const headers = {
    'X-CSRF-Token': csrf,
    ...(searchPage.cookies ? { Cookie: searchPage.cookies } : {}),
    Origin: site.base,
    Referer: searchPage.finalUrl
  }
  // 第二步：内部搜索接口定位 movieId。
  const searchApi = await postJson(`${site.base}${site.apiPrefix}/data/api/search`, [{ search: query, lang: site.lang }, site.searchLimit, 1], { intervalMs: site.intervalMs, referer: searchPage.finalUrl, headers })
  let list: AvmooMovie[] = []
  try {
    const parsed = JSON.parse(searchApi.body) as { code?: number; data?: unknown }
    if (parsed.code === 200 && Array.isArray(parsed.data)) list = parsed.data as AvmooMovie[]
  } catch { throw new ScrapeBlocked('搜索接口返回异常') }
  const movie = list.find(item => normalizeCodeKey(item.movieFanHao ?? '') === normalizeCodeKey(query))
  if (!movie?.movieId) throw new ScrapeNotFound()
  // 第三步：详情接口取得完整字段。
  const detailApi = await postJson(`${site.base}${site.apiPrefix}/data/api/getMovie`, [movie.movieId, site.lang], { intervalMs: site.intervalMs, referer: searchPage.finalUrl, headers })
  let info: AvmooMovie | null = null
  try {
    const parsed = JSON.parse(detailApi.body) as { code?: number; data?: AvmooMovie | AvmooMovie[] }
    if (parsed.code === 200 && parsed.data && !Array.isArray(parsed.data)) info = parsed.data
  } catch { throw new ScrapeBlocked('详情接口返回异常') }
  if (!info?.title) throw new ScrapeNotFound()
  return {
    provider: site.provider,
    code: normalizeCodeKey(info.movieFanHao ?? query),
    title: cleanText(info.title),
    studio: cleanText(info.studio?.studioName ?? ''),
    series: cleanText(info.series?.seriesName ?? ''),
    releaseDate: cleanText(info.releaseDate ?? '').slice(0, 10),
    durationMin: Number(info.length ?? 0) || 0,
    tags: (info.genre ?? []).map(genre => cleanText(genre.genreName ?? '')).filter(Boolean),
    actors: (info.star ?? []).map(star => cleanText(star.starName ?? '')).filter(Boolean),
    description: '',
    coverUrl: absoluteUrl(site.base, info.posterLarge ?? info.posterSmall ?? ''),
    isUncensored: site.provider === 'avsox' ? true : null
  }
}

const lookupAvmoo = (code: string) => lookupAvmooStyle(avmooSite, code)
const lookupAvsox = (code: string) => lookupAvmooStyle(avsoxSite, code)

// -------------------------------------------------------------- JavMenu ----

// JavMenu：详情页直达 https://javmenu.com/{CODE}。
function cleanJavMenuCode(value: string): string {
  return cleanText(value).replace(/\u00a0/g, ' ').replace(/[－ー]/g, '-').trim()
}

async function lookupJavMenu(code: string): Promise<ScrapeInfo> {
  const query = cleanJavMenuCode(code).toUpperCase()
  const { body } = await fetchText(`https://javmenu.com/${encodeURIComponent(query)}`, {
    referer: 'https://javmenu.com/',
    intervalMs: 1500,
    headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' }
  })
  const $ = cheerio.load(body)
  const bodies = $('div.card.rounded div.card-body').toArray().map(element => $(element))
  const infoNode: Sel | null = bodies.find(node => node.text().includes('影片資料') || node.text().includes('影片资料')) ?? null
  const rows: { label: string; value: string; node: Sel }[] = []
  if (infoNode) {
    infoNode.find('div').each((_, element) => {
      const node = $(element)
      const span = node.find('span').first()
      if (!span.length) return
      const label = normalizeLabel(span.text())
      const anchor = node.find('a').first()
      const rest = cleanText(node.text()).replace(cleanText(span.text()), '').trim()
      rows.push({ label, value: anchor.length ? cleanText(anchor.text()) || rest : rest, node })
    })
  }
  const pick = (labels: string[]) => rows.find(row => labelMatches(row.label, labels))?.value ?? ''
  let actors: string[] = []
  let tags: string[] = []
  const actorRow = rows.find(row => labelMatches(row.label, ['女優', '女优', '演員', '演员', 'actress', 'actor']))
  if (actorRow) actors = actorRow.node.find('a.actress').toArray().map(element => cleanText($(element).text())).filter(Boolean)
  const genreRow = rows.find(row => labelMatches(row.label, ['類別', '类别', '主題', '主题', 'genre', 'tags']))
  if (genreRow) tags = genreRow.node.find('a.genre').toArray().map(element => cleanText($(element).text())).filter(Boolean)
  const rawTitle = cleanText($('h1').first().text()) || cleanText($('title').first().text())
  let title = rawTitle.replace(/免費AV在線看|免费AV在线看/g, '').replace(/\s*\|.*$/, '').trim()
  title = title.replace(/^[a-z]{2,8}[-_ ]?\d{2,6}[a-z]{0,3}\s+/i, '').replace(new RegExp(`^${query}[\\s_-]*`, 'i'), '').trim()
  const durationRaw = pick(['時長', '时长', 'duration', 'runtime'])
  const coverUrl = absoluteUrl('https://javmenu.com/', $('meta[property="og:image"]').attr('content') ?? $('img.cover, .video-cover, img[data-src]').first().attr('data-src') ?? $('img').first().attr('src') ?? '')
  if (!title) throw new ScrapeNotFound()
  return {
    provider: 'javmenu',
    code: (cleanJavMenuCode(pick(['番號', '番号', '識別碼', '识别码'])) || query).toUpperCase(),
    title,
    studio: pick(['出版', '發行', '发行', '片商', '製作商', '制作商', 'studio', 'maker', 'publisher']),
    series: pick(['系列', 'series']),
    releaseDate: pick(['發佈於', '发布于', '發行日期', '发行日期', '発売日', 'release date']).slice(0, 10),
    durationMin: Number(/\d{1,4}/.exec(durationRaw)?.[0] ?? 0) || 0,
    tags,
    actors,
    description: '',
    coverUrl,
    isUncensored: null
  }
}

// ---------------------------------------------------------- JavDatabase ----

// JavDatabase：详情页直达 https://www.javdatabase.com/movies/{code}/。
function javDatabaseLabelKey(value: string): string {
  return value.toLowerCase().replace(/[-/()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

function javDatabaseLabelHasAny(label: string, labels: string[]): boolean {
  const key = javDatabaseLabelKey(label)
  return labels.some(candidate => key.includes(javDatabaseLabelKey(candidate)))
}

async function lookupJavDatabase(code: string): Promise<ScrapeInfo> {
  const query = code.trim().toUpperCase()
  const { body, finalUrl } = await fetchText(`https://www.javdatabase.com/movies/${encodeURIComponent(query)}/`, {
    referer: 'https://www.javdatabase.com/',
    intervalMs: 500,
    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
  })
  const $ = cheerio.load(body)
  const fields: { label: string; value: string; node: Sel }[] = []
  $('div.movietable p.mb-1, p.mb-1').each((_, element) => {
    const node = $(element)
    const bold = node.find('b').first()
    if (!bold.length) return
    const label = cleanText(bold.text())
    // 取 b 之后兄弟节点的文本（等价 JavBoss collectValueAfterBold 的简化版）。
    const clone = node.clone()
    clone.find('b').remove()
    fields.push({ label, value: cleanText(clone.text()), node })
  })
  const pick = (labels: string[]) => fields.find(field => javDatabaseLabelHasAny(field.label, labels))?.value ?? ''
  const pickAll = (labels: string[]) => {
    const field = fields.find(item => javDatabaseLabelHasAny(item.label, labels))
    return field ? field.node.find('a').toArray().map(element => cleanText($(element).text())).filter(Boolean) : []
  }
  const title = cleanText($('meta[property="og:title"]').attr('content') ?? $('h1').first().text())
  const releaseDate = (pick(['release date', 'released', 'date']).match(/\d{4}[-/]\d{2}[-/]\d{2}/) ?? [''])[0].replace(/\//g, '-')
  const durationMin = Number(/\d{1,4}/.exec(pick(['runtime', 'duration']))?.[0] ?? 0) || 0
  const coverUrl = absoluteUrl(finalUrl, $('meta[property="og:image"]').attr('content') ?? $('img.poster, img.cover').first().attr('src') ?? '')
  if (!title) throw new ScrapeNotFound()
  return {
    provider: 'javdatabase',
    code: (pick(['dvd id', 'code', 'movie id']).toUpperCase().replace(/[^A-Z0-9-]/g, '') || query),
    title,
    studio: (() => { const field = fields.find(item => javDatabaseLabelHasAny(item.label, ['studio', 'studios'])); if (!field) return ''; const anchor = field.node.find('a').first(); return anchor.length ? cleanText(anchor.text()) : field.value })(),
    series: pick(['series']),
    releaseDate,
    durationMin,
    tags: pickAll(['genre', 'genres']),
    actors: pickAll(['idol actress', 'actress', 'idol', 'idols']),
    description: '',
    coverUrl,
    isUncensored: null
  }
}

// ------------------------------------------------------------ ThePornDB ----

// ThePornDB：JSON API，Bearer token 沿用 JavBoss 配置。
const THEPORNDB_TOKEN = 'uqtWi1LRXC2ngClxz8QrqfOERuH2qbuh89CQAiXx85088612'

type PornDbItem = {
  external_id?: string
  title?: string
  date?: string
  duration?: number
  background?: { full?: string; large?: string }
  performers?: { name?: string; parent?: { name?: string; full_name?: string } }[]
  tags?: { name?: string }[]
}

async function lookupThePornDB(code: string): Promise<ScrapeInfo> {
  const query = code.trim().toUpperCase()
  const { body } = await fetchText(`https://api.theporndb.net/jav?external_id=${encodeURIComponent(code.trim().toLowerCase())}`, {
    intervalMs: 400,
    headers: { Authorization: `Bearer ${THEPORNDB_TOKEN}`, Accept: 'application/json' }
  })
  let list: PornDbItem[] = []
  try {
    const parsed = JSON.parse(body) as { data?: PornDbItem[] }
    if (Array.isArray(parsed.data)) list = parsed.data
  } catch { throw new ScrapeBlocked('接口返回异常') }
  const item = list.find(entry => normalizeCodeKey(entry.external_id ?? '') === normalizeCodeKey(query))
  if (!item?.title) throw new ScrapeNotFound()
  return {
    provider: 'theporndb',
    code: (item.external_id ?? query).toUpperCase(),
    title: cleanText(item.title).replace(/^[a-z]{2,6}[-_ ]?\d{2,5}\s*/i, '').trim(),
    studio: '',
    series: '',
    releaseDate: cleanText(item.date ?? '').slice(0, 10),
    durationMin: Math.round(Number(item.duration ?? 0) / 60) || 0,
    tags: (item.tags ?? []).map(tag => cleanText(tag.name ?? '')).filter(Boolean),
    actors: (item.performers ?? []).map(performer => cleanText(performer.parent?.full_name ?? performer.parent?.name ?? performer.name ?? '')).filter(Boolean),
    description: '',
    coverUrl: absoluteUrl('https://api.theporndb.net', item.background?.full ?? item.background?.large ?? ''),
    isUncensored: null
  }
}

// ------------------------------------------- 辅助源（演员资料，不用于番号） ----

// JavModel 与 MinnanoAV 在 JavBoss 中用于演员资料查询，不提供番号 → 影片的映射。
async function lookupAuxiliaryUnsupported(): Promise<ScrapeInfo> {
  throw new ScrapeNotFound('此源仅提供演员资料查询，不用于番号刮削')
}

export type ScrapeProvider = {
  id: string
  label: string
  description: string
  kind: ScrapeProviderKind
  lookup: (code: string) => Promise<ScrapeInfo>
}

// 查找失败时返回"未找到"而不是抛出网络错误的辅助源。
const auxiliaryLookup = async (code: string) => lookupAuxiliaryUnsupported()

// 番号 → 查找函数的映射（movie 类数据源）。
const lookupById: Record<string, (code: string) => Promise<ScrapeInfo>> = {
  javbus: lookupJavBus,
  javdb: lookupJavDB,
  avmoo: lookupAvmoo,
  avsox: lookupAvsox,
  javmenu: lookupJavMenu,
  javdatabase: lookupJavDatabase,
  theporndb: lookupThePornDB
}

export const providers: ScrapeProvider[] = providerCatalog.map(meta => {
  const lookup = meta.kind === 'movie' ? lookupById[meta.id] : auxiliaryLookup
  if (!lookup) throw new Error(`刮削数据源 ${meta.id} 缺少查找实现`)
  return { id: meta.id, label: meta.label, description: meta.description, kind: meta.kind, lookup }
})

export function providerById(id: string): ScrapeProvider | undefined {
  return providers.find(provider => provider.id === id)
}
