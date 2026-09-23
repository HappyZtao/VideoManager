import { useEffect,useMemo,useRef,useState } from 'react'
import { useInfiniteQuery,useQuery,useQueryClient } from '@tanstack/react-query'
import { Users,Film,Cake,ChevronDown,ImagePlus,Pencil,Check,Star } from 'lucide-react'
import type { Actress,Entry } from '../../../../packages/contracts'
import { Busy,Thumb,Modal } from './components'
import { defaultQuery,useNavigation } from './store'

const PAGE_SIZE=60
export const ACTRESS_SORTS=[
  ['work-desc','作品数量 多→少'],
  ['work-asc','作品数量 少→多'],
  ['name-asc','名称 A→Z'],
  ['age-asc','年龄 小→大'],
  ['age-desc','年龄 大→小'],
  ['recent-desc','最近有作品入库']
] as const

// 由出生日期实时计算年龄（与 JavBoss 的呈现一致）。
function calculateAge(birthDate:string):number|null{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))return null
  const date=new Date(birthDate+'T00:00:00')
  if(Number.isNaN(date.getTime()))return null
  const now=new Date()
  let age=now.getFullYear()-date.getFullYear()
  const monthDiff=now.getMonth()-date.getMonth()
  if(monthDiff<0||(monthDiff===0&&now.getDate()<date.getDate()))age--
  return age>=0&&age<130?age:null
}

// 女优头像复用其代表作封面的缩略图管线（手动指定优先，否则取有刮削封面的最新作品）。
function coverEntry(coverEntryId:string):Entry{
  return {id:coverEntryId,revision:1,coverRevision:0,kind:'video',rootState:'online',coverMode:null,coverHash:null,coverSource:null,coverOriginal:null,coverPts:null,crop:null,coverQuality:'fast',tags:[],favorite:0,name:'',rel:'',ext:'',size:0,mtime:0,identity:'',state:'present',width:null,height:null,duration:null,codec:null,directImages:0,directVideos:0,directFolders:0,subtree:0,other:0,complete:1,playback:0} as unknown as Entry
}

// 封面替换弹窗：左侧作品候选列表，右侧预览选中作品的封面。
function ActressCoverModal({item,onClose,notify}:{item:Actress;onClose:()=>void;notify:(message:string)=>void}){
  const client=useQueryClient()
  const options=useQuery({queryKey:['actress-cover-options',item.id],queryFn:()=>window.vm.actressCoverOptions(item.id),staleTime:30000})
  const list=options.data??[]
  const [selected,setSelected]=useState<string|null>(null)
  // 打开弹窗时默认选中第一个候选作品，并直接展示其封面。
  useEffect(()=>{if(list.length&&!selected)setSelected(list[0]!.entryId)},[list,selected])
  const [busy,setBusy]=useState(false)
  const chosen=list.find(option=>option.entryId===selected)
  const apply=async()=>{
    if(!selected)return
    setBusy(true)
    try{
      await window.vm.actressSetCover(item.id,selected)
      await client.invalidateQueries({queryKey:['actresses']})
      notify('演员封面已更新')
      onClose()
    }catch(error){notify(String(error))}finally{setBusy(false)}
  }
  return <Modal title="更换演员封面" description={`选择 ${item.name} 的一部作品，将其封面用作演员头像。`} onClose={onClose} wide>
   <div className="cover-picker">
    <div className="cover-picker-list">
      {list.map(option=><button key={option.entryId} className={option.entryId===selected?'selected':''} onClick={()=>setSelected(option.entryId)}>
        <span className="cover-picker-code">{option.code||'—'}</span>
        <span className="cover-picker-title">{option.title||'未知名称'}</span>
        <span className="cover-picker-date">{option.releaseDate||''}{option.hasCover?'':' · 无刮削封面'}</span>
        {option.favorite>0&&<Star size={11} className="cover-picker-star"/>}
      </button>)}
      {!list.length&&!options.isPending&&<p className="sidebar-empty">该演员暂无关联作品。</p>}
      {options.isPending&&<Busy label="正在读取作品列表…"/>}
    </div>
    <div className="cover-picker-preview">
      {chosen?<Thumb entry={coverEntry(chosen.entryId)}/>:<div className="cover-picker-empty"><ImagePlus size={34} strokeWidth={1.2}/><p>从左侧选择一部作品</p></div>}
      {chosen&&<div className="cover-picker-caption">{chosen.code} · {chosen.releaseDate||'日期未知'}</div>}
    </div>
   </div>
   <footer className="modal-footer"><span className="muted">共 {list.length} 部关联作品</span><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!selected||busy} onClick={()=>void apply()}>{busy?'正在应用…':'设为演员封面'}</button></div></footer>
  </Modal>
}

// 信息编辑弹窗：名字、日文名、中文名、身高、生日与体型数据。
function ActressEditModal({item,onClose,notify}:{item:Actress;onClose:()=>void;notify:(message:string)=>void}){
  const client=useQueryClient()
  const [form,setForm]=useState({name:item.name,japaneseName:item.japaneseName,chineseName:item.chineseName,birthDate:item.birthDate,height:String(item.height||''),bust:String(item.bust||''),waist:String(item.waist||''),hips:String(item.hips||''),cup:item.cup})
  const [busy,setBusy]=useState(false)
  const setField=(key:keyof typeof form,value:string)=>setForm(current=>({...current,[key]:value}))
  const save=async()=>{
    setBusy(true)
    try{
      await window.vm.actressUpdate(item.id,{
        name:form.name.trim(),japaneseName:form.japaneseName.trim(),chineseName:form.chineseName.trim(),
        birthDate:form.birthDate,height:Number(form.height)||0,bust:Number(form.bust)||0,waist:Number(form.waist)||0,hips:Number(form.hips)||0,
        cup:form.cup.trim().toUpperCase()
      })
      await client.invalidateQueries({queryKey:['actresses']})
      notify('演员资料已更新')
      onClose()
    }catch(error){notify(String(error))}finally{setBusy(false)}
  }
  const numberField=(label:string,key:'height'|'bust'|'waist'|'hips')=><label className="field">{label}<input inputMode="numeric" value={form[key]} placeholder="未填写" onChange={e=>setField(key,e.target.value.replace(/[^\d]/g,''))}/></label>
  return <Modal title="编辑演员资料" description="资料仅保存在本机媒体库中，不会写入原始媒体文件。" onClose={onClose}>
   <div className="edit-grid">
    <label className="field">名字<input value={form.name} onChange={e=>setField('name',e.target.value)}/></label>
    <label className="field">日文名<input value={form.japaneseName} onChange={e=>setField('japaneseName',e.target.value)}/></label>
    <label className="field">中文名<input value={form.chineseName} onChange={e=>setField('chineseName',e.target.value)}/></label>
    <label className="field">生日<input type="date" value={form.birthDate} onChange={e=>setField('birthDate',e.target.value)}/></label>
    {numberField('身高（cm）','height')}
    {numberField('胸围','bust')}
    {numberField('腰围','waist')}
    {numberField('臀围','hips')}
    <label className="field">罩杯<input value={form.cup} maxLength={2} placeholder="如 F" onChange={e=>setField('cup',e.target.value.replace(/[^a-zA-Z]/g,''))}/></label>
   </div>
   <footer className="modal-footer"><span className="muted">名字需唯一，保存后立即生效</span><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!form.name.trim()||busy} onClick={()=>void save()}>{busy?'正在保存…':'保存资料'}</button></div></footer>
  </Modal>
}

function ActressCard({item,fit,open,onEditCover,onEditProfile}:{item:Actress;fit:string;open:(item:Actress)=>void;onEditCover:(item:Actress)=>void;onEditProfile:(item:Actress)=>void}){
  const age=calculateAge(item.birthDate)
  const metrics=useMemo(()=>[
    item.height>0?`${item.height}cm`:'',
    item.bust>0&&item.waist>0&&item.hips>0?`胸${item.bust} · 腰${item.waist} · 臀${item.hips}`:'',
    item.cup?`${item.cup} 罩杯`:''
  ].filter(Boolean),[item.height,item.bust,item.waist,item.hips,item.cup])
  return <article className="card actress-card" role="button" tabIndex={0} aria-label={`查看 ${item.name} 的作品（${item.workCount} 部）`}
    onClick={()=>open(item)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(item)}}}>
    <div className={'card-image actress-cover '+(fit==='contain'?'fit-contain-cover':'')}>
      {item.coverEntryId?<Thumb entry={coverEntry(item.coverEntryId)}/>:<div className="actress-placeholder"><Users size={34} strokeWidth={1.2}/></div>}
      <span className="actress-works"><Film size={11}/>作品 {item.workCount}</span>
      <div className="actress-quick">
        <button className="actress-quick-button" title="更换封面" aria-label={`更换 ${item.name} 的封面`} onClick={e=>{e.stopPropagation();onEditCover(item)}}><ImagePlus size={14}/></button>
        <button className="actress-quick-button" title="编辑资料" aria-label={`编辑 ${item.name} 的资料`} onClick={e=>{e.stopPropagation();onEditProfile(item)}}><Pencil size={14}/></button>
      </div>
    </div>
    <div className="card-info actress-info">
      <div className="card-title actress-name" title={item.name}><span>{item.name}</span></div>
      <div className="actress-meta">
        {item.birthDate?<span className="actress-birth"><Cake size={11}/>{item.birthDate}{age!==null?`（${age}岁）`:''}</span>:<span className="actress-dim">生日待补充</span>}
      </div>
      <div className="actress-meta">{metrics.length?metrics.map(m=><span key={m}>{m}</span>):<span className="actress-dim">信息待补充</span>}</div>
    </div>
  </article>
}

export function ActressView({cardWidth,fit,initialSort,epoch,scrapeEnabled,notify}:{cardWidth:number;fit:string;initialSort:string;epoch:number;scrapeEnabled:boolean;notify:(message:string)=>void}){
  const navigate=useNavigation(s=>s.navigate)
  const [sort,setSort]=useState(()=>ACTRESS_SORTS.some(([value])=>value===initialSort)?initialSort:'work-desc')
  const [coverItem,setCoverItem]=useState<Actress|null>(null)
  const [profileItem,setProfileItem]=useState<Actress|null>(null)
  const sentinel=useRef<HTMLDivElement>(null)
  const list=useInfiniteQuery({
    queryKey:['actresses',sort,epoch],
    queryFn:(context: { pageParam: unknown })=>window.vm.actresses(sort as typeof ACTRESS_SORTS[number][0],Number(context.pageParam??0),PAGE_SIZE),
    initialPageParam:0,
    getNextPageParam:(last,all)=>last.items.length===PAGE_SIZE?all.reduce((sum,page)=>sum+page.items.length,0):undefined,
    staleTime:60000,gcTime:60000,retry:false,
    placeholderData:previous=>previous
  })
  const items=list.data?.pages.flatMap(page=>page.items)??[]
  const total=list.data?.pages[0]?.total??0
  // 打开演员页即触发一次后台资料补全（有网络时自动回填生日、身高、三围等）。
  useEffect(()=>{void window.vm.actressEnrich().then(state=>{if(state.started)notify('正在后台补全演员资料，完成后自动刷新')}).catch(()=>{})},[epoch,notify])
  useEffect(()=>{const element=sentinel.current;if(!element)return;const observer=new IntersectionObserver(records=>{if(records[0]?.isIntersecting&&list.hasNextPage&&!list.isFetchingNextPage)void list.fetchNextPage()},{rootMargin:'480px'});observer.observe(element);return()=>observer.disconnect()},[list.hasNextPage,list.isFetchingNextPage])
  const changeSort=(value:string)=>{setSort(value);void window.vm.settings({actressSort:value}).catch(()=>{})}
  const open=(item:Actress)=>navigate(null,'library',{...defaultQuery,actress:item.name})
  return <div className="actress-view" role="region" aria-label="演员列表">
    <div className="actress-toolbar">
      <div className="actress-summary"><strong>{total.toLocaleString()}</strong><span>位演员 · 来自视频刮削结果</span></div>
      <div className="toolbar-spacer"/>
      <label className="actress-sort"><span>排序</span><select aria-label="演员排序方式" value={sort} onChange={e=>changeSort(e.target.value)}>
        {ACTRESS_SORTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select><ChevronDown size={13}/></label>
    </div>
    {list.isError?<div className="empty-state"><h2>无法读取演员列表</h2><p>{String(list.error)}</p><button className="primary" onClick={()=>void list.refetch()}>重新加载</button></div>
     :!items.length&&!list.isLoading?<div className="empty-state actress-empty"><div className="brand-mark"><Users size={30}/></div><h2>暂无演员数据</h2><p>{scrapeEnabled?'对视频执行刮削后，演员会自动汇总到这里。':'请先在「设置 → 视频刮削」中启用刮削，再对视频执行刮削。'}</p></div>
     :list.isLoading&&!items.length?<div className="actress-grid-wrap"><Busy label="正在读取演员列表…"/></div>
     :<>
      <div className="actress-grid" style={{gridTemplateColumns:`repeat(auto-fill,minmax(${Math.min(Math.max(cardWidth,180),340)}px,1fr))`}}>
        {items.map(item=><ActressCard key={item.id} item={item} fit={fit} open={open} onEditCover={setCoverItem} onEditProfile={setProfileItem}/>)}
      </div>
      <div ref={sentinel} className="actress-sentinel">{list.isFetchingNextPage?<Busy label="正在加载更多…"/>:items.length?`${items.length.toLocaleString()} / ${total.toLocaleString()}`:''}</div>
     </>}
    {coverItem&&<ActressCoverModal item={coverItem} onClose={()=>setCoverItem(null)} notify={notify}/>}
    {profileItem&&<ActressEditModal item={profileItem} onClose={()=>setProfileItem(null)} notify={notify}/>}
  </div>
}
