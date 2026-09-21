// 刮削数据源共享 HTTP 工具：限速、超时、重试、大小上限、反爬头与系统代理。
import { writeFile, rename } from 'node:fs/promises'
import { proxyDispatcherFor } from './proxy'

export class ScrapeNotFound extends Error {
  constructor(message = 'NOT_FOUND') { super(message); this.name = 'ScrapeNotFound' }
}
export class ScrapeBlocked extends Error {
  constructor(message = '站点要求浏览器验证或暂时不可用') { super(message); this.name = 'ScrapeBlocked' }
}

export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15000
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// 同一域名的请求按固定间隔排队，避免触发站点限流。
const hostChains = new Map<string, Promise<void>>()
const hostNextAt = new Map<string, number>()
function rateLimit(host: string, intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return Promise.resolve()
  const previous = hostChains.get(host) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    const wait = (hostNextAt.get(host) ?? 0) - Date.now()
    if (wait > 0) await sleep(wait)
    hostNextAt.set(host, Date.now() + intervalMs)
  })
  hostChains.set(host, current)
  return current
}

export type FetchOptions = {
  headers?: Record<string, string>
  referer?: string
  intervalMs?: number
  retries?: number
  accept?: string
  timeoutMs?: number
}

function buildHeaders(url: string, options: FetchOptions): Record<string, string> {
  return {
    'User-Agent': DESKTOP_UA,
    'Accept': options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(options.referer ? { Referer: options.referer } : {}),
    ...options.headers
  }
}

async function fetchOnce(url: string, options: FetchOptions): Promise<Response> {
  const host = new URL(url).hostname
  await rateLimit(host, options.intervalMs ?? 0)
  const init: RequestInit = {
    method: 'GET',
    headers: buildHeaders(url, options),
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }
  const dispatcher = await proxyDispatcherFor(url)
  if (dispatcher) (init as Record<string, unknown>).dispatcher = dispatcher
  return fetch(url, init)
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_BYTES) { await reader.cancel().catch(() => {}); break }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

const blockMarkers = ['just a moment', 'challenge-platform', 'cf-browser-verification', 'driver-verify', 'ddos-guard']

// 以浏览器表单方式提交 POST（部分站点内部搜索接口使用）。
export async function postForm(url: string, form: Record<string, string>, options: FetchOptions = {}): Promise<{ body: string; finalUrl: string; status: number }> {
  const body = await postSend(url, new URLSearchParams(form).toString(), { ...options, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' })
  return body
}

// 提交 JSON POST（Avmoo/Avsox 内部 API），返回响应文本。
export async function postJson(url: string, payload: unknown, options: FetchOptions = {}): Promise<{ body: string; finalUrl: string; status: number }> {
  return postSend(url, JSON.stringify(payload), { ...options, 'Content-Type': 'application/json; charset=UTF-8' })
}

async function postSend(url: string, body: string, options: FetchOptions & { 'Content-Type': string }): Promise<{ body: string; finalUrl: string; status: number }> {
  const host = new URL(url).hostname
  await rateLimit(host, options.intervalMs ?? 0)
  const init: RequestInit = {
    method: 'POST',
    headers: { ...buildHeaders(url, options), 'Content-Type': options['Content-Type'], 'X-Requested-With': 'XMLHttpRequest' },
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }
  const dispatcher = await proxyDispatcherFor(url)
  if (dispatcher) (init as Record<string, unknown>).dispatcher = dispatcher
  const response = await fetch(url, init)
  if (!response.ok) throw new ScrapeBlocked(`站点返回 ${response.status}`)
  const text = await readCapped(response)
  return { body: text, finalUrl: response.url || url, status: response.status }
}

// 汇总响应 Set-Cookie 为请求头格式。
export function cookieHeader(response: Response): string {
  try {
    const cookies = response.headers.getSetCookie?.() ?? []
    return cookies.map(cookie => cookie.split(';')[0]).filter(Boolean).join('; ')
  } catch { return '' }
}

// 提取页面中的 CSRF token（meta csrf-token）。
export function extractCsrfToken(html: string): string {
  const patterns = [
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match?.[1]) return match[1]
  }
  return ''
}

// 抓取 HTML 文本；网络错误重试一次，4xx 不重试。同时返回响应 Cookie 供会话化请求使用。
export async function fetchText(url: string, options: FetchOptions = {}): Promise<{ body: string; finalUrl: string; status: number; cookies: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt <= (options.retries ?? 1); attempt++) {
    try {
      const response = await fetchOnce(url, options)
      if (response.status === 404 || response.status === 410) throw new ScrapeNotFound()
      if (!response.ok) throw new ScrapeBlocked(`站点返回 ${response.status}`)
      const body = await readCapped(response)
      const lower = body.slice(0, 4000).toLowerCase()
      if (blockMarkers.some(marker => lower.includes(marker))) throw new ScrapeBlocked()
      return { body, finalUrl: response.url || url, status: response.status, cookies: cookieHeader(response) }
    } catch (error) {
      if (error instanceof ScrapeNotFound) throw error
      lastError = error
      if (attempt < (options.retries ?? 1)) await sleep(600 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new ScrapeBlocked(String(lastError))
}

export function absoluteUrl(base: string, candidate: string): string {
  const value = (candidate ?? '').trim()
  if (!value) return ''
  try { return new URL(value, base).toString() } catch { return '' }
}

// 下载封面等图片到本地文件；先写临时文件，校验最小字节数后改名。网络失败按 retries 重试。
export async function downloadImage(url: string, destination: string, options: FetchOptions = {}, minBytes = 4096): Promise<void> {
  let lastError: unknown
  const retries = options.retries ?? 1
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await downloadImageOnce(url, destination, options, minBytes)
      return
    } catch (error) {
      if (error instanceof ScrapeNotFound) throw error
      lastError = error
      if (attempt < retries) await sleep(600 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new ScrapeBlocked(String(lastError))
}

async function downloadImageOnce(url: string, destination: string, options: FetchOptions, minBytes: number): Promise<void> {
  const host = new URL(url).hostname
  await rateLimit(host, options.intervalMs ?? 0)
  const init: RequestInit = {
    method: 'GET',
    headers: buildHeaders(url, { ...options, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }),
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 12000)
  }
  const dispatcher = await proxyDispatcherFor(url)
  if (dispatcher) (init as Record<string, unknown>).dispatcher = dispatcher
  const response = await fetch(url, init)
  if (response.status === 404) throw new ScrapeNotFound()
  if (!response.ok) throw new ScrapeBlocked(`图片返回 ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength < minBytes) throw new ScrapeBlocked('图片数据过小，可能无效')
  const temporary = destination + '.part'
  await writeFile(temporary, buffer)
  await rename(temporary, destination)
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
}
