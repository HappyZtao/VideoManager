import fs from 'node:fs/promises'
import path from 'node:path'
let queue=Promise.resolve();const recent=new Map<string,number>()
export function logFailure(dataDir:string,record:{requestId?:string;method:string;message:string}){
 const key=record.method+':'+record.message;if(Date.now()-(recent.get(key)??0)<60000)return;recent.set(key,Date.now());if(recent.size>1000)recent.clear()
 queue=queue.then(async()=>{const dir=path.join(dataDir,'logs');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'application.log');const stat=await fs.stat(file).catch(()=>null);if(stat&&stat.size>10*1024**2){await fs.unlink(path.join(dir,'application.4.log')).catch(()=>{});for(let i=3;i>=1;i--)await fs.rename(path.join(dir,`application.${i}.log`),path.join(dir,`application.${i+1}.log`)).catch(()=>{});await fs.rename(file,path.join(dir,'application.1.log'))}await fs.appendFile(file,JSON.stringify({time:new Date().toISOString(),...record})+'\n')}).catch(()=>{})
}
