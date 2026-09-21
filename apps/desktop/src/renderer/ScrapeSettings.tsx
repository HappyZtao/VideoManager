import { useQuery } from '@tanstack/react-query'
import { Sparkles,ChevronUp,ChevronDown,Clapperboard,Info } from 'lucide-react'
import type { ScrapeStats } from '../../../../packages/contracts'
import { IconButton } from './components'

type SaveFn = (patch: Record<string, unknown>) => void
type RunFn = (label: string, action: () => Promise<unknown>) => Promise<unknown>

// 视频刮削设置：总开关、数据源优先级、并发与封面下载。
export function ScrapeSettings({settings,busy,save,run,notify}:{settings:Record<string,unknown>;busy:boolean;save:SaveFn;run:RunFn;notify:(message:string)=>void}){
 const enabled=Boolean(settings.scrapeEnabled)
 const providersQuery=useQuery({queryKey:['scrape-providers'],queryFn:()=>window.vm.scrapeProviders(),staleTime:Infinity})
 const statsQuery=useQuery({queryKey:['scrape-stats'],queryFn:()=>window.vm.scrapeStats() as Promise<ScrapeStats>})
 const order=Array.isArray(settings.scrapeProviders)?(settings.scrapeProviders as string[]):[]
 const providers=providersQuery.data??[]
 const chain=order.length?order:providers.filter(provider=>provider.kind==='movie').map(provider=>provider.id)
 const toggle=(id:string,checked:boolean)=>{
  const next=checked?[...chain.filter(item=>item!==id),id]:chain.filter(item=>item!==id)
  if(!next.length){notify('至少保留一个数据源');return}
  save({scrapeProviders:next})
 }
 const move=(id:string,delta:number)=>{
  const index=chain.indexOf(id)
  const target=index+delta
  if(index<0||target<0||target>=chain.length)return
  const next=[...chain];const [item]=next.splice(index,1);next.splice(target,0,item!)
  save({scrapeProviders:next})
 }
 return <div className="scrape-settings">
  <h3>视频刮削 <span className="badge">实验功能</span></h3>
  <p className="muted">根据文件名中的番号，从公开资料站自动匹配标题、封面、演员与分类。所有查询只保存在本机媒体库中。</p>
  <div className="setting-row">
    <div><strong>启用视频刮削</strong><small>关闭后，条目菜单与批量刮削将不可用；已保存的刮削数据会保留展示。</small></div>
    <button className={'switch'+(enabled?' on':'')} role="switch" aria-checked={enabled} aria-label="启用视频刮削" disabled={busy} onClick={()=>save({scrapeEnabled:!enabled})}><span/></button>
  </div>
  {!enabled&&<div className="performance-tip"><Sparkles size={18}/><p><strong>刮削未启用</strong>。打开上方开关后，即可在视频的「更多操作」菜单中使用「刮削元数据」，或选中多个视频批量刮削。</p></div>}
  <div className="setting-row">
    <div><strong>刮削并发数</strong><small>同时处理的视频数量；站点有访问频率限制，过高容易失败。1–8 之间。</small></div>
    <select aria-label="刮削并发数" value={Number(settings.scrapeConcurrency??2)} disabled={busy} onChange={event=>save({scrapeConcurrency:Number(event.target.value)})}>{[1,2,3,4,6,8].map(value=><option key={value} value={value}>{value}</option>)}</select>
  </div>
  <div className="setting-row">
    <div><strong>自动下载封面</strong><small>匹配成功后把封面图下载到媒体库数据目录，可随时在刮削面板中设为条目封面。</small></div>
    <button className={'switch'+(settings.scrapeDownloadCover!==false?' on':'')} role="switch" aria-checked={settings.scrapeDownloadCover!==false} aria-label="自动下载封面" disabled={busy} onClick={()=>save({scrapeDownloadCover:settings.scrapeDownloadCover===false})}><span/></button>
  </div>
  <div className="setting-row">
    <div><strong>自动将刮削封面设为条目封面</strong><small>匹配到封面后立即替换卡片显示的封面（原自动封面可在刮削面板中恢复）。关闭后仍可在刮削面板手动设置。</small></div>
    <button className={'switch'+(settings.scrapeAutoSetCover!==false?' on':'')} role="switch" aria-checked={settings.scrapeAutoSetCover!==false} aria-label="自动将刮削封面设为条目封面" disabled={busy} onClick={()=>save({scrapeAutoSetCover:settings.scrapeAutoSetCover===false})}><span/></button>
  </div>
  <div className="setting-row">
    <div><strong>系统代理</strong><small>自动跟随 Windows 系统代理（含 PAC 分流）访问数据源与图片 CDN，无需手动配置；更改代理后重启应用生效。</small></div>
    <span className="badge">自动检测</span>
  </div>
  <h4>数据源与优先级</h4>
  <p className="muted">批量刮削按从上到下的顺序尝试，返回第一个成功结果；单个视频的刮削面板会同时查询所有勾选的数据源。</p>
  <div className="scrape-provider-list">
   {providers.map(provider=>{
     const checked=chain.includes(provider.id)
     const index=chain.indexOf(provider.id)
     return <div key={provider.id} className={'scrape-provider-row'+(checked?' enabled':'')}>
       <Clapperboard size={17}/>
       <div className="scrape-provider-info"><strong>{provider.label}{provider.kind==='auxiliary'&&<span className="badge">辅助</span>}</strong><small>{provider.description}</small></div>
       <div className="scrape-provider-order">
         <IconButton label={`上移 ${provider.label}`} disabled={!checked||index<=0||busy} onClick={()=>move(provider.id,-1)}><ChevronUp size={14}/></IconButton>
         <IconButton label={`下移 ${provider.label}`} disabled={!checked||index<0||index>=chain.length-1||busy} onClick={()=>move(provider.id,1)}><ChevronDown size={14}/></IconButton>
       </div>
       <button className={'switch'+(checked?' on':'')} role="switch" aria-checked={checked} aria-label={'使用 '+provider.label} disabled={busy||provider.kind==='auxiliary'} onClick={()=>toggle(provider.id,!checked)}><span/></button>
     </div>
   })}
   {!providers.length&&!providersQuery.isPending&&<p className="muted">数据源列表加载失败，请重启应用。</p>}
  </div>
  <div className="divider"/>
  <div className="setting-row">
    <div><strong>刮削进度</strong><small>已刮削 {statsQuery.data?.scraped??'…'} / {statsQuery.data?.videos??'…'} 个视频，其中 {statsQuery.data?.covers??'…'} 个已下载封面。</small></div>
    <span className="badge"><Info size={10}/>数据仅存于本机</span>
  </div>
  <p className="muted">刮削过程会记录到媒体库数据目录的 logs/scrape.log，便于排查匹配失败的原因。</p>
 </div>
}
