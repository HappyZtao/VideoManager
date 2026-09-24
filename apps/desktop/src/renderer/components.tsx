import { useEffect,useState,useSyncExternalStore,type ReactNode,Component } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Switch } from '@heroui/react'
import { X,Folder,Image as ImageIcon,Film,LoaderCircle,Check,Star,MoreHorizontal,Eye,Pin,Tag,Pencil,FolderInput,Trash2,Copy,ExternalLink,FolderOpen,ImagePlus,Clapperboard } from 'lucide-react'
import type { Entry } from '../../../../packages/contracts'

let thumbnailGeneration=0
const thumbnailListeners=new Set<()=>void>()
const subscribeThumbnails=(listener:()=>void)=>{thumbnailListeners.add(listener);return()=>{thumbnailListeners.delete(listener)}}
const latestThumbnail=new Map<string,string>()
const thumbnailCache=new Map<string,string>()
const thumbnailPending=new Map<string,Promise<string>>()
const thumbnailKey=(entry:Entry)=>`${entry.id}:${entry.revision}:${entry.coverRevision}:${thumbnailGeneration}`
function rememberThumbnail(key:string,url:string){thumbnailCache.delete(key);thumbnailCache.set(key,url);while(thumbnailCache.size>400){const oldest=thumbnailCache.keys().next().value as string;const stale=thumbnailCache.get(oldest);thumbnailCache.delete(oldest);if(stale){for(const [id,url]of latestThumbnail)if(url===stale)latestThumbnail.delete(id);void window.vm.release(stale)}}}
export function clearThumbCache(){for(const url of thumbnailCache.values())void window.vm.release(url);thumbnailCache.clear();thumbnailPending.clear();latestThumbnail.clear();thumbnailGeneration++;for(const listener of thumbnailListeners)listener()}

export function IconButton({children,label,onClick,disabled=false,active=false}:{children:ReactNode;label:string;onClick?:()=>void;disabled?:boolean;active?:boolean}){return <button className={'icon-button'+(active?' active':'')} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>}
// 设置开关统一使用 HeroUI Switch（弹簧动效），配色经 --heroui-primary 跟随应用强调色。
export function Toggle({on,busy=false,label,onChange}:{on:boolean;busy?:boolean;label:string;onChange:()=>void}){return <Switch size="sm" isSelected={on} isDisabled={busy} aria-label={label} classNames={{base:'vm-switch',wrapper:'vm-switch-track',thumb:'vm-switch-thumb'}} onValueChange={onChange}/>}
export function Modal({title,description,children,onClose,wide=false}:{title:string;description?:string;children:ReactNode;onClose:()=>void;wide?:boolean}){return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={'modal'+(wide?' wide':'')} aria-describedby={description?'modal-description':undefined}><header><div><Dialog.Title>{title}</Dialog.Title>{description&&<Dialog.Description id="modal-description">{description}</Dialog.Description>}</div><Dialog.Close asChild><button className="icon-button" aria-label="关闭"><X size={20}/></button></Dialog.Close></header>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>}
export function Thumb({entry,className=''}:{entry:Entry;className?:string}){
 useSyncExternalStore(subscribeThumbnails,()=>thumbnailGeneration)
 const key=thumbnailKey(entry)
 const [display,setDisplay]=useState(()=>({id:entry.id,url:thumbnailCache.get(key)??latestThumbnail.get(entry.id)??''}))
 const [error,setError]=useState('')
 const url=display.id===entry.id?display.url:''
 useEffect(()=>{
  let active=true;const generation=thumbnailGeneration;const cached=thumbnailCache.get(key);setError('')
  if(cached){setDisplay({id:entry.id,url:cached});return()=>{active=false}}
  // Keep this entry's last decoded cover until its replacement is ready.
  const previous=latestThumbnail.get(entry.id)
  if(previous)setDisplay({id:entry.id,url:previous})
  let request=thumbnailPending.get(key)
  if(!request){request=window.vm.media(entry.id,'thumbnail');thumbnailPending.set(key,request);void request.then(()=>thumbnailPending.delete(key),()=>thumbnailPending.delete(key))}
  void request.then(async value=>{
   if(generation!==thumbnailGeneration){void window.vm.release(value);return}
   const decoded=new Image();decoded.src=value;await decoded.decode()
   if(generation!==thumbnailGeneration){void window.vm.release(value);return}
   rememberThumbnail(key,value);latestThumbnail.set(entry.id,value)
   while(latestThumbnail.size>400)latestThumbnail.delete(latestThumbnail.keys().next().value!)
   if(active)setDisplay({id:entry.id,url:value})
  }).catch(e=>{if(active)setError(String(e))})
  return()=>{active=false}
 },[key,entry.id])
 return <div className={'thumbnail '+className} title={error||undefined}>{url?<img src={url} alt="" draggable={false} onError={()=>{thumbnailCache.delete(key);latestThumbnail.delete(entry.id);setError('缩略图不可用');setDisplay({id:entry.id,url:''})}}/>:<div className={'placeholder '+entry.kind}>{entry.kind==='folder'?<Folder size={38} strokeWidth={1.2}/>:entry.kind==='video'?<Film size={30} strokeWidth={1.2}/>:<ImageIcon size={30} strokeWidth={1.2}/>}<span>{error?(entry.rootState==='offline'?'离线 · 缓存不可用':'暂无预览'):entry.kind==='folder'?'文件夹集合':'正在生成预览'}</span></div>}{entry.coverMode==='manual'&&<span className="cover-lock" title="手动封面已锁定"><Pin size={11}/></span>}</div>
}
export function formatSize(value:number){if(value<1024)return value+' B';if(value<1024**2)return (value/1024).toFixed(1)+' KB';if(value<1024**3)return (value/1024**2).toFixed(1)+' MB';return (value/1024**3).toFixed(2)+' GB'}
export function formatTime(value:number|null){if(value==null)return '时长未知';const h=Math.floor(value/3600);const m=Math.floor(value/60)%60;const s=Math.floor(value)%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
export function Busy({label='正在处理…'}:{label?:string}){return <div className="busy"><LoaderCircle size={20} className="spin"/>{label}</div>}
export type EntryAction='open'|'preview'|'favorite'|'tags'|'cover'|'scrape'|'locate'|'rename'|'move'|'trash'|'copy'|'reveal'|'external'
export function EntryMenu({entry,onAction,contextPosition,closeContext}:{entry:Entry;onAction:(action:EntryAction,entry:Entry)=>void;contextPosition?:{x:number;y:number}|undefined;closeContext?:()=>void}){const [open,setOpen]=useState(false);const trigger=<button className="card-more icon-button" title="更多操作" aria-label={entry.name+' 的更多操作'} onClick={e=>e.stopPropagation()}><MoreHorizontal size={17}/></button>;return <Dropdown.Root open={open||!!contextPosition} onOpenChange={value=>{setOpen(value);if(!value)closeContext?.()}}>
 {contextPosition?<>{trigger}<Dropdown.Portal><Dropdown.Trigger asChild><button className="context-pointer-anchor" aria-label={entry.name+' 的右键菜单'} style={{left:Math.max(12,Math.min(window.innerWidth-12,contextPosition.x)),top:Math.max(12,Math.min(window.innerHeight-12,contextPosition.y))}}/></Dropdown.Trigger></Dropdown.Portal></>:<Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>}
 <Dropdown.Portal><Dropdown.Content className="context-menu" side="bottom" align={contextPosition?'start':'end'} sideOffset={4} collisionPadding={12} avoidCollisions sticky="always" updatePositionStrategy="always" onCloseAutoFocus={event=>{if(contextPosition)event.preventDefault()}} onClick={e=>e.stopPropagation()}>

 {([['open',entry.kind==='folder'?'进入文件夹':'打开',FolderOpen],['preview','快速预览',Eye],['favorite',entry.favorite?'取消收藏':'添加收藏',Star],['tags','编辑标签',Tag],...(entry.kind!=='image'?[['cover','设置封面',ImagePlus]]:[]),...(entry.kind==='video'?[['scrape','刮削元数据',Clapperboard]]:[]),['locate','定位所在目录',Pin],['rename','重命名',Pencil],['move','移动到…',FolderInput],['trash','移入回收站',Trash2],['copy','复制路径',Copy],['reveal','在资源管理器中显示',Folder],['external','使用默认应用打开',ExternalLink]] as [EntryAction,string,typeof Folder][]).map(([action,label,Icon])=><Dropdown.Item key={action} className={action==='trash'?'danger-text':''} onSelect={()=>onAction(action,entry)}><Icon size={15}/>{label}</Dropdown.Item>)}
 </Dropdown.Content></Dropdown.Portal></Dropdown.Root>}
export function SelectionMark({selected,onToggle,label='切换选择'}:{selected:boolean;onToggle?:()=>void;label?:string}){return <button type="button" className={'selection-mark'+(selected?' selected':'')} aria-label={label} aria-pressed={selected} onClick={event=>{event.stopPropagation();onToggle?.()}}>{selected&&<Check size={12}/>}</button>}
export class ViewBoundary extends Component<{children:ReactNode;onReset:()=>void},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return {error:true}}render(){return this.state.error?<div className="empty-state"><h2>展示插件遇到问题</h2><p>浏览位置和媒体管理信息仍然保留。</p><button className="primary" onClick={()=>{this.props.onReset();this.setState({error:false})}}>恢复基础列表</button></div>:this.props.children}}
