import { useEffect,useRef,useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Clapperboard,Film,Star,ChevronDown,Tag } from 'lucide-react'
import type { MovieCard,Entry,QuerySession,QuerySpec } from '../../../../packages/contracts'
import { Busy,Thumb,formatTime } from './components'
import { defaultQuery } from './store'

const PAGE_SIZE=60
export const MOVIE_SORTS=[
  ['recent-desc','最近入库'],
  ['code-asc','编号 A→Z'],
  ['release-desc','发行日期 新→旧'],
  ['duration-desc','时长 长→短'],
  ['title-asc','名称 A→Z']
] as const

// 电影排序 → 会话查询排序键：播放窗口沿当前电影列表顺序前后切换。
const MOVIE_QUERY_SORTS:Record<string,[QuerySpec['sort'],QuerySpec['direction']]>={
  'recent-desc':['mtime','desc'],
  'code-asc':['code','asc'],
  'release-desc':['release','desc'],
  'duration-desc':['duration','desc'],
  'title-asc':['title','asc']
}

// 电影卡片复用现有缩略图管线：封面取该视频条目自身的封面。
function thumbEntry(entryId:string):Entry{
  return {id:entryId,revision:1,coverRevision:0,kind:'video',rootState:'online',coverMode:null,coverHash:null,coverSource:null,coverOriginal:null,coverPts:null,crop:null,coverQuality:'fast',tags:[],favorite:0,name:'',rel:'',ext:'',size:0,mtime:0,identity:'',state:'present',width:null,height:null,duration:null,codec:null,directImages:0,directVideos:0,directFolders:0,subtree:0,other:0,complete:1,playback:0} as unknown as Entry
}

function MovieCardView({item,fit,open}:{item:MovieCard;fit:string;open:(item:MovieCard)=>void}){
  const actors=item.actors.slice(0,2).join('、')
  const tags=item.tags.slice(0,8)
  return <article className="card movie-card" role="button" tabIndex={0} aria-label={`${item.code} ${item.title}`}
    onClick={()=>open(item)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(item)}}}>
    <div className={'card-image movie-cover '+(fit==='contain'?'fit-contain-cover':'')}>
      <Thumb entry={thumbEntry(item.entryId)}/>
      {item.durationMin>0&&<span className="duration"><Film size={11}/>{formatTime(item.durationMin*60)}</span>}
      {item.favorite>0&&<span className="favorite-badge"><Star size={13} fill="currentColor"/></span>}
    </div>
    <div className="card-info movie-info">
      <div className="movie-code" title={item.code}><span>{item.code||'未知编号'}</span></div>
      <div className="card-title movie-title" title={item.title}><span>{item.title||'未知名称'}</span></div>
      <div className="movie-meta">
        {item.releaseDate&&<span className="movie-date">{item.releaseDate}</span>}
        {actors&&<span className="movie-actors" title={item.actors.join('、')}>{actors}</span>}
      </div>
      {tags.length>0&&<div className="movie-tags">{tags.map(tag=><span key={tag}><Tag size={10}/>{tag}</span>)}</div>}
    </div>
  </article>
}

export function MoviesView({cardWidth,fit,initialSort,epoch,onOpen,notify}:{cardWidth:number;fit:string;initialSort:string;epoch:number;onOpen:(entry:Entry,session:QuerySession,index:number)=>void;notify:(message:string)=>void}){
  const [sort,setSort]=useState(()=>MOVIE_SORTS.some(([value])=>value===initialSort)?initialSort:'recent-desc')
  const sentinel=useRef<HTMLDivElement>(null)
  const list=useInfiniteQuery({
    queryKey:['movies',sort,epoch],
    queryFn:(context: { pageParam: unknown })=>window.vm.javMovies(sort as typeof MOVIE_SORTS[number][0],Number(context.pageParam??0),PAGE_SIZE),
    initialPageParam:0,
    getNextPageParam:(last,all)=>last.items.length===PAGE_SIZE?all.reduce((sum,page)=>sum+page.items.length,0):undefined,
    staleTime:60000,gcTime:60000,retry:false,
    placeholderData:previous=>previous
  })
  const items=list.data?.pages.flatMap(page=>page.items)??[]
  const total=list.data?.pages[0]?.total??0
  useEffect(()=>{const element=sentinel.current;if(!element)return;const observer=new IntersectionObserver(records=>{if(records[0]?.isIntersecting&&list.hasNextPage&&!list.isFetchingNextPage)void list.fetchNextPage()},{rootMargin:'480px'});observer.observe(element);return()=>observer.disconnect()},[list.hasNextPage,list.isFetchingNextPage])
  const changeSort=(value:string)=>{setSort(value);void window.vm.settings({movieSort:value}).catch(()=>{})}
  // 点击卡片：停留在电影页，弹出播放窗口；会话按当前电影排序构建，播放器内可前后切换影片。
  const open=(item:MovieCard)=>{
    const [querySort,direction]=MOVIE_QUERY_SORTS[sort]??['mtime','desc']
    void (async()=>{
      const session=await window.vm.openQuery({...defaultQuery,scope:'library',movies:true,sort:querySort,direction})
      const index=await window.vm.position(session.id,item.entryId)
      if(index===null)throw Error('影片不在当前电影列表中，请刷新后重试')
      onOpen(await window.vm.entry(item.entryId),session,index)
    })().catch(e=>notify(String(e)))
  }
  return <div className="movie-view" role="region" aria-label="电影列表">
    <div className="actress-toolbar">
      <div className="actress-summary"><strong>{total.toLocaleString()}</strong><span>部电影 · 来自视频刮削结果</span></div>
      <div className="toolbar-spacer"/>
      <label className="actress-sort"><span>排序</span><select aria-label="电影排序方式" value={sort} onChange={e=>changeSort(e.target.value)}>
        {MOVIE_SORTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select><ChevronDown size={13}/></label>
    </div>
    {list.isError?<div className="empty-state"><h2>无法读取电影列表</h2><p>{String(list.error)}</p><button className="primary" onClick={()=>void list.refetch()}>重新加载</button></div>
     :!items.length&&!list.isLoading?<div className="empty-state actress-empty"><div className="brand-mark"><Clapperboard size={30}/></div><h2>暂无电影数据</h2><p>{'对视频执行刮削后，影片会自动出现在这里。'}</p></div>
     :list.isLoading&&!items.length?<div className="actress-grid-wrap"><Busy label="正在读取电影列表…"/></div>
     :<>
      <div className="actress-grid" style={{gridTemplateColumns:`repeat(auto-fill,minmax(${Math.min(Math.max(cardWidth,260),460)}px,1fr))`}}>
        {items.map(item=><MovieCardView key={item.entryId} item={item} fit={fit} open={open}/>)}
      </div>
      <div ref={sentinel} className="actress-sentinel">{list.isFetchingNextPage?<Busy label="正在加载更多…"/>:items.length?`${items.length.toLocaleString()} / ${total.toLocaleString()}`:''}</div>
     </>}
  </div>
}
