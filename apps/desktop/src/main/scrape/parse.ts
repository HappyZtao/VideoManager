// 视频文件名 → 番号解析，逻辑移植自 JavBoss internal/util/jav_util.go。
const codeRe = /([a-z]{2,6})[-_ ]?(\d{2,5})([a-z]{0,2})/gi
const alphaNumericUncensoredRe = /(^|[^a-z0-9])([a-z]+)(?:\s*([-_ ])\s*)?(\d{2,})([^a-z0-9]|$)/gi
const mixedPrefixUncensoredRe = /(^|[^a-z0-9])([a-z0-9]*[a-z][a-z0-9]*\d[a-z0-9]*[a-z][a-z0-9]*)[-_ ](\d{2,})([^a-z0-9]|$)/gi
const mixedPrefixCensoredRe = /(^|[^a-z0-9])([a-z][a-z0-9]{1,5})[-_ ](\d{2,5})([a-z]{0,2})([^a-z0-9]|$)/gi
const pureNumericUncensoredCodeRe = /(^|[^0-9])(\d{4,}[-_]\d{2,})([^0-9]|$)/g
const explicitShortCodeRe = /(^|[^a-z0-9])([a-z]{2,6})[-_ ](\d{2})([a-z]{0,2})([^a-z0-9]|$)/gi

// 去掉前导零但至少保留三位（0633 → 633）。
function normalizeNumber(num: string): string {
  num = num.replace(/^0+/, '')
  if (!num) num = '0'
  if (num.length < 3) num = num.padStart(3, '0')
  return num.toUpperCase()
}

class Collector {
  out: string[] = []
  seen = new Set<string>()
  push(code: string) {
    code = code.trim().toUpperCase()
    if (!code || this.seen.has(code)) return
    this.seen.add(code)
    this.out.push(code)
  }
}

function extractCensoredCodes(base: string): string[] {
  const seen = new Collector()
  for (const m of base.matchAll(codeRe)) {
    const suffix = (m[3] ?? '').trim().toUpperCase()
    const value = `${m[1]?.toUpperCase()}-${normalizeNumber(m[2] ?? '')}`
    seen.push(value)
    if (suffix) seen.push(value + suffix)
  }
  for (const m of base.matchAll(mixedPrefixCensoredRe)) {
    const suffix = (m[4] ?? '').trim().toUpperCase()
    const value = `${(m[2] ?? '').toUpperCase()}-${normalizeNumber(m[3] ?? '')}`
    seen.push(value)
    if (suffix) seen.push(value + suffix)
  }
  return seen.out
}

function normalizeUncensoredAlphaPrefix(prefix: string): string {
  prefix = prefix.trim()
  if (!prefix) return ''
  if (prefix.length === 1) return prefix.toLowerCase()
  prefix = prefix.toLowerCase()
  return prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

function extractUncensoredCodes(base: string): string[] {
  const seen = new Collector()
  for (const m of base.matchAll(mixedPrefixUncensoredRe)) {
    if (!m[2] || !m[3]) continue
    seen.push(`${m[2].trim()}-${m[3].trim()}`)
  }
  for (const m of base.matchAll(alphaNumericUncensoredRe)) {
    if (!m[2] || !m[4]) continue
    const prefix = normalizeUncensoredAlphaPrefix(m[2])
    const separator = (m[3] ?? '').trim()
    const number = m[4].trim()
    if (!separator) seen.push(prefix + number)
    if (separator || prefix.length > 1) seen.push(`${prefix}-${number}`)
  }
  for (const m of base.matchAll(pureNumericUncensoredCodeRe)) {
    if (m[2]) seen.push(m[2].trim())
  }
  for (const m of base.matchAll(explicitShortCodeRe)) {
    if (!m[2] || !m[3]) continue
    const prefix = m[2].trim().toUpperCase()
    const number = m[3].trim().toUpperCase()
    const suffix = (m[4] ?? '').trim().toUpperCase()
    const value = `${prefix}-${number}`
    seen.push(value)
    if (suffix) seen.push(value + suffix)
  }
  return seen.out
}

// 从文件名提取候选番号，有码在前（与 JavBoss ExtractCodeFromName 一致）。
// FC2 资源使用显式规则：文件名命中 FC2 模式时只产出规范的 FC2-PPV-{编号}
// 候选，避免普通规则把编号截断成不存在的码、进而命中错误影片。
const fc2CodeRe = /(?:^|[^a-z0-9])fc(2)?[-_ ]?(ppv)?[-_ ]?(\d{3,})([a-z]{0,2})(?=[^a-z0-9]|$)/gi

function extractFc2Codes(base: string): string[] {
  const seen = new Collector()
  for (const m of base.matchAll(fc2CodeRe)) {
    const explicit = m[1] ?? ''
    const ppv = m[2] ?? ''
    const digits = (m[3] ?? '').replace(/^0+/, '') || '0'
    const suffix = (m[4] ?? '').trim().toUpperCase()
    const value = `FC2-PPV-${digits}`
    // 连写歧义：形如 fc2320947（无分隔符）时，"2" 可能属于品牌名也可能属于编号，
    // 两种拆分都产出候选，完整数字（更常见的 7 位编号）优先。
    const ambiguous = explicit !== '' && !ppv && !/[-_ ]/.test(m[0]!)
    if (ambiguous) {
      const full = ((explicit + (m[3] ?? '')).replace(/^0+/, '') || '0')
      seen.push(`FC2-PPV-${full}`)
      if (suffix) seen.push(`FC2-PPV-${full}${suffix}`)
      seen.push(value)
      if (suffix) seen.push(value + suffix)
    } else {
      seen.push(value)
      if (suffix) seen.push(value + suffix)
    }
  }
  return seen.out
}

export function extractCodesFromName(name: string): string[] {
  const base = name.replace(/\.[^.]+$/, '')
  const fc2 = extractFc2Codes(base)
  if (fc2.length) return fc2
  return [...extractCensoredCodes(base), ...extractUncensoredCodes(base)]
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}
