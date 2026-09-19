import {Globe,MonitorPlay,ExternalLink,Check} from 'lucide-react'
import type {PluginInfo} from '../../../../packages/contracts'

const players=[
 {id:'builtin.viewer-video',name:'Chromium',note:'内置播放',description:'直接在应用中预览，适合常见 MP4、WebM 视频。',icon:Globe},
 {id:'builtin.viewer-mpv',name:'mpv',note:'内嵌播放',description:'在同一播放界面支持更多编码、字幕、音轨与续播。',icon:MonitorPlay},
 {id:'builtin.viewer-system',name:'系统默认应用',note:'遵循 Windows 设置',description:'交给已关联的播放器打开，使用熟悉的播放体验。',icon:ExternalLink}
]
export function PlayerSettings({plugins,busy,choose}:{plugins:PluginInfo[];busy:boolean;choose:(plugin:PluginInfo)=>void}){
 return <section className="player-settings"><h3><MonitorPlay size={20}/>视频播放方式</h3><p className="muted">双击视频时使用所选播放器。三种方式互斥启用，图片浏览不受影响。</p><div className="player-options" role="radiogroup" aria-label="默认视频播放器">{players.map(player=>{const plugin=plugins.find(item=>item.id===player.id);if(!plugin)return null;const Icon=player.icon;return <button key={player.id} type="button" role="radio" aria-checked={plugin.enabled} disabled={busy} className={'player-option'+(plugin.enabled?' selected':'')} onClick={()=>choose(plugin)}><div className="player-option-title"><Icon size={21}/><strong>{player.name}</strong><span className="player-choice">{plugin.enabled&&<Check size={13}/>}</span></div><span className="player-option-note">{player.note}</span><p>{player.description}</p></button>})}</div><small className="muted">mpv 已随安装包提供，无需单独安装。系统默认应用的播放进度由外部播放器管理。</small><div className="divider"/></section>
}
