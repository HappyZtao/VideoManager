import { utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
export class WorkerClient {
 process:UtilityProcess
 private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
 constructor(filename:string,name:string){this.process=utilityProcess.fork(filename,[],{serviceName:'VideoManager '+name,stdio:'pipe'});this.process.on('message',m=>{const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error(m.error));else p.resolve(m.result)});this.process.on('exit',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('后台服务已退出，请重新启动应用'))}this.pending.clear()});this.process.stderr?.on('data',data=>console.error(String(data)))}
 call<T=any>(method:string,...args:any[]):Promise<T>{const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('后台服务响应超时'))},60000);this.pending.set(id,{resolve,reject,timer});this.process.postMessage({id,method,args})})}
 close(){this.process.kill()}
}
