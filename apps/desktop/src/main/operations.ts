import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID,createHash } from 'node:crypto'
import { shell } from 'electron'
import type { Entry,Plan,Selection,Task } from '../../../../packages/contracts'
import { validateName } from '../../../../packages/domain'
import type { WorkerClient } from './worker'
import type { NativeClient } from '../../../../packages/platform/native'
import type { MediaService } from './media'

type TreeItem={rel:string;identity:string;size:number;mtime:number;directory:boolean;reparse:boolean;attributes:number}
type PlannedItem={entry:Entry;source:string;destination:string|null;target:Entry|null;tree:TreeItem[];conflict:boolean}
type InternalPlan={id:string;kind:string;items:PlannedItem[];created:number;conflict:'keep'|'skip';hash:string}
export class OperationService {
 plans=new Map<string,InternalPlan>();tasks=new Map<string,Task>();cancelled=new Set<string>();busy=false
 constructor(private db:WorkerClient,private native:NativeClient,private media:MediaService,private emit:(task:Task)=>void,private quiesce:()=>Promise<void>,private finished:()=>void){}
 async tree(full:string):Promise<TreeItem[]>{const result:TreeItem[]=[];const queue=[{path:full,rel:''}];while(queue.length){const next=queue.shift()!;const stat=await this.native.call('stat',{path:next.path});result.push({...stat,rel:next.rel});if(!stat.directory||stat.reparse)continue;let cursor:string|null=null;do{const batch:any=await this.native.call('list',{path:next.path,...(cursor?{cursor}:{})});cursor=batch.cursor;for(const e of batch.entries){if(e.error)throw Error(`无法完整读取操作范围：${e.name}`);queue.push({path:path.join(next.path,e.name),rel:[next.rel,e.name].filter(Boolean).join('/')})}}while(cursor)}return result.sort((a,b)=>a.rel.localeCompare(b.rel))}
 private signature(items:TreeItem[]){return createHash('sha256').update(JSON.stringify(items.map(e=>[e.rel,e.identity,e.size,e.mtime,e.attributes]))).digest('hex')}
 async plan(selection:Selection,kind:'rename'|'move'|'trash',targetId:string|null,name:string|null,conflict:'keep'|'skip'):Promise<Plan>{
  if(this.busy)throw Error('请等待当前文件操作结束');let selected=await this.db.call<Entry[]>('selected',selection);const paths=await Promise.all(selected.map(e=>this.media.sourcePath(e)));selected=selected.filter((_,i)=>!paths.some((parent,j)=>j!==i&&paths[i]!.startsWith(parent+path.sep)))
  if(kind==='rename'&&selected.length!==1)throw Error('重命名每次仅支持一个条目');if(kind==='rename')validateName(name??'')
  let target:Entry|null=null;let destinationDir:string|null=null;if(kind==='move'){if(!targetId)throw Error('请选择目标文件夹');target=await this.db.call('entry',targetId);if(!target||target.kind!=='folder')throw Error('移动目标不是文件夹');destinationDir=await this.media.sourcePath(target)}
  const items:PlannedItem[]=[]
  for(const e of selected){if(!e.parentId)throw Error('不能对资源根目录执行文件操作；可在设置中取消纳管');const source=await this.media.sourcePath(e);let destination=kind==='trash'?null:path.join(destinationDir??path.dirname(source),kind==='rename'?name!:e.name)
   if(destination&&(destination===source||(e.kind==='folder'&&(destination+path.sep).startsWith(source+path.sep))))throw Error('不能移动到自身或后代目录')
   let exists=false;if(destination){try{await this.native.call('stat',{path:destination});exists=true}catch(error){if(!/Windows (2|3)\)/.test(String(error)))throw error}if(source.toLowerCase()===destination.toLowerCase())exists=false}
   if(exists&&conflict==='keep'&&destination){const parsed=path.parse(destination);for(let n=2;n<100000;n++){const candidate=path.join(parsed.dir,`${parsed.name} (${n})${parsed.ext}`);try{await fs.access(candidate)}catch{destination=candidate;exists=false;break}}}
   items.push({entry:e,source,destination,target,tree:await this.tree(source),conflict:exists})
  }
  if(destinationDir){const probe=path.join(destinationDir,'.vm-write-check-'+randomUUID());const handle=await fs.open(probe,'wx');await handle.close();await fs.unlink(probe);const available=await fs.statfs(destinationDir);const targetIdentity=(await this.native.call('stat',{path:destinationDir})).identity.split(':')[0];const required=items.filter(item=>!item.conflict&&item.entry.identity.split(':')[0]!==targetIdentity).reduce((bytes,item)=>bytes+item.tree.reduce((total,file)=>total+(file.directory?0:file.size),0),0);if(required>available.bavail*available.bsize)throw Error('目标磁盘可用空间不足')}
  const id=randomUUID();const plan:InternalPlan={id,kind,items,created:Date.now(),conflict,hash:''};plan.hash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');this.plans.set(id,plan)
  return {id,kind,expires:plan.created+300000,message:'整目录操作包含隐藏文件和非媒体文件；同名目标不会被覆盖。',items:items.map(i=>({id:i.entry.id,name:i.entry.name,source:i.source,destination:i.destination,files:i.tree.filter(t=>!t.directory).length,folders:i.tree.filter(t=>t.directory).length,bytes:i.tree.reduce((s,t)=>s+(t.directory?0:t.size),0),conflict:i.conflict}))}
 }
 async commit(id:string){const existing=this.tasks.get(id);if(existing)return existing;const plan=this.plans.get(id);if(!plan||Date.now()-plan.created>300000)throw Error('操作计划已过期，请重新确认');if(this.busy)throw Error('另一个文件操作正在执行');this.busy=true
  const task:Task={id,kind:'operation',name:{rename:'重命名',move:'移动文件',trash:'移入回收站'}[plan.kind]??'文件操作',state:'running',discovered:plan.items.length,processed:0,failed:0,message:'正在重新检查文件',results:[]};this.tasks.set(id,task);this.emit({...task});void this.run(plan,task);return task
 }
 cancel(id:string){this.cancelled.add(id);if(this.tasks.has(id))void fs.writeFile(path.join(this.media.dataDir,'temp','cancel-'+id),'cancel',{flag:'wx'}).catch(()=>{})}
 private async run(plan:InternalPlan,task:Task){
  try{await this.quiesce();await this.media.pauseWork();for(const item of plan.items){if(this.cancelled.has(plan.id)){task.state='cancelled';break}if(item.conflict){task.results!.push({name:item.entry.name,source:item.source,destination:item.destination,state:'skipped',message:'同名目标已存在，跳过'});task.failed++;task.message=`已跳过同名目标：${item.entry.name}`;this.emit({...task});continue}
    try{const current=await this.tree(item.source);if(this.signature(current)!==this.signature(item.tree))throw Error('SOURCE_CHANGED：文件或目录内容已变化，请重新确认');if(plan.kind==='trash')await this.trash(plan,item);else await this.move(plan,item);task.processed++;task.results!.push({name:item.entry.name,source:item.source,destination:item.destination,state:'completed',message:plan.kind==='trash'?'已移入系统回收站':'已完成'});task.message=`已完成：${item.entry.name}`}catch(error){task.failed++;task.results!.push({name:item.entry.name,source:item.source,destination:item.destination,state:'failed',message:String(error)});task.message=`${item.entry.name}：${String(error)}`}this.emit({...task})
   }if(this.cancelled.has(plan.id))task.state='cancelled';else if(task.state!=='cancelled')task.state=task.failed?'completed-errors':'completed';if(!task.failed&&task.state==='completed')task.message='所有项目已完成'
  }catch(error){task.state='failed';task.failed++;task.message=String(error)}finally{this.busy=false;this.media.resumeWork();this.emit({...task});this.finished()}
 }
 private async trash(plan:InternalPlan,item:PlannedItem){const op=`${plan.id}:${item.entry.id}`;const data={kind:'trash',source:item.source,entryId:item.entry.id,identity:item.entry.identity,planHash:plan.hash};await this.db.call('log',op,'TRASH_REQUESTED',data);try{await shell.trashItem(item.source);await this.db.call('trash',item.entry.id);await this.db.call('log',op,'DONE',data)}catch(error){await this.db.call('log',op,'RECOVERY_REQUIRED',{...data,error:String(error)});throw error}}
 private async move(plan:InternalPlan,item:PlannedItem){const sourceInfo=item.tree.find(t=>t.rel==='')!;const destination=item.destination!;const parent=item.target??await this.db.call<Entry>('entry',item.entry.parentId);const parentPath=await this.media.sourcePath(parent);const destInfo=await this.native.call('stat',{path:parentPath});const name=path.basename(destination);const rel=parent.rel?parent.rel+'/'+name:name;const op=`${plan.id}:${item.entry.id}`;let data:any={kind:plan.kind,entryId:item.entry.id,source:item.source,destination,identity:item.entry.identity,rootId:parent.rootId,parentId:parent.id,rel,name,expectedSize:sourceInfo.size,expectedMtime:sourceInfo.mtime,planHash:plan.hash}
  await this.db.call('log',op,'PREPARED',data)
  if(sourceInfo.identity.split(':')[0]===destInfo.identity.split(':')[0]){
   if(item.source.toLowerCase()===destination.toLowerCase()){
    const temporary=path.join(path.dirname(item.source),`.vm-rename-${randomUUID()}`);data={...data,temporary};await this.db.call('log',op,'CASE_PREPARED',data);await this.native.call('rename',{source:item.source,destination:temporary,identity:item.entry.identity});await this.db.call('log',op,'CASE_STAGED',data);await this.native.call('rename',{source:temporary,destination,identity:item.entry.identity})
   }else await this.native.call('rename',{source:item.source,destination,identity:item.entry.identity,expectedSize:sourceInfo.size,expectedMtime:sourceInfo.mtime})
   await this.db.call('log',op,'FS_APPLIED',data);await this.db.call('relocate',item.entry.id,parent.rootId,parent.id,rel,name);await this.db.call('log',op,'DONE',data);return
  }
  if(item.tree.some(t=>t.reparse))throw Error('跨磁盘移动包含链接，已停止并保留源目录')
  if(item.entry.kind==='folder'){await this.moveDirectory(plan,item,parent,op,data);return}
  const identity=await this.copyFile(plan.id,op,item.source,destination,item.entry.identity,data)
  await this.db.call('relocate',item.entry.id,parent.rootId,parent.id,rel,name,{[item.entry.id]:identity});await this.db.call('log',op,'DONE',{...data,targetIdentity:identity})
 }
 private async copyFile(planId:string,op:string,source:string,destination:string,identity:string,data:any){const token=randomUUID();const temporary=path.join(path.dirname(destination),`.vm-copy-${token}.tmp`);let details={...data,temporary,token};await this.db.call('log',op,'COPYING',details)
  try{const copy=await this.native.call('copy',{source,temporary,identity,token,cancelPath:path.join(this.media.dataDir,'temp','cancel-'+planId),...(data.expectedSize!==undefined?{expectedSize:data.expectedSize,expectedMtime:data.expectedMtime}:{})},24*60*60*1000);details={...details,...copy,targetIdentity:copy.identity};await this.db.call('log',op,'VERIFIED',details)
   if(this.cancelled.has(planId)){await this.db.call('log',op,'CANCELLED',details);throw Error('复制已取消；源文件仍保留，校验副本留待检查')}
   await this.native.call('publish',{temporary,destination,identity:copy.identity});await this.db.call('log',op,'PUBLISHED',details);await this.db.call('log',op,'SOURCE_REMOVE_REQUESTED',details)
   try{await this.native.call('removeHeld',{token,identity})}catch(error){await this.db.call('log',op,'SOURCE_RETAINED',{...details,error:String(error)});throw Error('目标副本已校验，但源文件无法移除；两处均保留')}
   await this.db.call('log',op,'SOURCE_REMOVED',details);await this.native.call('attributes',{path:destination,attributes:copy.attributes}).catch(()=>{});return copy.identity as string
  }finally{await this.native.call('release',{token}).catch(()=>{})}
 }
 private async moveDirectory(plan:InternalPlan,item:PlannedItem,parent:Entry,op:string,data:any){
  const targetMap=new Map<string,{entry:Entry;identity:string}>();const sourceEntries=await this.db.call<any[]>('rootEntries',item.entry.rootId);const sourceByRel=new Map(sourceEntries.map(e=>[e.rel,e]));const folders=item.tree.filter(t=>t.directory).sort((a,b)=>a.rel.length-b.rel.length)
  for(const folder of folders){if(this.cancelled.has(plan.id))throw Error('操作已取消；已完成项目保留');const destination=folder.rel?path.join(item.destination!,...folder.rel.split('/')):item.destination!;const stat=await this.native.call('mkdir',{path:destination});const rel=folder.rel?data.rel+'/'+folder.rel:data.rel;const p=folder.rel?targetMap.get(path.posix.dirname(folder.rel)==='.'?'':path.posix.dirname(folder.rel))!.entry:parent;const name=path.basename(destination);const [saved]=await this.db.call('ingest',[{id:randomUUID(),rootId:parent.rootId,parentId:p.id,kind:'folder',name,rel,ext:'',size:0,mtime:stat.mtime,identity:stat.identity,seen:plan.id}]);targetMap.set(folder.rel,{entry:await this.db.call('entry',saved.id),identity:stat.identity})}
  for(const file of item.tree.filter(t=>!t.directory)){if(this.cancelled.has(plan.id))throw Error('操作已取消；已完成项目保留');const source=path.join(item.source,...file.rel.split('/'));const destination=path.join(item.destination!,...file.rel.split('/'));const oldRel=item.entry.rel+'/'+file.rel;const entry=sourceByRel.get(oldRel);const folderRel=path.posix.dirname(file.rel)==='.'?'':path.posix.dirname(file.rel);const target=targetMap.get(folderRel)!.entry;const childOp=op+':'+createHash('sha256').update(file.rel).digest('hex').slice(0,12);const fileData={kind:'move',source,destination,identity:file.identity,entryId:entry?.id??null,expectedSize:file.size,expectedMtime:file.mtime,rootId:parent.rootId,parentId:target.id,rel:data.rel+'/'+file.rel,name:path.basename(destination)}
   const identity=await this.copyFile(plan.id,childOp,source,destination,file.identity,fileData);if(entry)await this.db.call('relocate',entry.id,parent.rootId,target.id,fileData.rel,fileData.name,{[entry.id]:identity});await this.db.call('log',childOp,'DONE',{...fileData,targetIdentity:identity})
  }
  for(const folder of [...folders].reverse()){const source=folder.rel?path.join(item.source,...folder.rel.split('/')):item.source;const original=sourceByRel.get(folder.rel?item.entry.rel+'/'+folder.rel:item.entry.rel);const temporary=targetMap.get(folder.rel)!;const branchId=op+':directory:'+temporary.entry.id;const branch={kind:'move',entryId:original?.id??null,temporaryEntryId:temporary.entry.id,source,destination:folder.rel?path.join(item.destination!,...folder.rel.split('/')):item.destination,identity:folder.identity,targetIdentity:temporary.identity,rootId:parent.rootId,parentId:temporary.entry.parentId,rel:temporary.entry.rel,name:temporary.entry.name};await this.db.call('log',branchId,'DIRECTORY_SOURCE_REMOVE_REQUESTED',branch);await this.native.call('removeEmpty',{path:source,identity:folder.identity});if(original){await this.db.call('adoptDirectory',original.id,temporary.entry.id,temporary.identity)}await this.db.call('log',branchId,'DONE',branch)}
  await this.db.call('log',op,'DONE',data)
 }
 async recover(){const logs=await this.db.call<any[]>('operations');for(const log of logs){if(['DONE','RECOVERY_REQUIRED','SOURCE_RETAINED','CANCELLED'].includes(log.state))continue;const d=log.data;try{if(d.kind==='trash')throw Error('回收站请求结果待核实；请在系统回收站检查，不会自动再次执行');let source:any=null,target:any=null;try{source=await this.native.call('stat',{path:d.source})}catch{}try{target=await this.native.call('stat',{path:d.destination})}catch{}
   if(!source&&target&&d.entryId&&(target.identity===d.identity||target.identity===d.targetIdentity)){if(d.temporaryEntryId)await this.db.call('adoptDirectory',d.entryId,d.temporaryEntryId,target.identity);else await this.db.call('relocate',d.entryId,d.rootId,d.parentId,d.rel,d.name,{[d.entryId]:target.identity});await this.db.call('log',log.id,'DONE',{...d,recovered:true})}
   else throw Error('文件操作未完成；原文件、临时副本及目标均予以保留，请检查记录')
  }catch(error){await this.db.call('log',log.id,'RECOVERY_REQUIRED',{...d,error:String(error)});const task:Task={id:log.id,kind:'recovery',name:'待检查的文件操作',state:'failed',discovered:1,processed:0,failed:1,message:String(error)};this.tasks.set(task.id,task);this.emit(task)}}}
}
