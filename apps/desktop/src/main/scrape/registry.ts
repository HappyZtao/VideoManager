// 数据源目录：纯元数据，无任何依赖（可被测试与设置界面直接复用）。
export type ScrapeProviderKind = 'movie' | 'auxiliary'

export type ScrapeProviderMeta = {
  id: string
  label: string
  description: string
  kind: ScrapeProviderKind
}

export const providerCatalog: ScrapeProviderMeta[] = [
  { id: 'javbus', label: 'JavBus', description: '详情页直达，覆盖有码与无码番号', kind: 'movie' },
  { id: 'javdb', label: 'JavDB', description: '搜索后匹配唯一番号，字段最全', kind: 'movie' },
  { id: 'avmoo', label: 'Avmoo', description: '内部 JSON API，繁中元数据', kind: 'movie' },
  { id: 'avsox', label: 'Avsox', description: '无码番号专用 API', kind: 'movie' },
  { id: 'javmenu', label: 'JavMenu', description: '详情页直达，含繁中字段', kind: 'movie' },
  { id: 'javdatabase', label: 'JavDatabase', description: '详情页直达，英文元数据', kind: 'movie' },
  { id: 'theporndb', label: 'ThePornDB', description: '官方 JSON API，匹配精确', kind: 'movie' },
  { id: 'javmodel', label: 'JavModel', description: '演员资料查询（辅助源，不用于番号）', kind: 'auxiliary' },
  { id: 'minnanoav', label: 'MinnanoAV', description: '演员资料查询（辅助源，不用于番号）', kind: 'auxiliary' }
]

export function providerMetaById(id: string): ScrapeProviderMeta | undefined {
  return providerCatalog.find(provider => provider.id === id)
}
