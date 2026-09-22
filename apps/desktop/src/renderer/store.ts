import { create } from 'zustand'
import type { QuerySpec,Selection } from '../../../../packages/contracts'
import { querySchema } from '../../../../packages/contracts'
export const defaultQuery:QuerySpec={folderId:null,scope:'library',text:'',searchFields:['name','folder','tag'],kinds:[],extensions:[],tags:[],favorite:false,actress:'',sort:'name',direction:'asc',minSize:null,maxSize:null,after:null,before:null,minDuration:null,maxDuration:null}
export type ViewMode='library'|'actresses'
export type Browse={view:ViewMode;query:QuerySpec;selected:string[];snapshot:string|null;snapshotCount:number;anchor:number;anchorId:string|null}
type UIState=Browse&{views:Record<string,Browse>;history:Browse[];future:Browse[];hydrate:(views:unknown,last:unknown)=>void;navigate:(id:string|null,scope?:QuerySpec['scope'],patch?:Partial<QuerySpec>)=>void;openActresses:()=>void;setQuery:(patch:Partial<QuerySpec>)=>void;select:(ids:string[],snapshot?:string|null,count?:number)=>void;back:()=>void;forward:()=>void;setAnchor:(index:number,id:string|null)=>void;reset:()=>void}
const snapshot=(s:Browse):Browse=>({view:s.view,query:s.query,selected:s.selected,snapshot:s.snapshot,snapshotCount:s.snapshotCount,anchor:s.anchor,anchorId:s.anchorId})
const initial={view:'library' as ViewMode,query:defaultQuery,selected:[],snapshot:null,snapshotCount:0,anchor:0,anchorId:null,history:[],future:[],views:{}}
export const persistentBrowse=(s:Browse)=>({...snapshot(s),selected:s.selected.slice(0,1000),snapshot:null,snapshotCount:0})
function safeBrowse(value:unknown):Browse|null{if(!value||typeof value!=='object')return null;const s=value as Browse;const q=querySchema.safeParse(s.query);if(!q.success)return null;return {view:s.view==='actresses'?'actresses':'library',query:q.data,selected:Array.isArray(s.selected)?s.selected.filter(id=>typeof id==='string').slice(0,1000):[],snapshot:null,snapshotCount:0,anchor:Number.isInteger(s.anchor)&&s.anchor>=0?s.anchor:0,anchorId:typeof s.anchorId==='string'?s.anchorId:null}}
export const useNavigation=create<UIState>((set,get)=>({...initial,
 hydrate:(views,last)=>{const valid:Record<string,Browse>={};if(views&&typeof views==='object')for(const [key,value]of Object.entries(views).slice(-50)){const browse=safeBrowse(value);if(browse)valid[key]=browse}set({views:valid,...safeBrowse(last)})},
 navigate:(id,scope='direct',patch={})=>{const old=get();const views={...old.views,[old.query.folderId??'library']:persistentBrowse(old)};const saved=views[id??'library'];const preserve=saved&&Object.keys(patch).length===0;set({view:'library',history:[...old.history.slice(-49),snapshot(old)],future:[],views:Object.fromEntries(Object.entries(views).slice(-50)),query:{...defaultQuery,...(preserve?saved.query:old.query),folderId:id,scope:preserve?saved.query.scope:scope,...patch},selected:preserve?saved.selected:[],snapshot:null,snapshotCount:0,anchor:preserve?saved.anchor:0,anchorId:preserve?saved.anchorId:null})},
 openActresses:()=>{const old=get();if(old.view==='actresses')return;const views={...old.views,[old.query.folderId??'library']:persistentBrowse(old)};set({view:'actresses',history:[...old.history.slice(-49),snapshot(old)],future:[],views:Object.fromEntries(Object.entries(views).slice(-50)),query:{...defaultQuery},selected:[],snapshot:null,snapshotCount:0,anchor:0,anchorId:null})},
 setQuery:patch=>set(s=>({query:{...s.query,...patch},selected:[],snapshot:null,snapshotCount:0,anchor:0,anchorId:null})),
 select:(ids,snapshot=null,count=0)=>set({selected:ids,snapshot,snapshotCount:count}),
 setAnchor:(anchor,anchorId)=>set({anchor,anchorId}),
 back:()=>{const s=get();const last=s.history.at(-1);if(last)set({...last,history:s.history.slice(0,-1),future:[snapshot(s),...s.future]})},
 forward:()=>{const s=get();const next=s.future[0];if(next)set({...next,history:[...s.history,snapshot(s)],future:s.future.slice(1)})},
 reset:()=>set(initial)
}))
export const selection=():Selection=>{const s=useNavigation.getState();return s.snapshot?{snapshotId:s.snapshot}:{ids:s.selected}}
