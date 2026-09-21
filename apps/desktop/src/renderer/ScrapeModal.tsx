import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard,Search,Check,Image as ImageIcon,Trash2,RefreshCw,TriangleAlert } from 'lucide-react'
import type { Entry,ScrapeMeta } from '../../../../packages/contracts'
import { Modal,Busy } from './components'

const formatDuration = (minutes:number) => minutes ? `${minutes} 分钟` : ''

// 刮削结果预览与手动选择：并发展示各数据源候选，支持应用、设为封面或清除。
export function ScrapeModal({entry,onClose,onApplied,notify}:{entry:Entry;onClose:()=>void;onApplied:()=>void;notify:(message:string)=>void}){
 const [meta,setMeta]=useState<ScrapeMeta|null>(null)
 const [applying,setApplying]=useState('')
 const preview=useQuery({queryKey:['scrape-preview',entry.id],queryFn:async()=>{
   const result=await window.vm.scrapePreview(entry.id)
   setMeta(current=>current??result.meta)
   return result
 }})
 const retry=async(provider:string)=>{setApplying('retry:'+provider);try{await window.vm.scrapeSearch(entry.id,provider);await preview.refetch()}catch(error){notify(String(error))}finally{setApplying('')}}
 const apply=async(provider:string)=>{setApplying('apply:'+provider);try{const applied=await window.vm.scrapeApply(entry.id,provider);setMeta(applied);notify(`已应用 ${applied.provider} 的刮削结果`);onApplied()}catch(error){notify(String(error))}finally{setApplying('')}}
 const setCover=async()=>{try{await window.vm.scrapeSetCover(entry.id);notify('已将刮削封面设为条目封面')}catch(error){notify(String(error))}}
 const clear=async()=>{setApplying('clear');try{await window.vm.scrapeClear(entry.id);setMeta(null);notify('已清除刮削数据');onApplied()}catch(error){notify(String(error))}finally{setApplying('')}}
 const codes=preview.data?.codes??[]
 return <Modal title="刮削元数据" description="从启用的数据源中查找该视频的标题、封面、演员与分类信息，可手动选择最匹配的结果。" onClose={onClose} wide>
  <div className="scrape-entry"><Clapperboard size={17}/><span title={entry.name}>{entry.name}</span></div>
  <div className="scrape-codes">{codes.length?codes.map(code=><span key={code} className="badge">{code}</span>):<span className="muted">未能从文件名解析出番号</span>}</div>
  {preview.isPending&&<Busy label="正在查询各数据源…"/>}
  {preview.isError&&<p className="inline-error">{String(preview.error)}</p>}
  {meta&&<article className={'scrape-meta '+(meta.status==='manual'?'manual':'')}>
    <div className="scrape-meta-cover">{meta.cover?<img src={meta.cover} alt="刮削封面"/>:<div className="placeholder video"><ImageIcon size={26}/></div>}</div>
    <div className="scrape-meta-body">
      <div className="scrape-meta-title"><strong>{meta.title||'（无标题）'}</strong><span className="badge">{meta.provider}</span><span className={'badge '+(meta.status==='manual'?'':'accent-text')}>{meta.status==='manual'?'手动选择':'自动匹配'}</span></div>
      <p className="scrape-meta-line">{[meta.code,meta.releaseDate,formatDuration(meta.durationMin),meta.studio,meta.series].filter(Boolean).join(' · ')}</p>
      {meta.actors.length>0&&<p className="scrape-meta-actors">{meta.actors.join(' / ')}</p>}
      {meta.tags.length>0&&<div className="scrape-tags">{meta.tags.slice(0,10).map(tag=><span key={tag}>{tag}</span>)}{meta.tags.length>10&&<small>+{meta.tags.length-10}</small>}</div>}
      <div className="button-row">
        {meta.cover&&<button className="secondary" onClick={()=>void setCover()}><ImageIcon size={15}/>设为条目封面</button>}
        <button className="text-button danger-text" onClick={()=>void clear()} disabled={applying==='clear'}><Trash2 size={14}/>清除刮削数据</button>
      </div>
    </div>
  </article>}
  <div className="scrape-list">
   {preview.data?.candidates.map(candidate=><article key={candidate.provider} className={'scrape-card '+(candidate.ok?'':'failed')}>
     <header><strong>{candidate.label}</strong>{candidate.ok?<span className="badge">可用</span>:<span className="badge failed"><TriangleAlert size={10}/>{candidate.error??'失败'}</span>}</header>
     {candidate.ok&&candidate.info?<div className="scrape-card-body">
       <div className="scrape-card-cover">{candidate.cover?<img src={candidate.cover} alt={candidate.info.code}/>:<div className="placeholder video"><ImageIcon size={22}/></div>}</div>
       <div className="scrape-card-info">
         <strong title={candidate.info.title}>{candidate.info.title||'（无标题）'}</strong>
         <p className="scrape-meta-line">{[candidate.info.code,candidate.info.releaseDate,formatDuration(candidate.info.durationMin),candidate.info.studio,candidate.info.series].filter(Boolean).join(' · ')}</p>
         {candidate.info.actors.length>0&&<p className="scrape-card-actors">{candidate.info.actors.slice(0,6).join(' / ')}{candidate.info.actors.length>6?` 等 ${candidate.info.actors.length} 人`:''}</p>}
         {candidate.info.tags.length>0&&<div className="scrape-tags">{candidate.info.tags.slice(0,6).map(tag=><span key={tag}>{tag}</span>)}{candidate.info.tags.length>6&&<small>+{candidate.info.tags.length-6}</small>}</div>}
         <div className="button-row"><button className="primary" disabled={!!applying} onClick={()=>void apply(candidate.provider)}><Check size={15}/>{applying==='apply:'+candidate.provider?'正在应用…':'应用此结果'}</button></div>
       </div>
     </div>:<div className="button-row"><button className="text-button" onClick={()=>void retry(candidate.provider)} disabled={!!applying}><RefreshCw size={13}/>{applying==='retry:'+candidate.provider?'正在重试…':'重试此数据源'}</button></div>}
   </article>)}
  </div>
  {preview.data&&!preview.data.candidates.length&&<div className="small-empty">没有启用的数据源，请在设置中选择。</div>}
  <footer className="modal-footer"><span className="muted"><Search size={13}/>查询在主进程完成，站点响应可能需要数秒</span><button className="secondary" onClick={()=>void preview.refetch()} disabled={preview.isFetching}><RefreshCw size={15} className={preview.isFetching?'spin':''}/>重新查询全部</button></footer>
 </Modal>
}
