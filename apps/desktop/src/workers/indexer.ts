import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NativeClient } from '../../../../packages/platform/native'
import { discoverKind } from '../../../../packages/domain'
import type { Root,Task } from '../../../../packages/contracts'

const parent=process.parentPort!
const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>()
const tasks=new Map<string,{pause:boolean;cancel:boolean}>()
let fs:NativeClient
const db=(method:string,...args:unknown[])=>new Promise<any>((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});parent.postMessage({rpc:id,method,args})})
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function scan(root:Root,taskId:string,excluded:string[]){
 const control={pause:false,cancel:false};tasks.set(taskId,control)
 const task:Task={id:taskId,kind:'scan',name:'索引 '+root.name,state:'running',discovered:0,processed:0,failed:0,message:'正在发现目录'}
 let last=0;const emit=(force=false)=>{if(force||Date.now()-last>500){last=Date.now();parent.postMessage({event:'task',task:{...task}})}}
 const checkpoint=async()=>{while(control.pause&&!control.cancel){task.state='paused';emit();await sleep(150)}task.state='running';if(control.cancel)throw Error('CANCELLED')}
 try {
  const identity=await fs.call('stat',{path:root.path});if(identity.reparse)throw Error('资源根目录不能是符号链接或目录联接');if(root.identity&&identity.identity!==root.identity)throw Error('ROOT_IDENTITY_CHANGED：此位置不是原来的磁盘或目录，请重绑')
  await db('rootState',root.id,'scanning');const queue=[{id:root.entryId,path:root.path,rel:''}];const generation=randomUUID()
  while(queue.length){await checkpoint();const dir=queue.shift()!;let cursor:string|null=null;let other=0;let complete=true;task.message=dir.rel||root.name
   try{do{
    await checkpoint();const result:any=await fs.call('list',{path:dir.path,...(cursor?{cursor}:{})});cursor=result.cursor
    const batch:any[]=[]
    const lookup=await db('lookupBatch',root.id,result.entries.filter((item:any)=>!item.error).map((item:any)=>({rel:dir.rel?dir.rel+'/'+item.name:item.name,identity:item.identity})))
    const byRel=new Map<string,any>(lookup.map((item:any)=>[item.rel,item]))
    for(const item of result.entries){
     if(item.error){complete=false;task.failed++;continue}const full=path.join(dir.path,item.name)
     if(item.hidden||item.reparse||item.name.startsWith('.')||excluded.some(x=>full===x||full.startsWith(x+path.sep)))continue
     const kind=item.directory?'folder':discoverKind(item.name);if(!kind){other++;continue}
     const rel=dir.rel?dir.rel+'/'+item.name:item.name;let reuseId:string|undefined
     const match=byRel.get(rel)
     if(!match?.known){const same=match?.matches??[];if(same.length===1){const old=same[0];try{await fs.call('stat',{path:path.join(old.rootPath,...old.rel.split('/'))})}catch(error){if(/Windows (2|3)\)/.test(String(error)))reuseId=old.id}}}
     batch.push({id:randomUUID(),rootId:root.id,parentId:dir.id,kind,name:item.name,rel,ext:kind==='folder'?'':item.name.split('.').pop().toLowerCase(),size:item.size,mtime:item.mtime,identity:item.identity,seen:generation,...(reuseId?{reuseId}:{})});task.discovered++
    }
    const saved=!cursor&&complete?await db('ingestDirectory',batch,dir.id,generation,other):await db('ingest',batch)
    for(const e of saved){if(e.kind==='folder')queue.push({id:e.id,path:path.join(root.path,...e.rel.split('/')),rel:e.rel});task.processed++}
    emit();await sleep(0)
   }while(cursor)
   }catch(error){if(String(error).includes('CANCELLED'))throw error;task.failed++;complete=false;task.message=String(error);emit(true)}
  }
  await db('finishScan',root.id);await db('rootState',root.id,'online');task.state=task.failed?'completed-errors':'completed';task.message=task.failed?`${task.failed} 个目录或条目读取失败；已保留其旧索引`:'索引已更新'
 }catch(error){task.state=control.cancel?'cancelled':'failed';task.message=control.cancel?'已取消；未完成目录的旧索引已保留':String(error);await db('rootState',root.id,control.cancel?'incomplete':'offline')}
 finally{emit(true);tasks.delete(taskId)}
}
parent.on('message',event=>{const m=event.data;if(m.rpc){const p=pending.get(m.rpc);pending.delete(m.rpc);if(m.error)p?.reject(Error(m.error));else p?.resolve(m.result);return}
 if(m.method==='init'){fs=new NativeClient(m.native);return}
 if(m.method==='scan')void scan(m.root,m.taskId,m.excluded)
 if(m.method==='control'){const task=tasks.get(m.id);if(task){if(m.action==='pause')task.pause=true;if(m.action==='resume')task.pause=false;if(m.action==='cancel')task.cancel=true}}
})
