import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
export class NativeClient {
  process: ChildProcessWithoutNullStreams
  pending=new Map<string,{resolve:(value:any)=>void;reject:(err:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  constructor(executable: string) {
    this.process=spawn(executable,[],{stdio:'pipe',windowsHide:true,shell:false})
    createInterface({input:this.process.stdout}).on('line',line=>{
      try { if(line.length>16*1024*1024)throw Error('Native response too large');const data=JSON.parse(line);const item=this.pending.get(data.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(data.id);if(data.error)item.reject(Error(data.error));else item.resolve(data.result) }catch(error){this.fail(error as Error)}
    })
    this.process.stderr.on('data',()=>{})
    this.process.on('error',error=>this.fail(error));this.process.on('exit',()=>this.fail(Error('原生工作进程已退出')))
  }
  call<T=any>(method: string,args: Record<string,unknown>={},timeout=30000):Promise<T> {
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('操作超时，请重试'));if(!['copy','rename','publish','removeHeld','removeEmpty'].includes(method))this.process.kill()},timeout)
      this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({id,method,...args})+'\n')
    })
  }
  fail(error:Error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error)}this.pending.clear()}
  close(){this.process.stdin.end();setTimeout(()=>this.process.kill(),2000).unref()}
}
