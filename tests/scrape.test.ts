import {describe,it,expect} from 'vitest'
import {extractCodesFromName} from '../apps/desktop/src/main/scrape/parse'
import {providerCatalog,providerMetaById} from '../apps/desktop/src/main/scrape/registry'
import {parseJavModelProfile,mergeActressProfiles,type ActressProfile} from '../apps/desktop/src/main/scrape/actress'
import {compileQuery} from '../packages/domain'
import type {QuerySpec} from '../packages/contracts'

const spec=(patch:Partial<QuerySpec>):QuerySpec=>({folderId:null,scope:'library',text:'',searchFields:['name','folder','tag'],kinds:[],extensions:[],tags:[],favorite:false,actress:'',sort:'name',direction:'asc',movies:false,minSize:null,maxSize:null,after:null,before:null,minDuration:null,maxDuration:null,...patch})

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
 it('FC2 资源产出规范候选码，避免编号截断命中错误影片',()=>{
  expect(extractCodesFromName('FC2-PPV-2611091A.mp4')).toEqual(['FC2-PPV-2611091','FC2-PPV-2611091A'])
  expect(extractCodesFromName('FC2-PPV-2611091.mp4')).toEqual(['FC2-PPV-2611091'])
  expect(extractCodesFromName('FC2PPV-3789210.mp4')).toEqual(['FC2-PPV-3789210'])
  expect(extractCodesFromName('fc1852875_1.mp4')).toEqual(['FC2-PPV-1852875'])
  expect(extractCodesFromName('fc2320947_1.mp4')[0]).toBe('FC2-PPV-2320947')
  expect(extractCodesFromName('fc2320947_1.mp4')).toContain('FC2-PPV-320947')
  expect(extractCodesFromName('FC2PPV-0123456.mp4')).toEqual(['FC2-PPV-123456'])
  expect(extractCodesFromName('IPX-633.mp4')[0]).toBe('IPX-633')
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

describe('演员资料聚合：JavModel 解析与多源合并',()=>{
 const profilePage=`<html><body><div class="col-12 col-lg-7 col-xxl-8 remove-animation card">
  <h1>Tsukasa Aoi</h1><h2>葵つかさ - 葵司</h2>
  <table><tr><th>Birthday</th><td>08/14/1990</td></tr><tr><th>Height</th><td>155 cm</td></tr>
  <tr><th>Breast</th><td>83 cm</td></tr><tr><th>Waist</th><td>56 cm</td></tr><tr><th>Hips</th><td>86 cm</td></tr></table>
 </div></body></html>`
 it('解析 JavModel 资料卡：日文名/中文名按连字符拆分，体型字段齐全',()=>{
  const parsed=parseJavModelProfile(profilePage)
  expect(parsed).not.toBeNull()
  expect(parsed!.romanName).toBe('Tsukasa Aoi')
  expect(parsed!.japaneseName).toBe('葵つかさ')
  expect(parsed!.chineseName).toBe('葵司')
  expect(parsed!.birthDate).toBe('1990-08-14')
  expect(parsed!.height).toBe(155)
  expect(parsed!.bust).toBe(83)
  expect(parsed!.waist).toBe(56)
  expect(parsed!.hips).toBe(86)
 })
 it('生日格式宽泛解析：日/月/年（首段>12）、ISO 与英文月名',()=>{
  const page=(birthday:string)=>profilePage.replace('08/14/1990',birthday)
  expect(parseJavModelProfile(page('25/12/1998'))!.birthDate).toBe('1998-12-25')
  expect(parseJavModelProfile(page('1997-12-07'))!.birthDate).toBe('1997-12-07')
  expect(parseJavModelProfile(page('December 7, 1997'))!.birthDate).toBe('1997-12-07')
  expect(parseJavModelProfile(page('未知'))!.birthDate).toBe('')
 })
 it('资料卡缺失或无日文名时返回 null',()=>{
  expect(parseJavModelProfile('<html><body><p>空页面</p></body></html>')).toBeNull()
  expect(parseJavModelProfile(profilePage.replace('<h2>葵つかさ - 葵司</h2>',''))).toBeNull()
 })
 it('多源合并：按传入顺序取首个非空字段，别名取并集并记录来源',()=>{
  const minnano:ActressProfile={japaneseName:'葵つかさ',romanName:'Tsukasa Aoi',chineseName:'',birthDate:'1990-08-14',height:155,bust:83,waist:0,hips:0,cup:'F',aliases:['あおいつかさ'],source:'minnanoav'}
  const javmodel:ActressProfile={japaneseName:'別名',romanName:'Aoi Tsukasa',chineseName:'葵司',birthDate:'',height:0,bust:0,waist:56,hips:86,cup:'',aliases:[],source:'javmodel'}
  const javdatabase:ActressProfile={japaneseName:'Tsukasa Aoi',romanName:'',chineseName:'',birthDate:'1999-01-01',height:160,bust:0,waist:0,hips:0,cup:'',aliases:['旧名'],source:'javdatabase'}
  const merged=mergeActressProfiles([minnano,javmodel,javdatabase])
  expect(merged!.japaneseName).toBe('葵つかさ')
  expect(merged!.chineseName).toBe('葵司')
  expect(merged!.birthDate).toBe('1990-08-14')
  expect(merged!.height).toBe(155)
  expect(merged!.waist).toBe(56)
  expect(merged!.cup).toBe('F')
  expect(merged!.aliases).toEqual(['あおいつかさ','旧名'])
  expect(merged!.source).toBe('minnanoav+javmodel+javdatabase')
  expect(mergeActressProfiles([])).toBeNull()
 })
})

describe('电影会话查询：compileQuery 的 movies 分支',()=>{
 it('movies 标志限定已刮削影片，排序键取自刮削元数据',()=>{
  const movies=compileQuery(spec({movies:true,sort:'code',direction:'asc'}))
  expect(movies.where).toContain('scrape_metadata')
  expect(movies.order).toContain('sm.code')
  expect(movies.where).not.toContain('entry_tags')
  const release=compileQuery(spec({movies:true,sort:'release',direction:'desc'}))
  expect(release.order).toContain('sm.releaseDate')
  expect(release.order).toContain('DESC')
  const duration=compileQuery(spec({movies:true,sort:'duration',direction:'desc'}))
  expect(duration.order).toContain('sm.durationMin')
 })
 it('普通查询不受 movies 分支影响，非法排序键回退到名称',()=>{
  const normal=compileQuery(spec({sort:'name',direction:'asc'}))
  expect(normal.where).not.toContain('scrape_metadata')
  expect(normal.order).toContain('e.sortKey')
  expect(compileQuery(spec({movies:true,sort:'code',direction:'asc'})).where).toContain('movie_scope')
 })
})
