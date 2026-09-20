import {spawn,type ChildProcess} from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import type {Entry,MpvState,MpvAction,MpvBounds} from '../../../../packages/contracts'

import {NativeClient} from '../../../../packages/platform/native'

type Pending={resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
type Session={controlsQueue:Promise<void>;controlsEnabled:boolean;seekQueue:Promise<void>;seekWait?:{started:boolean;complete:()=>void;fail:(error:Error)=>void};host:NativeClient;entry:Entry;state:MpvState;process:ChildProcess;socket?:net.Socket;pending:Map<number,Pending>;sequence:number;ended:boolean;lastEvent:number;lastSave:number;save:Promise<unknown>;loading?:{resolve:()=>void;reject:(error:Error)=>void}}

/** Own only the player process launched by this library. Paths never enter a shell. */
export class MpvPlayer {
 private current:Session|undefined
 private queue:Promise<unknown>=Promise.resolve()
 private disposed=false
 constructor(private executable:string,private persist:(id:string,position:number,revision:number)=>Promise<unknown>,private emit:(state:MpvState)=>void,private action:(event:{sessionId:string;action:string;position?:number})=>void){}
 private serial<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action,action);this.queue=result.catch(()=>{});return result}
 async open(entry:Entry,file:string,parent:number,bounds:MpvBounds):Promise<MpvState>{return this.serial(async()=>{
  if(this.disposed)throw Error('播放器已关闭')
  await this.stopCurrent()
  await fs.access(this.executable).catch(()=>{throw Error('mpv 组件缺失，请重新安装完整安装包，或切换到 Chromium / 系统默认应用')})
  const sessionId=randomUUID(),pipe='\\\\.\\pipe\\videomanager-mpv-'+sessionId
  const host=new NativeClient(path.resolve(path.dirname(this.executable),'..','vm-player-host.exe'))
  let surface:number
  try{surface=await host.call('create',{parent,...bounds,visible:false})}catch(error){host.close();throw error}
  const start=entry.playback>0&&(!entry.duration||entry.playback<entry.duration-2)?entry.playback:0
  const process=spawn(this.executable,['--no-config','--load-scripts=no','--ytdl=no','--idle=yes','--keep-open=yes','--force-window=yes','--pause=yes','--hwdec=auto-safe','--keepaspect=yes','--video-unscaled=no','--video-zoom=0','--panscan=0','--wid='+surface,'--osc=no','--script='+path.resolve(path.dirname(this.executable),'..','player-controls.lua'),'--input-default-bindings=no','--input-vo-keyboard=yes','--input-cursor=yes','--cursor-autohide=2000','--window-dragging=no','--title=VideoManager · '+entry.name,'--input-ipc-server='+pipe,'--start='+start],{shell:false,windowsHide:true,stdio:'ignore'})
  const session:Session={controlsQueue:Promise.resolve(),controlsEnabled:false,seekQueue:Promise.resolve(),host,entry,process,pending:new Map(),sequence:0,ended:false,lastEvent:0,lastSave:Date.now(),save:Promise.resolve(),state:{sessionId,entryId:entry.id,status:'starting',position:start,duration:entry.duration??0,aspect:entry.width&&entry.height?entry.width/entry.height:16/9,paused:true,speed:1,volume:100,fullscreen:false,error:''}}
  this.current=session;this.publish(session)
  host.process.on('exit',()=>{if(!session.ended){session.state.error='播放画面已关闭';void this.stop(session,'error')}})
  process.on('error',error=>{session.state.error=error.message;this.finish(session,'error')})
  process.on('exit',code=>{if(!session.ended)this.finish(session,code&&code!==0?'error':'closed')})
  try{
   await this.connect(session,pipe)
   for(const [index,property]of ['time-pos','duration','pause','speed','volume','fullscreen','video-out-params'].entries())await this.command(session,['observe_property',index+1,property])
   const loaded=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('mpv 加载视频超时')),15000);session.loading={resolve:()=>{clearTimeout(timeout);resolve()},reject:error=>{clearTimeout(timeout);reject(error)}}})
   void loaded.catch(()=>{})
   await this.command(session,['loadfile',path.resolve(file),'replace'])
   await loaded
   await this.command(session,['set_property','pause',false])
   if(session.ended||session.state.status==='error')throw Error(session.state.error||'mpv 无法打开此视频')
   await host.call('bounds',bounds);session.state.status='ready';this.publish(session);return {...session.state}
  }catch(error){session.state.error=String(error);await this.stop(session,'error');throw Error('mpv 打开失败：'+String(error))}
 })}
 private async connect(session:Session,pipe:string){
  const deadline=Date.now()+10000
  while(Date.now()<deadline&&!session.ended){
   const socket=await new Promise<net.Socket|null>(resolve=>{
    const candidate=net.createConnection(pipe);const timeout=setTimeout(()=>{candidate.destroy();resolve(null)},400)
    candidate.once('error',()=>{clearTimeout(timeout);candidate.destroy();resolve(null)})
    candidate.once('connect',()=>{clearTimeout(timeout);resolve(candidate)})
   })
   if(socket){
    session.socket=socket;socket.setEncoding('utf8');let buffer=''
    socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>1024*1024){session.state.error='mpv 响应异常';void this.stop(session,'error');return}let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try{this.receive(session,JSON.parse(line))}catch{/* Ignore non-JSON diagnostic output. */}}})
    socket.on('error',()=>{if(!session.ended){session.state.error='mpv 播放连接中断';void this.stop(session,'error')}})
    socket.on('close',()=>{if(!session.ended)void this.stop(session,session.state.status==='error'?'error':'closed')})
    return
   }
   await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw Error(session.state.error||'mpv 启动超时')
 }
 private command(session:Session,command:unknown[]):Promise<unknown>{
  if(session.ended||!session.socket||session.socket.destroyed)return Promise.reject(Error('mpv 播放窗口已关闭'))
  const request_id=++session.sequence
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{session.pending.delete(request_id);reject(Error('mpv 响应超时'))},3000);session.pending.set(request_id,{resolve,reject,timer});session.socket!.write(JSON.stringify({command,request_id})+'\n')})
 }
 private receive(session:Session,message:any){
  if(message.request_id){const pending=session.pending.get(message.request_id);if(pending){clearTimeout(pending.timer);session.pending.delete(message.request_id);if(message.error&&message.error!=='success')pending.reject(Error(message.error));else pending.resolve(message.data)}return}
  if(message.event==='client-message'&&!session.ended){
   if(message.args?.[0]==='vm-exit-fullscreen')this.action({sessionId:session.state.sessionId,action:'exit-fullscreen'})
   if(message.args?.[0]==='vm-cover')void this.command(session,['set_property','pause',true]).then(()=>this.command(session,['get_property','time-pos'])).then(position=>{if(!session.ended&&typeof position==='number')this.action({sessionId:session.state.sessionId,action:'cover',position})}).catch(()=>{})
  }
  if(message.event==='property-change'){
   const value=message.data
   switch(message.name){
    case 'time-pos':if(typeof value==='number'&&Number.isFinite(value)){session.state.position=value;if(!session.seekWait&&Date.now()-session.lastSave>5000)this.save(session)}break
    case 'video-out-params':if(value?.dw>0&&value?.dh>0){const rotated=Math.abs(Number(value.rotate??0))%180===90;session.state.aspect=rotated?value.dh/value.dw:value.dw/value.dh}break;
    case 'duration':if(typeof value==='number'&&Number.isFinite(value))session.state.duration=value;break
    case 'pause':if(typeof value==='boolean'){session.state.paused=value;if(value)this.save(session)}break
    case 'speed':if(typeof value==='number')session.state.speed=value;break
    case 'volume':if(typeof value==='number')session.state.volume=value;break
    case 'fullscreen':if(typeof value==='boolean')session.state.fullscreen=value;break
   }
   this.publish(session,message.name!=='time-pos')
  }
  if(message.event==='seek'&&session.seekWait)session.seekWait.started=true
  if(message.event==='playback-restart'&&session.seekWait?.started)session.seekWait.complete()
  if(message.event==='file-loaded')session.loading?.resolve()
  if(message.event==='end-file'&&message.reason==='error'){session.state.status='error';session.state.error='此视频无法由 mpv 解码，请检查文件是否完整';session.loading?.reject(Error(session.state.error));void this.stop(session,'error')}
 }
 private publish(session:Session,force=true){if(session.seekWait&&!session.ended)return;if(force||Date.now()-session.lastEvent>=250){session.lastEvent=Date.now();this.emit({...session.state})}}
 private save(session:Session){session.lastSave=Date.now();const position=session.state.position;session.save=session.save.then(()=>this.persist(session.entry.id,position,session.entry.revision)).catch(()=>{});return session.save}
 private finish(session:Session,status:'closed'|'error'){
  if(session.ended)return
  session.ended=true;session.state.status=status;session.seekWait?.fail(Error('播放已关闭'))
  session.loading?.reject(Error('mpv 播放窗口已关闭'))
  if(status==='error'&&!session.state.error)session.state.error='mpv 播放进程异常退出'
  for(const pending of session.pending.values()){clearTimeout(pending.timer);pending.reject(Error('mpv 播放窗口已关闭'))}session.pending.clear()
  session.socket?.destroy();session.host.close();this.save(session);this.publish(session)
 }
 private async stop(session:Session,status:'closed'|'error'='closed'){
  if(!session.ended){session.socket?.write(JSON.stringify({command:['quit']})+'\n');this.finish(session,status)}
  await session.save
  if(session.process.exitCode===null&&session.process.signalCode===null){
   await new Promise<void>(resolve=>{const timer=setTimeout(()=>{session.process.kill();resolve()},1200);session.process.once('exit',()=>{clearTimeout(timer);resolve()})})
  }
  if(this.current===session)this.current=undefined
 }
 private async seek(session:Session,target:number){
  if(session.ended)throw Error('播放已关闭')
  let finishing=false,settled=false
  await new Promise<void>((resolve,reject)=>{
   const clear=()=>{settled=true;clearTimeout(timer);if(session.seekWait===waiter)delete session.seekWait}
   const fail=(error:Error)=>{if(settled)return;clear();reject(error)}
   const timer=setTimeout(()=>fail(Error('视频定位超时，请重试')),15000)
   const waiter={started:false,fail,complete:()=>{if(finishing||settled)return;finishing=true;void this.command(session,['get_property','time-pos']).then(position=>{if(settled)return;if(typeof position==='number')session.state.position=position;clear();this.publish(session);resolve()}).catch(fail)}}
   session.seekWait=waiter
   void this.command(session,['seek',target,'absolute+exact']).then(()=>this.command(session,['get_property','time-pos'])).then(position=>{if(typeof position==='number'&&Math.abs(position-target)<.001)waiter.complete()}).catch(fail)
  })
 }
 // Wait for the OSD controller to acknowledge its input bindings and visibility.
 private async nativeControls(session:Session){
  const enabled=session.controlsEnabled,deadline=Date.now()+2500
  while(!session.ended&&session.controlsEnabled===enabled){
   await this.command(session,['script-message','vm-controls',enabled?'yes':'no'])
   const applied=await this.command(session,['get_property','user-data/vm-controls/enabled']).catch(()=>null)
   if(applied===enabled)return
   if(Date.now()>=deadline)throw Error('mpv 原生控制器未能启用，请重新打开视频')
   await new Promise(resolve=>setTimeout(resolve,50))
  }
 }
 private async stopCurrent(){if(this.current)await this.stop(this.current)}
 async bounds(sessionId:string,bounds:MpvBounds){const session=this.current;if(session?.state.sessionId===sessionId&&!session.ended)await session.host.call('bounds',bounds)}
 close(sessionId:string){return this.serial(async()=>{if(this.current?.state.sessionId===sessionId)await this.stopCurrent()})}
 closeAll(){return this.serial(()=>this.stopCurrent())}
 async dispose(){this.disposed=true;await this.closeAll()}
 async control(sessionId:string,action:MpvAction,value?:number){
  const session=this.current;if(!session||session.state.sessionId!==sessionId||session.ended)throw Error('mpv 播放窗口已关闭')
  if(action==='toggle-pause')await this.command(session,['cycle','pause'])
  else if(action==='native-controls'){
   session.controlsEnabled=!!value
   const next=session.controlsQueue.then(()=>this.nativeControls(session))
   session.controlsQueue=next.catch(()=>{});await next
  }
  else if(action==='fullscreen')await this.command(session,['cycle','fullscreen'])
  else if(action==='audio')await this.command(session,['cycle','aid'])
  else if(action==='subtitle')await this.command(session,['cycle','sid'])
  else if(action==='seek'){const target=Math.max(0,Math.min(value??0,session.state.duration||Infinity));const next=session.seekQueue.then(()=>this.seek(session,target));session.seekQueue=next.catch(()=>{});await next}
  else if(action==='speed')await this.command(session,['set_property','speed',Math.min(4,Math.max(.25,value??1))])
  else if(action==='volume')await this.command(session,['set_property','volume',Math.min(100,Math.max(0,value??100))])
 }
}
