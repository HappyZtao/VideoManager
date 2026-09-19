import {useEffect,useState} from 'react'
import {Check,Palette} from 'lucide-react'
import {paletteColors} from './palette'
export function ThemePalette({value,busy,save}:{value:unknown;busy:boolean;save:(patch:Record<string,unknown>)=>void}){
 const color=typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():'#55d6b7'
 const [draft,setDraft]=useState(color)
 useEffect(()=>setDraft(color),[color])
 const commit=(value:string)=>{if(/^#[0-9a-f]{6}$/i.test(value)){setDraft(value.toLowerCase());save({accentColor:value.toLowerCase()})}else setDraft(color)}
 return <div className="theme-palette"><div className="palette-heading"><div><strong><Palette size={17}/>主题强调色</strong><small>用于按钮、选中状态和界面点缀，自动适配深浅主题。</small></div><button className="text-button" disabled={busy} onClick={()=>save({accentColor:null})}>恢复默认</button></div><div className="palette-options" role="radiogroup" aria-label="主题调色板">{paletteColors.map(item=><button key={item.value} role="radio" aria-checked={color===item.value} aria-label={item.name} title={item.name} disabled={busy} className={'palette-swatch'+(color===item.value?' selected':'')} onClick={()=>commit(item.value)}><span style={{background:item.value}}>{color===item.value&&<Check size={18}/>}</span><small>{item.name}</small></button>)}</div><div className="palette-custom"><label>自定义颜色<input aria-label="选择自定义主题颜色" type="color" value={/^#[0-9a-f]{6}$/i.test(draft)?draft:color} disabled={busy} onChange={event=>setDraft(event.target.value)} onBlur={event=>{if(event.currentTarget.value!==color)commit(event.currentTarget.value)}}/></label><input aria-label="主题颜色十六进制值" value={draft} maxLength={7} spellCheck={false} disabled={busy} onChange={event=>setDraft(event.target.value)} onBlur={()=>{if(draft!==color)commit(draft)}} onKeyDown={event=>{if(event.key==='Enter')commit(draft)}}/><button className="secondary" disabled={busy||!/^#[0-9a-f]{6}$/i.test(draft)||draft===color} onClick={()=>commit(draft)}>应用颜色</button></div></div>
}
