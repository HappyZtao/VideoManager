import {runWorkQueue} from '../../../../packages/domain/work-queue'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NativeClient } from '../../../../packages/platform/native'
import { discoverKind } from '../../../../packages/domain'
import type { Root,Task } from '../../../../packages/contracts'

const parent=process.parentPort!
const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
const tasks=new Map<string,{pause:boolean;cancel:boolean}>()
let fs:NativeClient
let nativePath=''
const db=(method:string,...args:unknown[])=>new Promise<any>((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});parent.postMessage({rpc:id,method,args})})
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function scan(root:Root,taskId:string,excluded:string[],workerCount=2){
 const control={pause:false,cancel:false};tasks.set(taskId,control)
 const task:Task={id:taskId,kind:'scan',name:'索引 '+root.name,state:'running',discovered:0,processed:0,total:0,failed:0,message:'正在统计待处理文件',phase:'discover',progress:0}
 let handedOff=false
 let last=0;const emit=(force=false)=>{if(force||Date.now()-last>250){last=Date.now();parent.postMessage({event:'task',task:{...task}})}}
 const checkpoint=async()=>{while(control.pause&&!control.cancel){task.state='paused';emit();await sleep(150)}task.state='running';if(control.cancel)throw Error('CANCELLED')}
 try {
  const identity=await fs.call('stat',{path:root.path});if(identity.reparse)throw Error('资源根目录不能是符号链接或目录联接');if(root.identity&&identity.identity!==root.identity)throw Error('ROOT_IDENTITY_CHANGED：此位置不是原来的磁盘或目录，请重绑')
  await db('rootState',root.id,'scanning');const generation=randomUUID()
  const concurrency=Math.min(16,Math.max(1,Math.round(workerCount)))
  const clients=Array.from({length:concurrency},()=>new NativeClient(nativePath))
  const available=[...clients]
  type Directory={path:string;rel:string;id:string}
  try{
   await runWorkQueue<Directory>([{path:root.path,rel:'',id:root.entryId}],concurrency,async(dir,enqueue)=>{
    const client=available.pop()!;let cursor:string|null=null;let other=0;let complete=true
    try{
     do{
      await checkpoint()
      task.message=`读取并索引 · ${dir.rel||root.name}`
      const result:any=await client.call('list',{path:dir.path,...(cursor?{cursor}:{})});cursor=result.cursor
      const source:any[]=[]
      for(const item of result.entries){
       if(item.error){complete=false;task.failed++;continue}
       const full=path.join(dir.path,item.name)
       if(item.hidden||item.reparse||item.name.startsWith('.')||excluded.some(x=>full.toLowerCase()===x.toLowerCase()||full.toLowerCase().startsWith(x.toLowerCase()+path.sep)))continue
       const kind=item.directory?'folder':discoverKind(item.name)
       if(!kind){other++;continue}
       source.push({...item,full,rel:dir.rel?dir.rel+'/'+item.name:item.name,kind});task.discovered++
      }
      if(source.length){
       const lookup=await db('lookupBatch',root.id,source.map(item=>({rel:item.rel,identity:item.identity})))
       const byRel=new Map<string,any>(lookup.map((item:any)=>[item.rel,item]));const batch=[]
       for(const item of source){
        let reuseId:string|undefined;const match=byRel.get(item.rel)
        if(!match?.known&&match?.matches.length===1){const old=match.matches[0];try{await client.call('stat',{path:path.join(old.rootPath,...old.rel.split('/'))})}catch(error){if(/Windows (2|3)\)/.test(String(error)))reuseId=old.id}}
        batch.push({id:randomUUID(),rootId:root.id,parentId:dir.id,kind:item.kind,name:item.name,rel:item.rel,ext:item.kind==='folder'?'':item.name.split('.').pop().toLowerCase(),size:item.size,mtime:item.mtime,identity:item.identity,seen:generation,...(reuseId?{reuseId}:{})})
       }
       // Commit parents before scheduling children; read other directories while
       // the single SQLite writer commits this batch.
       const saved=await db('ingest',batch)
       for(const entry of saved)if(entry.kind==='folder')enqueue({path:path.join(root.path,...entry.rel.split('/')),rel:entry.rel,id:entry.id})
       task.processed+=saved.length
      }
      emit()
     }while(cursor)
     if(complete)await db('finishDirectory',dir.id,generation,other)
    }catch(error){if(String(error).includes('CANCELLED'))throw error;task.failed++;task.message=String(error);emit(true)}
    finally{available.push(client)}
   })
  }finally{for(const client of clients)client.close()}
  task.total=task.discovered*2
  await db('finishScan',root.id);await db('rootState',root.id,'online');task.phase='covers';task.progress=task.total?Math.round(task.processed/task.total*100):50;task.message='文件目录已建立，正在创建封面';handedOff=true;emit(true);parent.postMessage({event:'catalogued',rootId:root.id,generation,task:{...task}})
 }catch(error){task.state=control.cancel?'cancelled':'failed';task.message=control.cancel?'已取消；未完成目录的旧索引已保留':String(error);await db('rootState',root.id,control.cancel?'incomplete':'offline')}
 finally{if(!handedOff)emit(true);tasks.delete(taskId)}
}
parent.on('message',event=>{const m=event.data;if(m.rpc){const p=pending.get(m.rpc);pending.delete(m.rpc);if(m.error)p?.reject(Error(m.error));else p?.resolve(m.result);return}
 if(m.method==='init'){nativePath=m.native;fs=new NativeClient(nativePath);return}
 if(m.method==='scan')void scan(m.root,m.taskId,m.excluded,m.concurrency)
 if(m.method==='control'){const task=tasks.get(m.id);if(task){if(m.action==='pause')task.pause=true;if(m.action==='resume')task.pause=false;if(m.action==='cancel')task.cancel=true}}
})
