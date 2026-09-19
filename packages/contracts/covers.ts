export const coverQualities = [
  {value:'original',width:0,label:'原图级 · 最大质量'},
  {value:'high',width:1280,label:'高清 · 1280 px'},
  {value:'balanced',width:768,label:'标准 · 768 px'},
  {value:'fast',width:480,label:'轻量 · 480 px'},
  {value:'compact',width:240,label:'节省空间 · 240 px'}
] as const
export type CoverQuality = typeof coverQualities[number]['value']
export const defaultCoverQuality:CoverQuality = 'balanced'
export const coverWidth = (quality:string) => coverQualities.find(item=>item.value===quality)?.width ?? 768
// A new namespace prevents reuse of the old, fixed 240px previews.
export const thumbnailName = (entry:{id:string;revision:number;coverRevision:number},quality:string) =>
  `thumb-v2-${entry.id}-${entry.revision}-${entry.coverRevision}-${coverWidth(quality)}.webp`
