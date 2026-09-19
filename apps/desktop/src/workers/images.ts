import sharp from 'sharp'
import fs from 'node:fs/promises'
import { createHash,randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Crop } from '../../../../packages/contracts'
// Each queued cover job uses one libvips worker so the user-facing job limit is
// also the effective CPU concurrency limit instead of being multiplied again.
sharp.concurrency(1);sharp.cache({memory:64,files:0,items:32})
const parent=process.parentPort!
const image=(source:string)=>sharp(source,{limitInputPixels:60000000,animated:false,failOn:'warning'}).autoOrient()
async function write(buffer:Buffer,dir:string,extension:string){const hash=createHash('sha256').update(buffer).digest('hex');const target=path.join(dir,hash+'.'+extension);await fs.mkdir(dir,{recursive:true});try{const file=await fs.open(target,'wx');try{await file.writeFile(buffer);await file.sync()}finally{await file.close()}}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}return {hash,path:target,size:buffer.length}}
async function run(method:string,args:any[]){
 if(method==='normalize'){const [source,dir,rotation=0]=args;let pipeline=image(source);if(rotation)pipeline=pipeline.rotate(rotation);const buffer=await pipeline.png().toBuffer();const meta=await sharp(buffer).metadata();return {...await write(buffer,dir,'png'),width:meta.width,height:meta.height}}
 if(method==='thumbnail'){const [source,dir,width=512]=args;const buffer=await image(source).resize(width,width,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();return write(buffer,dir,'webp')}
 if(method==='thumbnailTo'){const [source,target,width=240]=args as [string,string,number?];let pipeline=image(source);if(width>0)pipeline=pipeline.resize(width,width,{fit:'inside',withoutEnlargement:true});const buffer=await pipeline.webp({lossless:true,effort:0}).toBuffer();await fs.mkdir(path.dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,buffer);try{await fs.rename(temporary,target)}catch(error){await fs.unlink(temporary).catch(()=>{});if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}return {path:target,size:buffer.length}}
 if(method==='crop'){const [source,dir,crop,targetWidth=1280]=args as [string,string,Crop,number?];const {data,info}=await image(source).png().toBuffer({resolveWithObject:true});let pipeline=sharp(data)
  if(crop.mode==='cover'){const ratio=1.6;let width=info.width,height=width/ratio;if(height>info.height){height=info.height;width=height*ratio}width=Math.max(1,Math.floor(width/crop.zoom));height=Math.max(1,Math.floor(height/crop.zoom));const left=Math.round((info.width-width)*crop.x),top=Math.round((info.height-height)*crop.y);pipeline=pipeline.extract({left,top,width,height})}
  else if(targetWidth>0)pipeline=pipeline.resize({width:targetWidth,height:Math.round(targetWidth/1.6),fit:'contain',background:'#11151b',withoutEnlargement:true})
  if(targetWidth>0&&crop.mode==='cover')pipeline=pipeline.resize({width:targetWidth,height:Math.round(targetWidth/1.6),fit:'inside',withoutEnlargement:true})
  return write(await pipeline.png().toBuffer(),dir,'png')
 }
 if(method==='score'){const [source]=args;const {data,info}=await image(source).resize(64,40,{fit:'fill'}).greyscale().raw().toBuffer({resolveWithObject:true});let sum=0,edge=0,clipped=0;for(let i=0;i<data.length;i++){const value=data[i]!;sum+=value;if(value<12||value>244)clipped++;if(i%info.width)edge+=Math.abs(value-data[i-1]!)}const mean=sum/data.length;const score=.5*Math.min(1,edge/data.length/24)+.25*(1-Math.abs(mean-127)/127)+.25*(1-clipped/data.length);const fingerprint=Array.from(data.filter((_,i)=>i%40===0)).map(v=>v>mean?'1':'0').join('');return {score,fingerprint}}
 if(method==='probe'){const m=await image(args[0]).metadata();return {width:m.autoOrient?.width??m.width,height:m.autoOrient?.height??m.height,codec:m.format}}
 throw Error('未知图像命令')
}
parent.on('message',async event=>{const {id,method,args}=event.data;try{parent.postMessage({id,result:await run(method,args)})}catch(error){parent.postMessage({id,error:String(error)})}})
