import {describe,it,expect,beforeEach,afterEach} from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import {LibraryDatabase} from '../packages/persistence/database'
import {querySchema} from '../packages/contracts'
import {defaultQuery} from '../apps/desktop/src/renderer/store'
let db:LibraryDatabase
const root={id:'root',name:'测试',path:'F:\\测试',entryId:'folder',identity:'volume:1:0'}
function entry(id:string,rel:string,kind='video',parentId='folder'){return {id,rootId:'root',parentId,kind,name:rel.split('/').pop()!,rel,ext:kind==='folder'?'':'mp4',size:100,mtime:1000,identity:'volume:'+id+':0',seen:'generation'}}
const meta={entryId:'',code:'IPX-633',title:'标题',originalTitle:'',studio:'片商',series:'',releaseDate:'1995-04-01',durationMin:120,actors:['佐仓桃桃','桥本凉子'],tags:['单人作品','巨乳','中文字幕'],description:'',coverUrl:'',coverFile:'cover-a.jpg',provider:'javbus',status:'auto',scrapedAt:1000}
beforeEach(()=>{db=new LibraryDatabase(':memory:');db.addRoot(root);db.ingest([entry('a','IPX-633.mp4'),entry('b','MIDV-021.mp4'),entry('c','SSIS-714.mp4')])})
afterEach(()=>db.close())
describe('女优聚合与刮削标签集成（schema v7）',()=>{
 it('scrapePut 将刮削标签并入 entry_tags，标签计数保持最新',()=>{
  db.scrapePut('a',meta)
  expect(db.entry('a').tags).toEqual(['中文字幕','巨乳','单人作品'].sort())
  expect(db.tags().find(t=>t.name==='巨乳')?.count).toBe(1)
  // 重复写入不产生重复标签；替换标签后计数同步变化
  db.scrapePut('a',{...meta,tags:['巨乳','新分类']})
  expect(db.entry('a').tags.sort()).toEqual(['巨乳','新分类'])
  expect(db.tags().find(t=>t.name==='单人作品')).toBeUndefined()
 })
 it('scrapePut 聚合女优与作品关联，actressList 输出作品数量',()=>{
  db.scrapePut('a',meta)
  db.scrapePut('b',{...meta,entryId:'b',actors:['佐仓桃桃'],tags:[]})
  const page=db.actressList('work-desc',0,50)
  expect(page.total).toBe(2)
  const momo=page.items.find(item=>item.name==='佐仓桃桃')!
  expect(momo.workCount).toBe(2)
  // 封面取有刮削封面的作品
  expect(momo.coverEntryId).toBe('a')
  expect(db.info().actressCount).toBe(2)
 })
 it('女优排序：作品数量、名称、年龄与最近入库',()=>{
  db.scrapePut('a',meta) // 佐仓桃桃 2 部（a+b）；桥本凉子 1 部
  db.scrapePut('b',{...meta,entryId:'b',actors:['佐仓桃桃'],tags:[]})
  db.scrapePut('c',{...meta,entryId:'c',code:'SSIS-714',actors:['天海翼'],releaseDate:'2001-08-03',coverFile:''})
  // 生日来自资料补全（actressProfilePatch），而非影片发行日期。
  const rows=db.db.prepare('SELECT name,id FROM actresses').all() as {name:string;id:string}[]
  const ids=Object.fromEntries(rows.map(r=>[r.name,r.id]))
  db.actressProfilePatch(ids['佐仓桃桃']!,{birthDate:'1995-04-01',profileAt:1})
  db.actressProfilePatch(ids['天海翼']!,{birthDate:'2001-08-03',profileAt:1})
  db.actressProfilePatch(ids['桥本凉子']!,{profileAt:1,profileSource:'miss'})
  expect(db.actressList('work-desc',0,50).items.map(item=>item.name)).toEqual(['佐仓桃桃','天海翼','桥本凉子'])
  expect(db.actressList('work-asc',0,50).items.map(item=>item.name)).toEqual(['天海翼','桥本凉子','佐仓桃桃'])
  expect(db.actressList('name-asc',0,50).items.map(item=>item.name)).toEqual(['佐仓桃桃','天海翼','桥本凉子'])
  // 年龄小→大：出生越晚越靠前，无生日排最后
  expect(db.actressList('age-asc',0,50).items.map(item=>item.name)).toEqual(['天海翼','佐仓桃桃','桥本凉子'])
  expect(db.actressList('age-desc',0,50).items.map(item=>item.name)).toEqual(['佐仓桃桃','天海翼','桥本凉子'])
  expect(db.actressList('recent-desc',0,50).items[0]!.name).toBe('佐仓桃桃')
 })
 it('资料补全写入生日/身高/三围，缺失资料列表可发现待补全女优',()=>{
  db.scrapePut('a',meta)
  const missing=db.actressMissingProfiles(10)
  expect(missing.length).toBe(2)
  const target=missing.find(row=>row.name==='佐仓桃桃')!
  db.actressProfilePatch(target.id,{birthDate:'1995-04-01',height:158,bust:86,waist:58,hips:85,cup:'F',aliases:['桃桃'],profileSource:'minnanoav',profileAt:12345})
  const item=db.actressList('work-desc',0,50).items.find(row=>row.name==='佐仓桃桃')!
  expect(item.birthDate).toBe('1995-04-01')
  expect(item.height).toBe(158)
  expect(item.cup).toBe('F')
  expect(item.aliases).toEqual(['桃桃'])
  expect(db.actressMissingProfiles(10).length).toBe(1)
  // 非法数值被钳制
  db.actressProfilePatch(target.id,{height:99999,bust:-3})
  expect(db.actressList('work-desc',0,50).items.find(row=>row.name==='佐仓桃桃')!.height).toBe(300)
  expect(db.actressList('work-desc',0,50).items.find(row=>row.name==='佐仓桃桃')!.bust).toBe(0)
 })
 it('scrapeDelete 清除刮削标签与女优关联，作品数与标签计数同步下降',()=>{
  db.scrapePut('a',meta)
  db.scrapeDelete('a')
  expect(db.entry('a').tags).toEqual([])
  expect(db.actressList('work-desc',0,50).total).toBe(0)
  expect(db.actressCount()).toBe(0)
 })
 it('compileQuery 支持按女优筛选作品集合',()=>{
  db.scrapePut('a',meta)
  db.scrapePut('b',{...meta,entryId:'b',actors:['佐仓桃桃'],tags:[]})
  const session=db.openQuery(querySchema.parse({...defaultQuery,actress:'佐仓桃桃'}))
  expect(session.media).toBe(2)
  expect(db.page(session.id,0).entries.map(e=>e.id).sort()).toEqual(['a','b'])
  const none=db.openQuery(querySchema.parse({...defaultQuery,actress:'不存在'}))
  expect(none.total).toBe(0)
 })
 it('迁移回填：v6 旧库升级后刮削标签、女优与关联完整',()=>{
  const file=path.join(os.tmpdir(),`vm-v7-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const old=new LibraryDatabase(file)
  old.db.exec("INSERT INTO scrape_metadata(entryId,code,title,actors,tags,coverFile,provider) VALUES('legacy','ABC-123','旧数据','[\"旧库女优\",\"另一位\"]','[\"旧库标签\",\"巨乳\"]','x.jpg','javbus')")
  old.db.pragma('user_version=6')
  old.close()
  const migrated=new LibraryDatabase(file)
  try{
   expect(migrated.db.pragma('user_version',{simple:true})).toBe(7)
   expect(migrated.db.prepare('SELECT tag FROM entry_tags WHERE entryId=? ORDER BY tag').pluck().all('legacy')).toEqual(['巨乳','旧库标签'])
   expect(migrated.db.prepare('SELECT count(*) FROM actresses').pluck().get()).toBe(2)
   expect(migrated.db.prepare('SELECT count(*) FROM entry_actors').pluck().get()).toBe(2)
   expect(migrated.db.prepare('SELECT count(*) FROM actresses WHERE profileAt=0').pluck().get()).toBe(2)
  }finally{migrated.close();fs.rmSync(file,{force:true})}
 })
 it('管理包导出包含刮削元数据与女优资料，导入后可完整重建',()=>{
  db.scrapePut('a',meta)
  const dump=db.dump()
  expect((dump.scrape_metadata??[]).length).toBe(1)
  expect((dump.actresses??[]).length).toBe(2)
  const target=new LibraryDatabase(':memory:')
  try{
   target.importRecords({...dump,entries:[]})
   expect(target.db.prepare('SELECT count(*) FROM scrape_metadata').pluck().get()).toBe(1)
   expect(target.db.prepare('SELECT count(*) FROM actresses').pluck().get()).toBe(2)
   expect(target.db.prepare('SELECT count(*) FROM entry_actors').pluck().get()).toBe(2)
  }finally{target.close()}
 })
})
