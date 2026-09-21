import {describe,it,expect} from 'vitest'
import {extractCodesFromName} from '../apps/desktop/src/main/scrape/parse'
import {providerCatalog,providerMetaById} from '../apps/desktop/src/main/scrape/registry'

describe('刮削：文件名番号解析',()=>{
 it('解析有码番号（横线/无分隔/下划线），前导零归一化为三位',()=>{
  expect(extractCodesFromName('IPX-633.mp4')[0]).toBe('IPX-633')
  expect(extractCodesFromName('ipx633_ch.mp4')[0]).toBe('IPX-633')
  expect(extractCodesFromName('MIDV_0021.mkv')[0]).toBe('MIDV-021')
  expect(extractCodesFromName('SSIS-714C.avi').some(code=>code==='SSIS-714C')).toBe(true)
 })
 it('解析纯数字无码番号（如 n 序列与 090912-123）',()=>{
  expect(extractCodesFromName('n1012.avi').length).toBeGreaterThan(0)
  expect(extractCodesFromName('[98t.tv] 090912-123 4K.mp4').some(code=>code==='090912-123')).toBe(true)
 })
 it('无有效番号时返回空数组，不误报普通名字',()=>{
  expect(extractCodesFromName('家庭聚会 2023 春游.mp4')).toEqual([])
  expect(extractCodesFromName('nothing-here-only.mp4')).toEqual([])
 })
 it('数据源目录覆盖 JavBoss 全部站点，辅助源与番号源区分',()=>{
  const ids=providerCatalog.map(provider=>provider.id)
  for(const id of ['javbus','javdb','avmoo','avsox','javmenu','javdatabase','theporndb','javmodel','minnanoav'])expect(ids).toContain(id)
  expect(providerMetaById('javbus')?.kind).toBe('movie')
  expect(providerMetaById('javmodel')?.kind).toBe('auxiliary')
  expect(providerMetaById('missing')).toBeUndefined()
 })
})
