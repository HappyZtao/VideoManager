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
  const words=q.text.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (q.folderId && words.length) { clauses.push("((e.kind='folder' AND e.id IN (SELECT descendant FROM closure WHERE ancestor=? AND depth>0)) OR (e.kind!='folder' AND e.parentId IN (SELECT descendant FROM closure WHERE ancestor=?)))"); params.push(q.folderId,q.folderId) }
  else {
    if (q.scope === 'direct' && q.folderId) { clauses.push('e.parentId=?'); params.push(q.folderId) }
    if (q.scope === 'descendants' && q.folderId) { clauses.push("e.kind!='folder' AND e.parentId IN (SELECT descendant FROM closure WHERE ancestor=?)"); params.push(q.folderId) }
    if (!q.folderId && q.scope !== 'library') clauses.push('e.parentId IS NULL')
  }
  for (const word of words) {
    const matches:string[]=[]
    if(q.searchFields.includes('name')){matches.push("(e.kind!='folder' AND instr(lower(e.name),?)>0)");params.push(word)}
    if(q.searchFields.includes('folder')){matches.push("((e.kind='folder' AND instr(lower(e.name),?)>0) OR (e.kind!='folder' AND instr(lower(CASE WHEN length(e.rel)>length(e.name) THEN substr(e.rel,1,length(e.rel)-length(e.name)-1) ELSE '' END),?)>0))");params.push(word,word)}
    if(q.searchFields.includes('tag')){matches.push('EXISTS(SELECT 1 FROM entry_tags search_tags WHERE search_tags.entryId=e.id AND instr(lower(search_tags.tag),?)>0)');params.push(word)}
    clauses.push(`(${matches.join(' OR ')})`)
  }
  if (q.kinds.length) { clauses.push(`e.kind IN (${q.kinds.map(()=>'?').join(',')})`); params.push(...q.kinds) }
  if (q.extensions.length) { clauses.push(`e.ext IN (${q.extensions.map(()=>'?').join(',')})`); params.push(...q.extensions.map(e=>e.toLowerCase().replace(/^\./,''))) }
  if (q.favorite) clauses.push('e.favorite=1')
  for (const tag of q.tags) { clauses.push('EXISTS(SELECT 1 FROM entry_tags t WHERE t.entryId=e.id AND t.tag=?)'); params.push(tag) }
  if (q.actress) { clauses.push('EXISTS(SELECT 1 FROM entry_actors fa JOIN actresses faa ON faa.id=fa.actressId WHERE fa.entryId=e.id AND faa.name=?)'); params.push(q.actress) }
  for (const [key, op, value] of [['size','>=',q.minSize], ['size','<=',q.maxSize], ['mtime','>=',q.after], ['mtime','<=',q.before], ['duration','>=',q.minDuration], ['duration','<=',q.maxDuration]] as const) {
    if (value !== null) { clauses.push(`e.${key}${op}?`); params.push(value) }
  }
  const fields: Record<string, string> = { name: 'sortKey', mtime: 'mtime', size: 'size', duration: 'duration' }
  const expr = `e.${fields[q.sort]}`
  return { where: clauses.join(' AND '), params, order: `(e.kind='folder') DESC, ${expr} IS NULL ASC, ${expr} ${q.direction === 'desc' ? 'DESC' : 'ASC'}, e.id` }
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
