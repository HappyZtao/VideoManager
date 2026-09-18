import {it,expect} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {LibraryDatabase} from '../packages/persistence/database'
import {querySchema} from '../packages/contracts'
it('十万媒体索引的实际 SQLite 查询基准',async()=>{
 const directory=path.resolve('.test-data/benchmark-'+Date.now());fs.mkdirSync(directory,{recursive:true});const db=new LibraryDatabase(path.join(directory,'library.sqlite'));db.addRoot({id:'root',name:'十万媒体',path:'F:\\benchmark',entryId:'folder',identity:'v:root'})
 const start=performance.now();const dirs:{id:string;rel:string}[]=[{id:'folder',rel:''}];const batch:any[]=[]
 for(let i=1;i<=10000;i++){const parent=dirs[Math.floor((i-1)/10)]!;const id='dir-'+i,name='目录 '+i,rel=parent.rel?parent.rel+'/'+name:name;dirs.push({id,rel});batch.push({id,rootId:'root',parentId:parent.id,kind:'folder',name,rel,ext:'',size:0,mtime:1000,identity:'v:'+id,seen:'scan'});if(batch.length===500){db.ingest(batch);batch.length=0;await new Promise(r=>setTimeout(r,0))}}
 for(let i=0;i<100000;i++){const parent=dirs[1+Math.floor(i/10)]!;const video=i%5===0;const name=`西湖 ${String(i).padStart(6,'0')}.${video?'mp4':'jpg'}`;batch.push({id:'media-'+i,rootId:'root',parentId:parent.id,kind:video?'video':'image',name,rel:parent.rel+'/'+name,ext:video?'mp4':'jpg',size:10000+i,mtime:1700000000000+i,identity:'v:media-'+i,seen:'scan'});if(batch.length===500){db.ingest(batch);batch.length=0;await new Promise(r=>setTimeout(r,0))}}
 if(batch.length)db.ingest(batch);db.rootState('root','online');const buildMs=performance.now()-start
 const measure=async(q:unknown)=>{const times:number[]=[];for(let i=0;i<30;i++){const t=performance.now();const session=db.openQuery(querySchema.parse(q));db.page(session.id,0,100);times.push(performance.now()-t);await new Promise(r=>setTimeout(r,0))}times.sort((a,b)=>a-b);return {p50Ms:Math.round(times[14]!*100)/100,p95Ms:Math.round(times[28]!*100)/100,maxMs:Math.round(times.at(-1)!*100)/100}}
 const direct=await measure({folderId:'dir-9999',scope:'direct'});const chinese=await measure({folderId:null,scope:'library',text:'西湖'});const selective=await measure({folderId:null,scope:'library',text:'09999'});const all=await measure({folderId:'folder',scope:'descendants',sort:'mtime',direction:'desc'});const result={date:new Date().toISOString(),runtime:process.version,cpu:os.cpus()[0]?.model,logicalCores:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1024**3),entries:100000,folders:10000,buildMs:Math.round(buildMs),direct,chinese,selective,all,scope:'SQLite 服务查询与首批100项；不包含 IPC、UI 提交、文件扫描或解码。热缓存30次。'};fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/performance.json',JSON.stringify(result,null,2));console.log(result);expect(db.openQuery(querySchema.parse({folderId:'folder',scope:'descendants'})).media).toBe(100000);db.close()
},180000)
