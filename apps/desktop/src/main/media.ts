import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { NativeClient } from '../../../../packages/platform/native'
import { discoverKind } from '../../../../packages/domain'
import type { Crop,Entry,Frame,CoverSource } from '../../../../packages/contracts'
import type { WorkerClient } from './worker'

type Lease={path:string;entryId:string|null;revision:number;identity:string|null;expires:number;mime:string}
type Source={path:string;entry:Entry|null;kind:string;name:string;decoder:NativeClient|null;duration:number;generation:number;identity:string}
type Snapshot={path:string;sourceId:string|null;sourceRevision:number;identity:string|null;pts:string;generation:number;handle:string|null;expires:number;independent?:boolean}
export class MediaService {
 leases=new Map<string,Lease>();sources=new Map<string,Source>();frames=new Map<string,Snapshot>()
 private thumbs=new Map<string,Promise<string>>();private queue:Promise<unknown>=Promise.resolve();private errors=new Map<string,{at:number;message:string}>()
 private probing=new Set<string>();private closed=false;private paused=false;autoEnabled=true
 constructor(public dataDir:string,public nativeDir:string,public db:WorkerClient,public images:WorkerClient,public nativeFs:NativeClient,public broadcast:()=>void){}
 async sourcePath(e:Entry){const root=await this.db.call('root',e.rootId);if(!root.path||['offline','mismatch'].includes(root.state))throw Error('资源目录离线，请连接磁盘后重试');const full=path.resolve(root.path,...e.rel.split('/'));const rel=path.relative(root.path,full);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('资源路径越界');const stat=await this.nativeFs.call('stat',{path:full});if(stat.identity!==e.identity||stat.reparse)throw Error('SOURCE_CHANGED：原文件已被替换，请刷新目录');return full}
 grant(file:string,mime:string,entry:Entry|null=null){const token=randomUUID();this.leases.set(token,{path:file,mime,entryId:entry?.id??null,revision:entry?.revision??0,identity:entry?.identity??null,expires:Date.now()+12*60*60*1000});return `media://resource/${token}`}
 resolve(token:string){const lease=this.leases.get(token);if(!lease||lease.expires<Date.now())throw Error('媒体访问已过期');return lease}
 release(url:string){try{this.leases.delete(new URL(url).pathname.slice(1))}catch{}}
 resetFailures(){this.errors.clear();for(const [key,frame]of this.frames)if(frame.expires<Date.now())this.frames.delete(key);for(const [key,lease]of this.leases)if(lease.expires<Date.now())this.leases.delete(key)}
 private serialize<T>(fn:()=>Promise<T>):Promise<T>{const promise=this.queue.then(fn,fn);this.queue=promise.catch(()=>{});return promise}
 async scheduleProbe(rootId:string){if(this.probing.has(rootId)||this.closed)return;this.probing.add(rootId);let changed=false;try{while(!this.closed){if(this.paused){await new Promise(resolve=>setTimeout(resolve,150));continue}const rows=await this.db.call<Entry[]>('unprobed',rootId,50);if(!rows.length)break;for(const e of rows){if(this.closed)return;await this.serialize(async()=>{if(this.closed||this.paused)return;try{if(!e.size)throw Error('空文件无法解码');const file=await this.sourcePath(e);let info:any;if(e.kind==='image'&&e.ext!=='bmp')info=await this.images.call('probe',file);else{const decoder=new NativeClient(path.join(this.nativeDir,'vm-media.exe'));try{info=await decoder.call('open',{path:file})}finally{decoder.close()}}await this.db.call('metadata',e.id,e.revision,info);changed=true}catch(error){if(this.closed)return;await this.db.call('metadata',e.id,e.revision,{error:String(error)});changed=true}})}await new Promise(resolve=>setTimeout(resolve,40))}}catch{/* Process shutdown interrupts background probes. */}finally{this.probing.delete(rootId);if(changed&&!this.closed)this.broadcast()}}
 async pauseWork(){this.paused=true;await this.queue;this.releaseAll()}
 resumeWork(){this.paused=false;this.resetFailures()}
 async media(id:string,purpose:string){const e=await this.db.call<Entry>('entry',id);if(purpose==='original'){const full=await this.sourcePath(e);const mime=e.kind==='image'?({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'}[e.ext]??'application/octet-stream'):e.ext==='webm'?'video/webm':e.ext==='mov'?'video/quicktime':e.ext==='mkv'?'video/x-matroska':'video/mp4';return this.grant(full,mime,e)}
  const key=`${id}-${e.revision}-${e.coverRevision}`;const error=this.errors.get(key);if(error&&Date.now()-error.at<60000)throw Error(error.message)
  let pending=this.thumbs.get(key);if(!pending){pending=this.serialize(()=>this.thumbnail(e));this.thumbs.set(key,pending);void pending.catch(err=>this.errors.set(key,{at:Date.now(),message:String(err)})).finally(()=>this.thumbs.delete(key))}
  return this.grant(await pending,'image/webp')
 }
 async thumbnail(e:Entry){
  if(this.closed||this.paused)throw Error('文件操作期间预览暂时停止')
  const cache=path.join(this.dataDir,'cache');await fs.mkdir(cache,{recursive:true});const target=path.join(cache,`thumb-${e.id}-${e.revision}-${e.coverRevision}.webp`);try{await fs.access(target);return target}catch{}
  let source:string
  if(e.coverHash){source=path.join(this.dataDir,e.coverMode==='manual'?'objects':'cache',e.coverHash+'.png');try{await fs.access(source)}catch{if(e.coverMode==='manual')throw Error('手动封面对象缺失');source=await this.generateAutomatic(e)}}
  else if(e.kind==='image'){source=await this.sourcePath(e);if(e.ext==='bmp')source=(await this.decodeTemporary(e,0)).path;else{const metadata=await this.images.call('probe',source);await this.db.call('metadata',e.id,e.revision,metadata)}}
  else source=await this.generateAutomatic(e)
  const result=await this.images.call('thumbnail',source,cache,512);await fs.copyFile(result.path,target);return target
 }
 async decodeTemporary(e:Entry,time:number){const decoder=new NativeClient(path.join(this.nativeDir,'vm-media.exe'));try{const full=await this.sourcePath(e);const meta=await decoder.call('open',{path:full});await this.db.call('metadata',e.id,e.revision,meta);const output=path.join(this.dataDir,'temp',randomUUID()+'.png');await fs.mkdir(path.dirname(output),{recursive:true});const frame=await decoder.call('frame',{time,step:0,output},20000);const normalized=await this.images.call('normalize',output,path.join(this.dataDir,'cache'),frame.rotation);await fs.unlink(output).catch(()=>{});return {...normalized,...frame,sourceId:e.id,sourceRevision:e.revision,identity:e.identity}}finally{decoder.close()}}
 async generateAutomatic(e:Entry){if(!this.autoEnabled)throw Error('自动封面插件已停用');const frames=await this.recommendInternal(e);const first=frames[0];if(!first)throw Error(e.kind==='folder'?'此目录暂无可用封面':'视频不能解码，请指定图片封面');const snapshot=this.frames.get(first.token)!;const crop={mode:'cover',x:.5,y:.5,zoom:1};const result=await this.images.call('crop',snapshot.path,path.join(this.dataDir,'cache'),crop);if(this.autoEnabled)await this.db.call('cover',e.id,e.coverRevision,{mode:'auto',hash:result.hash,source:snapshot.sourceId,pts:snapshot.pts,crop},true);return result.path}
 async source(id:string|null):Promise<CoverSource|null>{let entry:Entry|null=null;let file:string;let kind:string
  if(id){entry=await this.db.call('entry',id);if(!entry||entry.kind==='folder')throw Error('请选择图片或视频');file=await this.sourcePath(entry);kind=entry.kind}
  else {const choice=await dialog.showOpenDialog({title:'选择封面来源',properties:['openFile'],filters:[{name:'图片与视频',extensions:['jpg','jpeg','png','webp','gif','bmp','mp4','webm','mov','mkv','avi']}]});if(choice.canceled||!choice.filePaths[0])return null;file=choice.filePaths[0];kind=discoverKind(file)??'';if(!kind)throw Error('不支持此来源格式')}
  for(const handle of this.sources.keys())this.closeSource(handle)
  const stat=await this.nativeFs.call('stat',{path:file});if(stat.reparse)throw Error('请选择实际媒体文件，不能使用链接');const handle=randomUUID();let duration=0;let decoder:NativeClient|null=null
  if(kind==='video'||file.toLowerCase().endsWith('.bmp')){decoder=new NativeClient(path.join(this.nativeDir,'vm-media.exe'));try{const meta=await decoder.call('open',{path:file});duration=meta.duration;if(entry)await this.db.call('metadata',entry.id,entry.revision,meta)}catch(error){decoder.close();throw error}}
  this.sources.set(handle,{path:file,entry,kind,name:path.basename(file),decoder,duration,generation:0,identity:stat.identity});return {handle,name:path.basename(file),kind:kind as 'image'|'video',duration,sourceId:entry?.id??null,playbackUrl:kind==='video'?this.grant(file,file.toLowerCase().endsWith('.webm')?'video/webm':'video/mp4',entry):null}
 }
 async coverSnapshot(id:string){const e=await this.db.call<Entry>('entry',id);if(e.coverMode!=='manual'||!e.coverOriginal)throw Error('没有已保存的手动快照');const file=path.join(this.dataDir,'objects',e.coverOriginal+'.png');const info=await this.images.call('probe',file);let status='独立封面快照';if(e.coverSource){try{const source=await this.db.call<Entry>('entry',e.coverSource);if(source.state!=='present'||['offline','mismatch'].includes(source.rootState))status+=' · 来源已不可用';else if(e.kind==='folder'&&!(await this.db.call<Entry[]>('ancestors',source.id)).some(a=>a.id===e.id))status+=' · 来源不在此目录'}catch{status+=' · 来源已不可用'}}const token=randomUUID();this.frames.set(token,{path:file,sourceId:e.coverSource,sourceRevision:0,identity:null,pts:e.coverPts??'0',generation:0,handle:null,expires:Date.now()+3600000,independent:true});return {frame:{token,url:this.grant(file,'image/png'),time:0,pts:e.coverPts??'0',ordinal:0,width:info.width,height:info.height,duration:0,generation:0},status}}
 async frame(handle:string,time:number,step:number,generation:number):Promise<Frame>{const source=this.sources.get(handle);if(!source)throw Error('选帧会话已结束');source.generation=Math.max(source.generation,generation);const directory=path.join(this.dataDir,'temp');await fs.mkdir(directory,{recursive:true});let snapshot:any,info:any={time:0,pts:'0',ordinal:0,duration:source.duration}
  if(source.decoder){const output=path.join(directory,randomUUID()+'.png');info=await source.decoder.call('frame',{time,step,output},20000);snapshot=await this.images.call('normalize',output,directory,info.rotation);await fs.unlink(output).catch(()=>{})}
  else snapshot=await this.images.call('normalize',source.path,directory)
  if(source.generation!==generation)throw Error('FRAME_SUPERSEDED')
  const token=randomUUID();this.frames.set(token,{path:snapshot.path,sourceId:source.entry?.id??null,sourceRevision:source.entry?.revision??0,identity:source.identity,pts:info.pts,generation,handle,expires:Date.now()+3600000})
  return {token,url:this.grant(snapshot.path,'image/png'),time:info.time,pts:info.pts,ordinal:info.ordinal,width:snapshot.width,height:snapshot.height,duration:source.duration,generation}
 }
 closeSource(handle:string){this.sources.get(handle)?.decoder?.close();this.sources.delete(handle);for(const [token,frame]of this.frames)if(frame.handle===handle)this.frames.delete(token)}
 async save(target:string,token:string,crop:Crop,revision:number){const selected=this.frames.get(token);if(!selected||selected.expires<Date.now())throw Error('FRAME_NOT_READY：画面已过期，请重新选择');if(selected.sourceId&&!selected.independent){const source=await this.db.call<Entry>('entry',selected.sourceId);if(source.revision!==selected.sourceRevision)throw Error('来源已变化，请重新选择画面')}if(selected.handle){const source=this.sources.get(selected.handle);if(!source||source.generation!==selected.generation)throw Error('FRAME_NOT_READY：请等待最新画面');const stat=await this.nativeFs.call('stat',{path:source.path});if(stat.identity!==selected.identity)throw Error('来源已变化，请重新打开')}
  const objectDir=path.join(this.dataDir,'objects');const original=await this.images.call('normalize',selected.path,objectDir);const result=await this.images.call('crop',original.path,objectDir,crop)
  await this.db.call('cover',target,revision,{mode:'manual',hash:result.hash,original:original.hash,source:selected.sourceId,pts:selected.pts,crop})
 }
 async recommend(target:string){const e=await this.db.call<Entry>('entry',target);return this.serialize(()=>this.recommendInternal(e))}
 private async recommendInternal(e:Entry):Promise<Frame[]>{const all=await this.db.call<Entry[]>('candidates',e.id);const start=Date.now();const scored:{frame:Frame;score:number;fingerprint:string}[]=[]
  const distributed=(items:Entry[],limit:number)=>items.length<=limit?items:Array.from({length:limit},(_,i)=>items[Math.floor(i*(items.length-1)/(limit-1))]!)
  const candidates=[...distributed(all.filter(v=>v.kind==='image'),24),...distributed(all.filter(v=>v.kind==='video'),4)]
  for(const candidate of candidates){if(Date.now()-start>10000)break;try{let frames:any[]=[]
   if(candidate.kind==='image'&&candidate.ext!=='bmp'){const source=await this.sourcePath(candidate);const normalized=await this.images.call('normalize',source,path.join(this.dataDir,'cache'));frames=[{...normalized,time:0,pts:'0',ordinal:0,duration:0}]}
   else {const first=await this.decodeTemporary(candidate,candidate.duration?candidate.duration*.15:0);frames.push(first);if(first.duration>0){for(const factor of [.35,.55,.75,.9]){if(Date.now()-start>9500)break;frames.push(await this.decodeTemporary(candidate,first.duration*factor))}}}
   for(const f of frames){const score=await this.images.call('score',f.path);if(scored.some(s=>s.fingerprint===score.fingerprint))continue;const token=randomUUID();this.frames.set(token,{path:f.path,sourceId:candidate.id,sourceRevision:candidate.revision,identity:candidate.identity,pts:f.pts,generation:0,handle:null,expires:Date.now()+3600000});scored.push({frame:{token,url:this.grant(f.path,'image/png'),time:f.time,pts:f.pts,ordinal:f.ordinal,width:f.width,height:f.height,duration:f.duration,generation:0},...score})}
  }catch{/* Individual corrupt media does not abort the folder. */}}
  return scored.sort((a,b)=>b.score-a.score).slice(0,6).map(s=>s.frame)
 }
 async restore(target:string,revision:number){const e=await this.db.call<Entry>('entry',target);const candidates=await this.recommend(target);const first=candidates[0];if(!first)throw Error('未找到可用自动封面，原封面已保留');const snapshot=this.frames.get(first.token)!;const crop={mode:'cover',x:.5,y:.5,zoom:1};const result=await this.images.call('crop',snapshot.path,path.join(this.dataDir,'cache'),crop);await this.db.call('cover',e.id,revision,{mode:'auto',hash:result.hash,source:snapshot.sourceId,pts:snapshot.pts,crop})}
 async clearCache(){await this.queue;const dir=path.resolve(this.dataDir,'cache');if(path.dirname(dir)!==path.resolve(this.dataDir))throw Error('缓存路径无效');await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});this.errors.clear();this.broadcast()}
 async trimCache(maxBytes=5*1024**3){const dir=path.join(this.dataDir,'cache');const files=await fs.readdir(dir).catch(()=>[]);const infos=await Promise.all(files.map(async name=>{const file=path.join(dir,name);const stat=await fs.stat(file);return {file,size:stat.size,time:stat.atimeMs}}));let size=infos.reduce((s,f)=>s+f.size,0);for(const info of infos.sort((a,b)=>a.time-b.time)){if(size<=maxBytes)break;if([...this.leases.values()].some(l=>l.path===info.file&&l.expires>Date.now()))continue;await fs.unlink(info.file).catch(()=>{});size-=info.size}}
 releaseAll(){for(const key of this.sources.keys())this.closeSource(key);this.leases.clear();this.frames.clear()}
 close(){this.closed=true;this.releaseAll()}
}
