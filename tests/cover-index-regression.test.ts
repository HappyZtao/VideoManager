import {it,expect} from 'vitest'
import {LibraryDatabase} from '../packages/persistence/database'
import {runWorkQueue} from '../packages/domain/work-queue'

it('自动目录封面优先手动快照，其次图片，避免低清视频预览压过图片',()=>{
 const db=new LibraryDatabase(':memory:')
 try{
  db.addRoot({id:'root',name:'root',path:'F:\\fixtures',entryId:'top',identity:'root'})
  for(const [id,kind]of [['video','video'],['image','image']])db.ingest([{id,rootId:'root',parentId:'top',kind,name:id,rel:id,ext:'',size:100,mtime:1,identity:id,seen:'scan'}])
  db.cover('video',0,{mode:'auto',hash:'small-video'})
  expect(db.automaticCandidates('top')[0]?.id).toBe('image')
  db.cover('video',1,{mode:'manual',hash:'chosen'})
  expect(db.automaticCandidates('top')[0]?.id).toBe('video')
 }finally{db.close()}
})

it('更新后代封面时祖先立即持有新快照，手动祖先不受影响',()=>{
 const db=new LibraryDatabase(':memory:')
 try{
  db.addRoot({id:'root',name:'root',path:'F:\\fixtures',entryId:'top',identity:'root'})
  let parent='top'
  for(const [id,kind]of [['a','folder'],['b','folder'],['video','video']]){
   db.ingest([{id,rootId:'root',parentId:parent,kind,name:id,rel:parent+'/'+id,ext:'',size:100,mtime:1,identity:id,seen:'scan'}]);parent=id!
  }
  db.cover('top',0,{mode:'manual',hash:'locked'})
  db.cover('a',0,{mode:'auto',hash:'old-a'})
  db.cover('b',0,{mode:'auto',hash:'old-b'})
  db.cover('video',0,{mode:'manual',hash:'new-cover',quality:'high'})
  const updated=db.refreshAncestorCovers('video')
  expect(updated.map(e=>e.id)).toEqual(['b','a'])
  expect(updated.every(e=>e.coverHash==='new-cover'&&e.coverRevision===2)).toBe(true)
  expect(db.entry('top').coverHash).toBe('locked')
  db.finishScan('root')
  expect(db.entry('a').coverHash).toBe('new-cover')
  expect(db.storageReferences().cache).toContain('new-cover.png')
  expect(db.storageReferences().cache).toContain('thumb-v2-a-1-2-1280.webp')
 }finally{db.close()}
})

it('目录队列在慢父目录结束前处理已发现子目录，且遵守并发上限',async()=>{
 let active=0,peak=0,childBeforeParent=false,parentDone=false
 let releaseParent!:()=>void
 const parentGate=new Promise<void>(resolve=>{releaseParent=resolve})
 await runWorkQueue(['parent'],3,async(item,enqueue)=>{
  active++;peak=Math.max(peak,active)
  if(item==='parent'){enqueue('child');await parentGate;parentDone=true}
  else if(item==='child'){childBeforeParent=!parentDone;enqueue('grandchild');releaseParent()}
  // Only the child discovers another directory.
  active--
 })
 expect(childBeforeParent).toBe(true);expect(peak).toBeLessThanOrEqual(3)
})

it('队列取消等待已运行任务收尾，不启动后续目录',async()=>{
 let finished=false;const visited:string[]=[]
 await expect(runWorkQueue(['bad','running','pending'],2,async item=>{
  visited.push(item)
  if(item==='bad')throw Error('CANCELLED')
  await new Promise(resolve=>setTimeout(resolve,10));finished=true
 })).rejects.toThrow('CANCELLED')
 expect(finished).toBe(true);expect(visited).toEqual(['bad','running'])
})
