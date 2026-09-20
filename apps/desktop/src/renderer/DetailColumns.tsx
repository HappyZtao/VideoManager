import {useEffect,useRef,useState} from 'react'
import {GripVertical} from 'lucide-react'

const definitions=[{id:'name',label:'名称',width:340,min:220},{id:'type',label:'类型',width:96,min:72},{id:'duration',label:'时长',width:96,min:80},{id:'size',label:'大小',width:112,min:88},{id:'mtime',label:'修改时间',width:164,min:128}] as const
export type DetailColumn=typeof definitions[number]['id']
type Column={id:DetailColumn;width:number}
const storageKey='videomanager.detail-columns.v1'
const defaults=()=>definitions.map(({id,width})=>({id,width:Number(width)}))
function readColumns():Column[]{try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(Array.isArray(saved)&&saved.length===definitions.length&&new Set(saved.map(item=>item.id)).size===definitions.length&&saved.every(item=>definitions.some(def=>def.id===item.id)&&Number.isFinite(item.width))){return saved.map(item=>({id:item.id,width:Math.min(1000,Math.max(definitions.find(def=>def.id===item.id)!.min,item.width))}))}}catch{}return defaults()}
export function useDetailColumns(){
 const [columns,setColumns]=useState<Column[]>(readColumns),[dragged,setDragged]=useState<DetailColumn|null>(null),[over,setOver]=useState<DetailColumn|null>(null)
 const resize=useRef<{id:DetailColumn;x:number;width:number}|null>(null)
 useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(storageKey,JSON.stringify(columns))}catch{}},250);return()=>clearTimeout(timer)},[columns])
 const move=(id:DetailColumn,target:DetailColumn)=>setColumns(current=>{const next=[...current],from=next.findIndex(item=>item.id===id),to=next.findIndex(item=>item.id===target);next.splice(to,0,next.splice(from,1)[0]!);return next})
 const width=(id:DetailColumn,value:number)=>setColumns(current=>current.map(item=>item.id===id?{...item,width:Math.round(Math.min(1000,Math.max(definitions.find(def=>def.id===id)!.min,value)))}:item))
 const template=columns.map(item=>`${item.width}px`).join(' ')+' 32px minmax(0,1fr)'
 const header=<div className="list-columns" style={{gridTemplateColumns:template}}>{columns.map((column,index)=>{const def=definitions.find(item=>item.id===column.id)!;return <div key={column.id} className={'list-column-heading'+(over===column.id&&dragged!==column.id?' drop-target':'')} onDragOver={event=>{if(dragged){event.preventDefault();event.dataTransfer.dropEffect='move';setOver(column.id)}}} onDrop={event=>{event.preventDefault();if(dragged)move(dragged,column.id);setDragged(null);setOver(null)}}>
  <button className="list-column-label" draggable title="拖动调整列顺序；Alt + 左右方向键也可移动" onDragStart={event=>{setDragged(column.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',column.id)}} onDragEnd={()=>{setDragged(null);setOver(null)}} onKeyDown={event=>{if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();const target=columns[index+(event.key==='ArrowLeft'?-1:1)];if(target)move(column.id,target.id)}}}><GripVertical size={12}/>{def.label}</button>
  <span className="list-column-resize" role="separator" aria-label={`调整${def.label}列宽`} aria-orientation="vertical" aria-valuemin={def.min} aria-valuemax={1000} aria-valuenow={column.width} tabIndex={0} title="拖动调整宽度；双击恢复默认" onDoubleClick={()=>width(column.id,def.width)} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();resize.current={id:column.id,x:event.clientX,width:column.width};event.currentTarget.setPointerCapture(event.pointerId)}} onPointerMove={event=>{if(resize.current?.id===column.id&&event.currentTarget.hasPointerCapture(event.pointerId))width(column.id,resize.current.width+event.clientX-resize.current.x)}} onPointerUp={event=>{resize.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}} onPointerCancel={()=>{resize.current=null}} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();width(column.id,column.width+(event.key==='ArrowLeft'?-16:16))}}}/>
 </div>})}<span/></div>
 return {columns,template,header,minWidth:columns.reduce((sum,item)=>sum+item.width,0)+50}
}
