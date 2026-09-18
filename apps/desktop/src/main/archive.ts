import fs from 'node:fs/promises'
import { createReadStream,createWriteStream } from 'node:fs'
import path from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { WorkerClient } from './worker'
import { fingerprint } from '../../../../packages/platform/fingerprint'
import { safeRelative } from '../../../../packages/domain'

const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex')
async function digestFile(file:string){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(file)){hash.update(chunk);size+=chunk.length}return {sha256:hash.digest('hex'),size}}
export async function exportArchive(db:WorkerClient,dataDir:string,destination:string,workerPath:string){
 const snapshot=path.join(dataDir,'temp',`backup-${randomUUID()}.sqlite`);await fs.mkdir(path.dirname(snapshot),{recursive:true});await db.call('backup',snapshot);const reader=new WorkerClient(workerPath,'导出快照');let records:any
 try{await reader.call('init',snapshot,true);records=await reader.call('dump')}finally{reader.close()}
 const zip=new yazl.ZipFile();const checksums:Record<string,{sha256:string;size:number}>={};const put=(name:string,data:Buffer)=>{checksums[name]={sha256:digest(data),size:data.length};zip.addBuffer(data,name)}
 const roots=new Map<string,any>(records.roots.map((r:any)=>[r.id,r]));for(const e of records.entries){if(e.kind!=='folder'&&e.state==='present'){const r=roots.get(e.rootId);if(r?.path){try{e.fingerprint=await fingerprint(path.join(r.path,...e.rel.split('/')))}catch{}}}e.probeError=null;e.coverHash=e.coverMode==='manual'?e.coverHash:null;e.coverOriginal=e.coverMode==='manual'?e.coverOriginal:null;if(e.coverMode!=='manual')e.coverMode=null}
 records.roots=records.roots.map((r:any)=>({...r,path:'',identity:'',state:'offline'}))
 const sets:Record<string,unknown[]>={roots:records.roots,entries:records.entries,organization:records.entry_tags,settings:records.settings,covers:records.entries.filter((e:any)=>e.coverMode==='manual').map((e:any)=>({targetId:e.id,hash:e.coverHash,original:e.coverOriginal}))}
 for(const [name,rows]of Object.entries(sets))put(`records/${name}.jsonl`,Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')))
 const objects=new Set<string>();for(const e of records.entries)if(e.coverMode==='manual'){if(e.coverHash)objects.add(e.coverHash);if(e.coverOriginal)objects.add(e.coverOriginal)}
 for(const hash of objects){const file=path.join(dataDir,'objects',hash+'.png');const summary=await digestFile(file);if(summary.sha256!==hash)throw Error('封面对象校验失败；导出已停止');checksums['objects/'+hash+'.png']=summary;zip.addFile(file,'objects/'+hash+'.png')}
 put('manifest.json',Buffer.from(JSON.stringify({formatVersion:1,libraryId:path.basename(dataDir),created:new Date().toISOString(),entries:records.entries.length,objects:objects.size,sourceMediaIncluded:false})))
 zip.addBuffer(Buffer.from(JSON.stringify(checksums)),'checksums.json');const temporary=destination+'.'+randomUUID()+'.tmp';const output=pipeline(zip.outputStream,createWriteStream(temporary,{flags:'wx'}));zip.end();await output;const fd=await fs.open(temporary,'r+');await fd.sync();await fd.close();await fs.rename(temporary,destination);await fs.unlink(snapshot).catch(()=>{});return destination
}
export async function inspectArchive(file:string,tempDir:string){
 await fs.mkdir(path.join(tempDir,'objects'),{recursive:true});const files=new Map<string,Buffer>();const streamed=new Map<string,{sha256:string;size:number}>();let total=0;let count=0;let recordBytes=0
 await new Promise<void>((resolve,reject)=>{yauzl.open(file,{lazyEntries:true,decodeStrings:true,validateEntrySizes:true},(err,zip)=>{if(err||!zip){reject(err??Error('无法打开管理包'));return}const fail=(error:Error)=>{zip.close();reject(error)};zip.on('error',fail);zip.on('end',resolve);zip.on('entry',entry=>{
   const name=entry.fileName;const type=(entry.externalFileAttributes>>>16)&0xf000
   if(++count>210000||files.has(name)||streamed.has(name)||type===0xa000||!(/^(manifest|checksums)\.json$/.test(name)||/^records\/(roots|entries|organization|settings|covers)\.jsonl$/.test(name)||/^objects\/[a-f0-9]{64}\.png$/.test(name))||entry.uncompressedSize>256*1024**2||(total+=entry.uncompressedSize)>2*1024**3||(!name.startsWith('objects/')&&(recordBytes+=entry.uncompressedSize)>256*1024**2)){fail(Error('管理包含非法路径、重复文件或超出解压预算'));return}
   zip.openReadStream(entry,(error,stream)=>{if(error||!stream){fail(error??Error('无法读取管理包'));return}let size=0;if(name.startsWith('objects/')){const hash=createHash('sha256');const meter=new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>entry.uncompressedSize){done(Error('管理包长度异常'));return}hash.update(chunk);done(null,chunk)}});void pipeline(stream,meter,createWriteStream(path.join(tempDir,name),{flags:'wx'})).then(()=>{const sha256=hash.digest('hex');if(name!==`objects/${sha256}.png`)throw Error('封面对象内容摘要不匹配');streamed.set(name,{sha256,size});zip.readEntry()}).catch(fail);return}const chunks:Buffer[]=[];stream.on('data',chunk=>{size+=chunk.length;if(size>entry.uncompressedSize){stream.destroy();fail(Error('管理包长度异常'));return}chunks.push(chunk)});stream.on('error',fail);stream.on('end',()=>{files.set(name,Buffer.concat(chunks));zip.readEntry()})})
  });zip.readEntry()})})
 const jsonFile=(name:string)=>{const value=files.get(name);if(!value)throw Error('管理包缺少 '+name);return JSON.parse(value.toString('utf8'))}
 const manifest=jsonFile('manifest.json');if(manifest.formatVersion!==1)throw Error('不支持此管理包版本');const checks=jsonFile('checksums.json')
 for(const [name,data]of files){if(name==='checksums.json')continue;const check=checks[name];if(!check||check.size!==data.length||check.sha256!==digest(data))throw Error('管理包摘要校验失败：'+name)}
 for(const [name,summary]of streamed){const check=checks[name];if(!check||check.size!==summary.size||check.sha256!==summary.sha256)throw Error('封面对象校验失败')}
 for(const name of Object.keys(checks))if(!files.has(name)&&!streamed.has(name))throw Error('管理包缺少被引用的文件')
 const read=(name:string)=>{const bytes=files.get(`records/${name}.jsonl`);if(!bytes)throw Error('管理包缺少记录');return bytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))}
 const records={roots:read('roots'),entries:read('entries'),entry_tags:read('organization'),settings:read('settings')}
 const roots=new Set(records.roots.map((r:any)=>r.id));const ids=new Set<string>();for(const e of records.entries){if(typeof e.id!=='string'||ids.has(e.id)||!roots.has(e.rootId)||!safeRelative(e.rel)||!['folder','image','video'].includes(e.kind))throw Error('管理包条目关系无效');ids.add(e.id);if(e.coverMode==='manual')for(const hash of [e.coverHash,e.coverOriginal].filter(Boolean)){if(!/^[a-f0-9]{64}$/.test(hash)||!streamed.has(`objects/${hash}.png`))throw Error('封面引用缺失')}}
 const byId=new Map(records.entries.map((e:any)=>[e.id,e]));for(const e of records.entries){let current:any=e;const seen=new Set<string>();while(current.parentId){if(seen.has(current.id)||seen.size>256)throw Error('管理包父目录关系形成循环或层级过深');seen.add(current.id);const parent:any=byId.get(current.parentId);if(!parent||parent.kind!=='folder'||parent.rootId!==e.rootId)throw Error('管理包父目录不存在或类型无效');current=parent}}
 for(const t of records.entry_tags)if(!ids.has(t.entryId)||typeof t.tag!=='string'||t.tag.length>64)throw Error('标签记录无效')
 return {manifest,records}
}
