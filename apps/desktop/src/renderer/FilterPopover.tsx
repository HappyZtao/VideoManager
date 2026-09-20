import {useEffect,useState} from 'react'
import * as Popover from '@radix-ui/react-popover'
import {SlidersHorizontal,X} from 'lucide-react'
import type {Bootstrap,QuerySpec} from '../../../../packages/contracts'
import {useNavigation} from './store'

const emptyFilters={favorite:false,extensions:[],tags:[],minSize:null,maxSize:null,after:null,before:null,minDuration:null,maxDuration:null}
const dateValue=(value:number|null)=>{if(value===null)return '';const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
const dateTime=(value:string,end=false)=>value?new Date(`${value}T${end?'23:59:59.999':'00:00:00'}`).getTime():null
export function FilterPopover({tags}:{tags:Bootstrap['tags']}){
 const q=useNavigation(s=>s.query),set=useNavigation(s=>s.setQuery)
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(q),[extensions,setExtensions]=useState(''),[tagSearch,setTagSearch]=useState('')
 useEffect(()=>{if(open){setDraft(q);setExtensions(q.extensions.join(', '));setTagSearch('')}},[open])
 const update=(patch:Partial<QuerySpec>)=>setDraft(current=>({...current,...patch}))
 const active=!!(q.favorite||q.tags.length||q.extensions.length||[q.minSize,q.maxSize,q.after,q.before,q.minDuration,q.maxDuration].some(value=>value!==null))
 const invalid=(draft.minSize!==null&&draft.maxSize!==null&&draft.minSize>draft.maxSize)||(draft.after!==null&&draft.before!==null&&draft.after>draft.before)||(draft.minDuration!==null&&draft.maxDuration!==null&&draft.minDuration>draft.maxDuration)
 const number=(value:string,scale=1)=>value!==''&&Number.isFinite(Number(value))?Math.max(0,Number(value))*scale:null
 const apply=()=>{if(invalid)return;const {favorite,tags,minSize,maxSize,after,before,minDuration,maxDuration}=draft;set({favorite,tags,minSize,maxSize,after,before,minDuration,maxDuration,extensions:[...new Set(extensions.split(/[,，\s]+/).map(value=>value.trim().toLowerCase().replace(/^\./,'')).filter(Boolean))]});setOpen(false)}
 return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button className={'text-button '+(active?'accent-text':'')}><SlidersHorizontal size={16}/>筛选{active&&<span className="filter-active-dot"/>}</button></Popover.Trigger><Popover.Portal><Popover.Content className="filter-popover" side="bottom" sticky="always" sideOffset={6} align="end" collisionPadding={16}>
  <header className="filter-heading"><div><h4>筛选条件</h4></div><Popover.Close className="icon-button" aria-label="关闭筛选"><X size={17}/></Popover.Close></header>
  <div className="filter-body">
   <label className="filter-favorite"><input type="checkbox" checked={draft.favorite} onChange={e=>update({favorite:e.target.checked})}/><span>仅显示收藏</span></label>
   <label className="field">文件扩展名<input aria-label="扩展名筛选" value={extensions} placeholder="例如 jpg, png, mp4" onChange={e=>setExtensions(e.target.value)}/><small>用逗号或空格分隔，匹配其中任意一种。</small></label>
   <section className="filter-section"><div className="filter-section-title"><strong>标签</strong><span>包含所有选中标签{draft.tags.length?` · 已选 ${draft.tags.length}`:''}</span></div>{tags.length>8&&<input className="filter-tag-search" aria-label="查找标签" placeholder="查找标签…" value={tagSearch} onChange={e=>setTagSearch(e.target.value)}/>}
    <div className="tag-filter-options">{tags.filter(t=>t.name.toLowerCase().includes(tagSearch.toLowerCase())).map(t=><label key={t.name} className={draft.tags.includes(t.name)?'selected':''}><input type="checkbox" checked={draft.tags.includes(t.name)} onChange={e=>update({tags:e.target.checked?[...draft.tags,t.name]:draft.tags.filter(value=>value!==t.name)})}/><span title={t.name}>{t.name}</span></label>)}{!tags.length&&<p className="filter-empty">暂无标签，可在媒体菜单中添加。</p>}{!!tags.length&&!tags.some(t=>t.name.toLowerCase().includes(tagSearch.toLowerCase()))&&<p className="filter-empty">没有匹配的标签</p>}</div>
   </section>
   <section className="filter-section"><div className="filter-section-title"><strong>文件大小</strong><span>MB</span></div><div className="filter-range"><label className="field">最小<input type="number" min="0" step="any" value={draft.minSize===null?'':draft.minSize/1024**2} placeholder="不限" onChange={e=>update({minSize:number(e.target.value,1024**2)})}/></label><span>—</span><label className="field">最大<input type="number" min="0" step="any" value={draft.maxSize===null?'':draft.maxSize/1024**2} placeholder="不限" onChange={e=>update({maxSize:number(e.target.value,1024**2)})}/></label></div></section>
   <section className="filter-section"><div className="filter-section-title"><strong>修改日期</strong></div><div className="filter-range"><label className="field">开始日期<input type="date" value={dateValue(draft.after)} onChange={e=>update({after:dateTime(e.target.value)})}/></label><span>—</span><label className="field">结束日期<input type="date" value={dateValue(draft.before)} onChange={e=>update({before:dateTime(e.target.value,true)})}/></label></div></section>
   <section className="filter-section"><div className="filter-section-title"><strong>视频时长</strong><span>分钟 · 仅匹配视频</span></div><div className="filter-range"><label className="field">最短<input type="number" min="0" step="any" value={draft.minDuration===null?'':draft.minDuration/60} placeholder="不限" onChange={e=>update({minDuration:number(e.target.value,60)})}/></label><span>—</span><label className="field">最长<input type="number" min="0" step="any" value={draft.maxDuration===null?'':draft.maxDuration/60} placeholder="不限" onChange={e=>update({maxDuration:number(e.target.value,60)})}/></label></div></section>
  </div>
  <footer className="filter-footer">{invalid&&<p role="alert">范围起点不能大于终点，请调整后应用。</p>}<div><button className="text-button" onClick={()=>{setDraft({...draft,...emptyFilters});setExtensions('');setTagSearch('')}}>重置条件</button><button className="primary" disabled={invalid} onClick={apply}>应用筛选</button></div></footer>
 </Popover.Content></Popover.Portal></Popover.Root>
}
