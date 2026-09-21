// 刮削网络代理：读取 Electron 系统代理配置（支持 PAC 分流），让刮削请求（含封面图 CDN）走系统代理。
// Node 的 fetch 默认不使用系统代理，这是刮削站点可达但图片 CDN 超时的根因。
import { ProxyAgent } from 'undici'

// 解析 Electron session.resolveProxy 的返回值，如 "PROXY 127.0.0.1:7890" / "DIRECT" / "PROXY a:1;PROXY b:2"。
export function parseSystemProxy(hint: string): string | null {
  const entries = (hint ?? '').split(';').map(entry => entry.trim()).filter(Boolean)
  for (const entry of entries) {
    const match = /^proxy\s+(\S+)$/i.exec(entry)
    if (!match?.[1]) continue
    if (match[1].toLowerCase() === 'direct') return null
    return `http://${match[1]}`
  }
  return null
}

type ResolveProxy = (url: string) => Promise<string>
let resolver: ResolveProxy | null = null
// 每个域名的代理调度器缓存：域名 → ProxyAgent | null（直连）。
const cache = new Map<string, unknown>()

// 注入 Electron 的 resolveProxy（main 进程初始化时调用一次）。
export function setProxyResolver(resolve: ResolveProxy): void {
  resolver = resolve
  cache.clear()
}

// 取得该 URL 应使用的调度器：命中系统代理则返回 ProxyAgent，否则 null（直连）。
// 结果按域名缓存，代理配置变更需重启应用生效。
export async function proxyDispatcherFor(url: string): Promise<unknown | null> {
  if (!resolver) return null
  let host = ''
  try { host = new URL(url).hostname } catch { return null }
  if (cache.has(host)) return cache.get(host) ?? null
  let dispatcher: unknown = null
  try {
    const hint = await resolver(`https://${host}/`)
    const proxy = parseSystemProxy(hint)
    if (proxy) dispatcher = new ProxyAgent(proxy)
  } catch { dispatcher = null }
  cache.set(host, dispatcher)
  return dispatcher
}
