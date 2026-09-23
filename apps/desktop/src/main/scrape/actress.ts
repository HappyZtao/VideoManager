// 女优资料补全：按名字从 みんなのAV（minnano-av.com）与 JavModel（javmodel.com）查询，
// 或按番号从 JavDatabase 查询。生日、身高、三围、罩杯与日文/中文名。
// 解析逻辑移植自 JavBoss internal/jav（minnanoav.go / javmodel.go / javdatabase.go）；
// 请求经系统代理并按域名限速。
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { absoluteUrl, fetchText, ScrapeNotFound } from './http'

export type ActressProfileSource = 'minnanoav' | 'javmodel' | 'javdatabase'

export type ActressProfile = {
  japaneseName: string
  romanName: string
  chineseName: string
  birthDate: string
  height: number
  bust: number
  waist: number
  hips: number
  cup: string
  aliases: string[]
  source: string
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const normalizeName = (value: string) => clean(String(value ?? '').replace(/\u00a0/g, ' '))
const MINNANO_BASE = 'https://www.minnano-av.com'
const JAVDATABASE_BASE = 'https://www.javdatabase.com'
// 去掉括号修饰（如 "名字（旧名）"）后归一化。
const nameWithoutQualifier = (value: string) => {
  const index = value.search(/[（(]/)
  return normalizeName(index >= 0 ? value.slice(0, index) : value)
}

function parseRomanName(value: string): string {
  const parts = clean(value).split('/')
  if (parts.length < 2) return ''
  const words = parts[parts.length - 1]!.split(/\s+/).filter(Boolean)
  if (words.length < 2) return words.join(' ')
  return [...words.slice(1), words[0]].join(' ')
}

function parseBirthDate(value: string): string {
  const match = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(value ?? '')
  if (!match) return ''
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return ''
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
}

function parseSizes(value: string) {
  const number = (pattern: RegExp) => {
    const match = pattern.exec(value)
    const parsed = match ? Number(match[1]) : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const cup = /B\s*\d{2,3}\s*\(\s*([A-Z])\s*カップ/i.exec(value)?.[1] ?? ''
  return { height: number(/T\s*(\d{2,3})/i), bust: number(/B\s*(\d{2,3})/i), waist: number(/W\s*(\d{2,3})/i), hips: number(/H\s*(\d{2,3})/i), cup }
}

// 仅接受 /actress{数字}.html 的站内资料页地址。
function canonicalActressUrl(rawUrl: string): string {
  if (!rawUrl) return ''
  try {
    const target = new URL(rawUrl)
    if (!/^\/actress\d+\.html$/.test(target.pathname)) return ''
    target.search = ''
    target.hash = ''
    return target.toString()
  } catch { return '' }
}

function parseProfilePage(html: string): { japaneseName: string; romanName: string; birthDate: string; sizes: { height: number; bust: number; waist: number; hips: number; cup: string }; aliases: string[] } | null {
  const $ = cheerio.load(html)
  const profile = $('div.act-profile').first()
  if (!profile.length) return null
  const heading = $('h1').first()
  const headingClone = heading.clone()
  headingClone.find('span').remove()
  const japaneseName = normalizeName(headingClone.text())
  const romanName = parseRomanName(clean(heading.find('span').first().text()))
  const fields: Record<string, string> = {}
  profile.find('tr').each((_, row) => {
    const cell = $(row).children('td').first()
    const label = clean(cell.children('span').first().text())
    if (!label) return
    const value = clean(cell.children('p').first().text())
    if (value) fields[label] = value
  })
  const aliases: string[] = []
  profile.find('tr').each((_, row) => {
    const cell = $(row).children('td').first()
    if (clean(cell.children('span').first().text()) !== '別名') return
    const alias = nameWithoutQualifier(cell.children('p').first().text())
    if (alias && !aliases.includes(alias)) aliases.push(alias)
  })
  return { japaneseName, romanName, birthDate: parseBirthDate(fields['生年月日'] ?? ''), sizes: parseSizes(fields['サイズ'] ?? ''), aliases }
}

// 查询失败（网络/拦截）抛出异常以便稍后重试；确认无此女优或名字不匹配返回 null。
export async function lookupActressProfile(rawName: string): Promise<ActressProfile | null> {
  const name = normalizeName(rawName)
  if (!name) return null
  const headers = { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.7' }
  const searchUrl = `${MINNANO_BASE}/search_result.php?search_scope=actress&search_word=${encodeURIComponent(name)}&search=Go`
  const search = await fetchText(searchUrl, { intervalMs: 500, headers, referer: MINNANO_BASE + '/' })
  const $ = cheerio.load(search.body)
  let profileUrl = canonicalActressUrl(search.finalUrl)
  if (!profileUrl) {
    const matches = new Set<string>()
    $('h2.ttl a[href]').each((_, element) => {
      if (nameWithoutQualifier($(element).text()) !== name) return
      const canonical = canonicalActressUrl(absoluteUrl(search.finalUrl, $(element).attr('href') ?? ''))
      if (canonical) matches.add(canonical)
    })
    if (matches.size !== 1) return null
    profileUrl = [...matches][0]!
  }
  const page = profileUrl === search.finalUrl ? { body: search.body } : await fetchText(profileUrl, { intervalMs: 500, headers, referer: searchUrl })
  const parsed = parseProfilePage(page.body)
  if (!parsed || !parsed.japaneseName) throw new ScrapeNotFound('女优资料页结构异常')
  // 名字或别名完全一致才采用，避免同名误绑。
  const matched = parsed.japaneseName === name || parsed.aliases.some(alias => normalizeName(alias) === name)
  if (!matched) return null
  return {
    japaneseName: parsed.japaneseName,
    romanName: parsed.romanName,
    chineseName: '',
    birthDate: parsed.birthDate,
    height: parsed.sizes.height,
    bust: parsed.sizes.bust,
    waist: parsed.sizes.waist,
    hips: parsed.sizes.hips,
    cup: parsed.sizes.cup,
    aliases: parsed.aliases,
    source: 'minnanoav'
  }
}

// ---------------------------------------------------------------- JavModel ----

const JAVMODEL_BASE = 'https://javmodel.com'

// 与 JavBoss containsJapaneseRunes 一致：假名/汉字/半角片假名均视为日文名。
const containsCjk = (value: string) => /[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9fff\uff66-\uff9d]/.test(value)

const ENGLISH_MONTHS = new Map([['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6], ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12]])

const toIsoDate = (year: string, month: string, day: string): string => {
  const y = Number(year), m = Number(month), d = Number(day)
  if (!y || !m || !d || m > 12 || d > 31) return ''
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// JavModel 生日格式宽泛：ISO、斜杠（首段>12 视为日/月/年，与 JavBoss 一致）、英文月名。
function parseFlexibleBirthDate(value: string): string {
  const text = clean(value)
  if (!text) return ''
  let match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) return toIsoDate(match[1]!, match[2]!, match[3]!)
  match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text)
  if (match) {
    return Number(match[1]) > 12
      ? toIsoDate(match[3]!, match[2]!, match[1]!)
      : toIsoDate(match[3]!, match[1]!, match[2]!)
  }
  match = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(text)
  if (match) {
    const month = ENGLISH_MONTHS.get(match[1]!.toLowerCase())
    if (month) return toIsoDate(match[3]!, String(month), match[2]!)
  }
  return ''
}

// JavModel 按名字补全（移植 JavBoss LookupActressByName）：搜索 → 详情页 → 资料卡。
// 独有优势是提供中文名（h2 中 “日文名 - 中文名” 形式）与罗马名。
export async function lookupActressProfileByModel(rawName: string): Promise<ActressProfile | null> {
  const name = normalizeName(rawName)
  if (!name) return null
  const headers = { 'Accept-Language': 'en-US,en;q=0.9' }
  const searchUrl = `${JAVMODEL_BASE}/jav/search.html?q=${encodeURIComponent(name)}`
  const search = await fetchText(searchUrl, { intervalMs: 500, headers, referer: JAVMODEL_BASE + '/' })
  const $ = cheerio.load(search.body)
  const card = $('div.card.flq-card-blog').first()
  if (!card.length) return null
  const link = card.find('h5.card-title a').first()
  const romanFromCard = clean(link.text()) || clean(card.find('h5.card-title').first().text())
  // 详情地址优先由罗马名生成 slug（与 JavBoss 一致），失败回退搜索结果链接。
  const slug = romanFromCard.split(/\s+/).filter(Boolean).map(encodeURIComponent).join('-')
  const detailUrl = slug ? `${JAVMODEL_BASE}/jav/${slug}` : absoluteUrl(search.finalUrl, link.attr('href') ?? '')
  if (!detailUrl) return null
  const detail = await fetchText(detailUrl, { intervalMs: 500, headers, referer: searchUrl })
  // 详情页不存在时站点会重定向（跳回首页等），与 JavBoss 一致视为未找到。
  const samePath = (url: string) => { try { return new URL(url).pathname.replace(/\/+$/, '').toLowerCase() } catch { return '' } }
  if (samePath(detail.finalUrl) !== samePath(detailUrl)) return null
  const parsed = parseJavModelProfile(detail.body)
  if (!parsed) return null
  // 名字校验：日文名与输入一致，或输入与罗马名一致（大小写不敏感），避免同名误绑。
  if (parsed.japaneseName !== name && parsed.romanName.toLowerCase() !== name.toLowerCase()) return null
  return { ...parsed, cup: '', aliases: [], source: 'javmodel' }
}

export function parseJavModelProfile(html: string): { romanName: string; japaneseName: string; chineseName: string; birthDate: string; height: number; bust: number; waist: number; hips: number } | null {
  const $ = cheerio.load(html)
  const profile = $('div.col-12.col-lg-7.col-xxl-8.remove-animation.card').first()
  if (!profile.length) return null
  const romanName = clean(profile.find('h1').first().text())
  // h2 名字行按连字符拆分：日文名取首个含假名/汉字的部分，中文名取首个不同的部分（与 JavBoss 一致）。
  const nameLine = clean(profile.find('h2').first().text())
  const parts = nameLine.split(/\s*[-–—]\s*/).map(part => clean(part)).filter(Boolean)
  const japaneseName = parts.find(part => containsCjk(part)) ?? parts[0] ?? ''
  const chineseName = parts.find(part => part && part !== japaneseName) ?? ''
  const fields: Record<string, string> = {}
  profile.find('tr').each((_, row) => {
    const cells = $(row).children('th,td')
    if (cells.length < 2) return
    const label = clean(cells.first()!.text()).toLowerCase()
    const value = clean(cells.last()!.text())
    if (label && value && fields[label] === undefined) fields[label] = value
  })
  const findField = (...labels: string[]) => { for (const label of labels) if (fields[label]) return fields[label]!; return '' }
  const height = Number(/(\d{2,3})/.exec(findField('height'))?.[1] ?? 0) || 0
  const bust = Number(/(\d{2,3})/.exec(findField('breast', 'bust'))?.[1] ?? 0) || 0
  const waist = Number(/(\d{2,3})/.exec(findField('waist'))?.[1] ?? 0) || 0
  const hips = Number(/(\d{2,3})/.exec(findField('hip', 'hips'))?.[1] ?? 0) || 0
  const birthDate = parseFlexibleBirthDate(findField('birthday', 'born', 'date of birth'))
  if (!japaneseName) return null
  if (!birthDate && !height && !bust) return null
  return { romanName, japaneseName, chineseName, birthDate, height, bust, waist, hips }
}

// ---------------------------------------------------------------- JavDatabase ----

// JavDatabase 按番号补全（移植 JavBoss LookupActressByCode）：电影页 → Idol Actress 链接 → 女优资料页。
// 查询失败（网络/拦截）抛出异常以便稍后重试；确认无链接或无有效字段返回 null。
export async function lookupActressProfileByCode(rawCode: string): Promise<ActressProfile | null> {
  const code = String(rawCode ?? '').trim().toUpperCase()
  if (!code) return null
  const headers = { 'Accept-Language': 'en-US,en;q=0.9' }
  const movie = await fetchText(`${JAVDATABASE_BASE}/movies/${encodeURIComponent(code)}/`, { intervalMs: 500, headers, referer: JAVDATABASE_BASE + '/' })
  const $movie = cheerio.load(movie.body)
  const idolLink = findJavDatabaseActressLink($movie)
  if (!idolLink) return null
  const actressUrl = absoluteUrl(movie.finalUrl, idolLink)
  if (!actressUrl) return null
  const page = await fetchText(actressUrl, { intervalMs: 500, headers, referer: movie.finalUrl })
  return parseJavDatabaseActressPage(page.body)
}

// 查找电影页中的女优链接：优先「Idol Actress」字段段落（唯一链接才采纳，避免多人作品误绑），否则全页评分兜底。
function findJavDatabaseActressLink($: CheerioAPI): string {
  const sectionLinks = findIdolSectionLinks($)
  if (sectionLinks && sectionLinks.length === 1) return sectionLinks[0]!
  if (sectionLinks && sectionLinks.length > 1) return ''
  let best = ''
  let bestScore = 0
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    if (!href || href.startsWith('#')) return
    const lower = href.toLowerCase()
    if (lower.includes('/movies/')) return
    if (!['/models/', '/model/', '/idols/', '/idol/', '/actress', '/actresses', '/actor', '/actors', '/stars/', '/star/'].some(token => lower.includes(token))) return
    let score = 1
    if (lower.includes('/models/') || lower.includes('/model/')) score += 3
    if (lower.includes('/idols/') || lower.includes('/idol/')) score += 3
    if (lower.includes('/actress') || lower.includes('/actors') || lower.includes('/stars/')) score += 2
    if (clean($(element).text())) score++
    if (score > bestScore) { bestScore = score; best = href }
  })
  return best
}

// 「Idol Actress」字段段落中的去重链接；未找到该段落返回 null。
function findIdolSectionLinks($: CheerioAPI): string[] | null {
  let sectionLinks: string[] | null = null
  $('p.mb-1').each((_, element) => {
    if (sectionLinks) return false
    const node = $(element)
    const label = clean(node.find('b').first().text()).replace(/[:：]\s*$/, '').toLowerCase()
    if (!['idol actress', 'actress', 'actresses', 'idol', 'idols'].some(key => label === key || label.includes(key))) return
    const hrefs: string[] = []
    node.find('a[href]').each((_, anchor) => { const href = $(anchor).attr('href') ?? ''; if (href) hrefs.push(href) })
    sectionLinks = [...new Set(hrefs)]
    return false
  })
  return sectionLinks
}

function parseJavDatabaseActressPage(html: string): ActressProfile | null {
  const $ = cheerio.load(html)
  const scope = $('div.entry-content').first()
  const root = (scope.length ? scope : $.root()) as ReturnType<CheerioAPI>
  // 名字：优先 idol-name 标题；含日文字符视为日文名，否则视为罗马名并清理站点后缀。
  const heading = clean(root.find('h1.idol-name, h2.idol-name, h3.idol-name').first().text() || root.find('h1').first().text())
  let romanName = heading.split(' - ')[0]!.replace(/JAV\s*Profile.*$/i, '').trim()
  let japaneseName = /[\u3040-\u30ff\u4e00-\u9fff]/.test(romanName) ? romanName : ''
  if (!japaneseName) romanName = clean(romanName)
  // 字段：b 标签为键，取其所在行的其余文本为值。
  const fields: Record<string, string> = {}
  root.find('b').each((_, element) => {
    const node = $(element)
    const label = clean(node.text()).replace(/[:：]\s*$/, '').toLowerCase()
    const clone = node.parent().clone()
    clone.find('b').remove()
    const value = clean(clone.text())
    if (label && value && fields[label] === undefined) fields[label] = value
  })
  const findField = (labels: string[]) => {
    for (const [key, value] of Object.entries(fields)) if (labels.some(label => key.includes(label))) return value
    return ''
  }
  const height = Number(/(\d{2,3})/.exec(findField(['height']))?.[1] ?? 0) || 0
  const measurements = findField(['measurements', 'bust'])
  const numbers = measurements.match(/\d+/g) ?? []
  const bust = Number(numbers[0]) || 0
  const waist = Number(numbers[1]) || 0
  const hips = Number(numbers[2]) || 0
  const birthDate = (/(\d{4}[-/]\d{2}[-/]\d{2})/.exec(findField(['birth', 'dob', 'born']))?.[1] ?? '').replace(/\//g, '-')
  const cup = /\b([A-K])\s*cup\b/i.exec(findField(['cup']))?.[1]?.toUpperCase()
    ?? /\b([A-K])\s*cup\b/i.exec(measurements)?.[1]?.toUpperCase()
    ?? ''
  if (!japaneseName && !romanName) return null
  if (!height && !bust && !birthDate && !cup) return null
  return { japaneseName: japaneseName || romanName, romanName: japaneseName ? romanName : '', chineseName: '', birthDate, height, bust, waist, hips, cup, aliases: [], source: 'javdatabase' }
}

// 聚合多个数据源的资料：按传入顺序取首个非空字段（名字源精确匹配优先，番号源兜底），别名取并集。
export function mergeActressProfiles(profiles: ActressProfile[]): ActressProfile | null {
  if (!profiles.length) return null
  const text = (get: (profile: ActressProfile) => string) => {
    for (const profile of profiles) { const value = get(profile); if (value) return value }
    return ''
  }
  const count = (get: (profile: ActressProfile) => number) => {
    for (const profile of profiles) { const value = get(profile); if (value > 0) return value }
    return 0
  }
  const aliases: string[] = []
  for (const profile of profiles) for (const alias of profile.aliases) if (!aliases.includes(alias)) aliases.push(alias)
  return {
    japaneseName: text(profile => profile.japaneseName),
    romanName: text(profile => profile.romanName),
    chineseName: text(profile => profile.chineseName),
    birthDate: text(profile => profile.birthDate),
    height: count(profile => profile.height),
    bust: count(profile => profile.bust),
    waist: count(profile => profile.waist),
    hips: count(profile => profile.hips),
    cup: text(profile => profile.cup),
    aliases: aliases.slice(0, 16),
    source: profiles.map(profile => profile.source).join('+')
  }
}
