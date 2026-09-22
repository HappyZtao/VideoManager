import { useEffect,useMemo,useRef,useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Users,Film,Cake,ChevronDown } from 'lucide-react'
import type { Actress,Entry } from '../../../../packages/contracts'
import { Busy,Thumb } from './components'
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

// 女优头像复用其代表作封面的缩略图管线（优先取有刮削封面的最新作品）。
function coverEntry(coverEntryId:string):Entry{
  return {id:coverEntryId,revision:1,coverRevision:0,kind:'video',rootState:'online',coverMode:null,coverHash:null,coverSource:null,coverOriginal:null,coverPts:null,crop:null,coverQuality:'fast',tags:[],favorite:0,name:'',rel:'',ext:'',size:0,mtime:0,identity:'',state:'present',width:null,height:null,duration:null,codec:null,directImages:0,directVideos:0,directFolders:0,subtree:0,other:0,complete:1,playback:0} as unknown as Entry
}

function ActressCard({item,fit,open}:{item:Actress;fit:string;open:(item:Actress)=>void}){
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
  // 打开女优页即触发一次后台资料补全（有网络时自动回填生日、身高、三围等）。
  useEffect(()=>{void window.vm.actressEnrich().then(state=>{if(state.started)notify('正在后台补全女优资料，完成后自动刷新')}).catch(()=>{})},[epoch,notify])
  useEffect(()=>{const element=sentinel.current;if(!element)return;const observer=new IntersectionObserver(records=>{if(records[0]?.isIntersecting&&list.hasNextPage&&!list.isFetchingNextPage)void list.fetchNextPage()},{rootMargin:'480px'});observer.observe(element);return()=>observer.disconnect()},[list.hasNextPage,list.isFetchingNextPage])
  const changeSort=(value:string)=>{setSort(value);void window.vm.settings({actressSort:value}).catch(()=>{})}
  const open=(item:Actress)=>navigate(null,'library',{...defaultQuery,actress:item.name})
  return <div className="actress-view" role="region" aria-label="女优列表">
    <div className="actress-toolbar">
      <div className="actress-summary"><strong>{total.toLocaleString()}</strong><span>位女优 · 来自视频刮削结果</span></div>
      <div className="toolbar-spacer"/>
      <label className="actress-sort"><span>排序</span><select aria-label="女优排序方式" value={sort} onChange={e=>changeSort(e.target.value)}>
        {ACTRESS_SORTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select><ChevronDown size={13}/></label>
    </div>
    {list.isError?<div className="empty-state"><h2>无法读取女优列表</h2><p>{String(list.error)}</p><button className="primary" onClick={()=>void list.refetch()}>重新加载</button></div>
     :!items.length&&!list.isLoading?<div className="empty-state actress-empty"><div className="brand-mark"><Users size={30}/></div><h2>暂无女优数据</h2><p>{scrapeEnabled?'对视频执行刮削后，演员会自动汇总到这里。':'请先在「设置 → 视频刮削」中启用刮削，再对视频执行刮削。'}</p></div>
     :list.isLoading&&!items.length?<div className="actress-grid-wrap"><Busy label="正在读取女优列表…"/></div>
     :<>
      <div className="actress-grid" style={{gridTemplateColumns:`repeat(auto-fill,minmax(${Math.min(Math.max(cardWidth,180),340)}px,1fr))`}}>
        {items.map(item=><ActressCard key={item.id} item={item} fit={fit} open={open}/>)}
      </div>
      <div ref={sentinel} className="actress-sentinel">{list.isFetchingNextPage?<Busy label="正在加载更多…"/>:items.length?`${items.length.toLocaleString()} / ${total.toLocaleString()}`:''}</div>
     </>}
  </div>
}
