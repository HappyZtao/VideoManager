export const paletteColors=[{name:'翡翠',value:'#55d6b7'},{name:'海蓝',value:'#60a5fa'},{name:'鸢尾',value:'#a78bfa'},{name:'玫瑰',value:'#fb7185'},{name:'琥珀',value:'#fbbf24'},{name:'石墨',value:'#94a3b8'}]
const properties=['--accent','--on-accent','--accent-wash','--accent-dim','--folder-color','--folder-bg','--art-bg','--art-border','--art-icon','--tag-purple','--tag-blue']
const luminance=(rgb:number[])=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0)
const contrast=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
export function applyAccent(value:unknown,dark:boolean){
 const style=document.documentElement.style
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value)){for(const name of properties)style.removeProperty(name);return}
 let rgb=[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));const background=luminance(dark?[24,33,43]:[255,255,255])
 for(let i=0;i<30&&contrast(luminance(rgb),background)<4.5;i++)rgb=rgb.map(channel=>Math.round(channel*.92+(dark?255:0)*.08))
 const accent='#'+rgb.map(channel=>channel.toString(16).padStart(2,'0')).join(''),light=luminance(rgb)
 const vars:Record<string,string>={'--accent':accent,'--on-accent':contrast(light,0)>contrast(light,1)?'#071018':'#ffffff','--accent-wash':accent+'16','--accent-dim':accent+'45','--folder-color':accent,'--folder-bg':`color-mix(in srgb, ${accent} 12%, var(--surface))`,'--art-bg':`color-mix(in srgb, ${accent} 12%, var(--surface))`,'--art-border':accent+'70','--art-icon':accent,'--tag-purple':accent,'--tag-blue':accent}
 for(const [name,color]of Object.entries(vars))style.setProperty(name,color)
}
