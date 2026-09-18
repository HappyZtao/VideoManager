import type { QuerySpec } from '../contracts'

export const IMAGE_EXTENSIONS = new Set(['jpg','jpeg','png','webp','gif','bmp'])
export const VIDEO_EXTENSIONS = new Set(['mp4','m4v','webm','mov','mkv','avi','wmv','flv','mpeg','mpg','ts','mts','m2ts'])
export const discoverKind = (name: string): 'image' | 'video' | null => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : VIDEO_EXTENSIONS.has(ext) ? 'video' : null
}
export function naturalKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\d+/g, n => { const s = n.replace(/^0+/, '') || '0'; return `\u0001${String(s.length).padStart(6,'0')}:${s}:${String(n.length).padStart(6,'0')}\u0002` })
}
export function validateName(name: string): string {
  if (!name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..' || name.length > 255) throw Error('名称包含 Windows 不允许的字符或保留名称')
  return name
}
export function safeRelative(rel: string): boolean {
  return rel === '' || (!rel.startsWith('/') && !rel.includes('\\') && !rel.includes(':') && rel.split('/').every(s => s !== '..' && s !== '.' && s.length > 0))
}
export function compileQuery(q: QuerySpec): { where: string; params: unknown[]; order: string } {
  const clauses = ["e.state='present'", 'r.active=1']; const params: unknown[] = []
  if (q.scope === 'direct' && q.folderId) { clauses.push('e.parentId=?'); params.push(q.folderId) }
  if (q.scope === 'descendants' && q.folderId) { clauses.push("e.kind!='folder' AND e.parentId IN (SELECT descendant FROM closure WHERE ancestor=?)"); params.push(q.folderId) }
  if (!q.folderId && q.scope !== 'library') clauses.push('e.parentId IS NULL')
  for (const word of q.text.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean)) {
    const tagMatch = 'EXISTS(SELECT 1 FROM entry_tags search_tags WHERE search_tags.entryId=e.id AND instr(lower(search_tags.tag),?)>0)'
    if ([...word].length >= 3) {
      clauses.push(`((e.rowid IN (SELECT rowid FROM entry_fts WHERE entry_fts MATCH ?) AND instr(e.search,?)>0) OR ${tagMatch})`)
      params.push(`"${word.replace(/"/g, '""')}"`,word,word)
    } else {
      clauses.push(`(instr(e.search,?)>0 OR ${tagMatch})`)
      params.push(word,word)
    }
  }
  if (q.kinds.length) { clauses.push(`e.kind IN (${q.kinds.map(()=>'?').join(',')})`); params.push(...q.kinds) }
  if (q.extensions.length) { clauses.push(`e.ext IN (${q.extensions.map(()=>'?').join(',')})`); params.push(...q.extensions.map(e=>e.toLowerCase().replace(/^\./,''))) }
  if (q.favorite) clauses.push('e.favorite=1')
  for (const tag of q.tags) { clauses.push('EXISTS(SELECT 1 FROM entry_tags t WHERE t.entryId=e.id AND t.tag=?)'); params.push(tag) }
  for (const [key, op, value] of [['size','>=',q.minSize], ['size','<=',q.maxSize], ['mtime','>=',q.after], ['mtime','<=',q.before], ['duration','>=',q.minDuration], ['duration','<=',q.maxDuration]] as const) {
    if (value !== null) { clauses.push(`e.${key}${op}?`); params.push(value) }
  }
  const field = { name: 'sortKey', mtime: 'mtime', size: 'size', duration: 'duration' }[q.sort]
  return { where: clauses.join(' AND '), params, order: `(e.kind='folder') DESC, e.${field} IS NULL ASC, e.${field} ${q.direction === 'desc' ? 'DESC' : 'ASC'}, e.id` }
}
export function parseRange(header: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  if (!header) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null
  return { start, end, partial: true }
}
