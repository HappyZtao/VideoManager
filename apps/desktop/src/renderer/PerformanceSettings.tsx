import {coverQualities,defaultCoverQuality} from '../../../../packages/contracts/covers'
import { Cpu, Trash2 } from 'lucide-react'

export function PerformanceSettings({settings,busy,save,run,notify}:{settings:Record<string,unknown>;busy:boolean;save:(patch:Record<string,unknown>)=>void;run:(label:string,action:()=>Promise<unknown>)=>Promise<void>;notify:(message:string)=>void}){
 const choices=Array.from({length:16},(_,index)=>index+1)
 return <section className="performance-settings">
  <h3><Cpu size={20}/> 索引性能与存储</h3>
  <p className="muted">并发设置会应用到新启动的索引任务和封面创建任务。</p>
  <div className="setting-row"><div><strong>目录索引并发数</strong><small>同时读取目录的后台进程数量</small></div><select aria-label="目录索引并发数" value={Number(settings.indexConcurrency??4)} onChange={event=>save({indexConcurrency:Number(event.target.value)})}>{choices.map(value=><option key={value} value={value}>{value} 个</option>)}</select></div>
  <div className="setting-row"><div><strong>封面创建并发数</strong><small>同时解码与生成封面的任务数量</small></div><select aria-label="封面创建并发数" value={Number(settings.coverConcurrency??2)} onChange={event=>save({coverConcurrency:Number(event.target.value)})}>{choices.map(value=><option key={value} value={value}>{value} 个</option>)}</select></div>
  <div className="setting-row"><div><strong>默认封面分辨率</strong><small>自动封面及新建手动封面使用；已有手动封面保持原质量</small></div><select aria-label="默认封面分辨率" value={String(settings.coverQuality??defaultCoverQuality)} onChange={event=>save({coverQuality:event.target.value})}>{coverQualities.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
  <div className="performance-tip"><Cpu size={18}/><p><strong>温馨提示</strong><br/>机械硬盘或低功耗设备建议 1–2，SSD 与主流多核处理器建议 3–6；8–16 仅适合高速 SSD 和高核心数处理器。过高可能因磁盘争用和发热降频而变慢。</p></div>
  <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>void run('清理冗余封面',async()=>{const result=await window.vm.pruneStorage();notify(`已清理 ${result.files} 个废弃文件，释放 ${formatBytes(result.bytes)}`)})}><Trash2 size={16}/>清理废弃与冗余封面</button></div>
  <p className="muted">只清理当前媒体库中已不再引用的自动封面、缩略图和临时候选帧；不会删除原始媒体、标签、收藏或正在使用的手动封面。</p>
  <div className="divider"/>
 </section>
}

function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KB`;if(bytes<1024**3)return `${(bytes/1024**2).toFixed(1)} MB`;return `${(bytes/1024**3).toFixed(2)} GB`}
