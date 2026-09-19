import { Context, type Fiber } from 'cordis'
import Ajv from 'ajv'
import type { HostPlugin,HostPluginSDK } from '../plugin-sdk'
import type { PluginInfo } from '../contracts'
import { builtins } from '../../plugins/builtins'

export class PluginManager {
  private context=new Context()
  private ajv=new Ajv({allErrors:true})
  private plugins=new Map(builtins.map(p=>[p.manifest.id,p]))
  private fibers=new Map<string,Fiber>()
  private configs=new Map<string,Record<string,unknown>>()
  private failures=new Map<string,string>()
  slots=new Map<string,{id:string;config:Record<string,unknown>}>()
  async init(saved:Record<string,any>={}) {
    for(const p of builtins){const setting=saved[p.manifest.id];if(setting?.enabled===false)continue;if(!setting&&['builtin.navigation-visual','builtin.content-list','builtin.viewer-mpv','builtin.viewer-system'].includes(p.manifest.id))continue;try{await this.set(p.manifest.id,true,setting?.config??p.manifest.defaults)}catch(error){this.failures.set(p.manifest.id,String(error))}}
    if(!this.slots.has('viewer.video'))await this.set('builtin.viewer-video',true,{})
    if(!this.slots.has('content.layout'))await this.set('builtin.content-list',true,{cardWidth:224,fit:'cover'})
    if(!this.slots.has('navigation.presenter'))await this.set('builtin.navigation-tree',true,{})
  }
  list():PluginInfo[]{return [...this.plugins.values()].map(p=>({id:p.manifest.id,name:p.manifest.name,description:p.manifest.description,version:p.manifest.version,group:p.manifest.group,slot:p.manifest.slot,requires:p.manifest.requires,enabled:this.fibers.has(p.manifest.id),state:this.failures.has(p.manifest.id)?'faulted':this.fibers.has(p.manifest.id)?'active':'disabled',config:this.configs.get(p.manifest.id)??p.manifest.defaults,schema:p.manifest.configSchema,...(this.failures.has(p.manifest.id)?{error:this.failures.get(p.manifest.id)!}:{})}))}
  serialize(){return Object.fromEntries(this.list().map(p=>[p.id,{enabled:p.enabled,config:p.config}]))}
  enabled(id:string){return this.fibers.has('builtin.'+id)}
  async set(id:string,enabled:boolean,config:Record<string,unknown>){
    const plugin=this.plugins.get(id);if(!plugin)throw Error('插件不存在');if(!plugin.manifest.platforms.includes(process.platform)||!['1','1.0.0','^1.0.0'].includes(plugin.manifest.hostApiVersion))throw Error('插件接口或平台不兼容')
    if(plugin.manifest.requires.some(r=>!['library.query','selection','thumbnail.read'].includes(r)&&!this.slots.has(r)))throw Error('PLUGIN_DEPENDENCY_MISSING：插件缺少依赖')
    if(!enabled){if(plugin.manifest.slot==='source.provider')throw Error('本地资源是媒体库必需能力，请使用移除资源目录');await this.fibers.get(id)?.dispose();this.fibers.delete(id);if(plugin.manifest.slot==='viewer.video'&&!this.slots.has('viewer.video'))await this.set('builtin.viewer-video',true,{});if(['content.layout','navigation.presenter'].includes(plugin.manifest.slot)&&!this.slots.has(plugin.manifest.slot))await this.set(plugin.manifest.slot==='content.layout'?'builtin.content-list':'builtin.navigation-tree',true,plugin.manifest.slot==='content.layout'?{cardWidth:224,fit:'cover'}:{});return this.list()}
    if(!this.ajv.validate(plugin.manifest.configSchema,config))throw Error('配置无效：'+this.ajv.errorsText())
    const previous=this.slots.get(plugin.manifest.slot);const prior=this.fibers.get(id)
    let candidate:{id:string;config:Record<string,unknown>}|undefined
    const sdk:HostPluginSDK={register:(slot,registeredId,values)=>{if(slot!==plugin.manifest.slot||registeredId!==id)throw Error('插件贡献与清单不一致');candidate={id,config:values};return ()=>{if(this.slots.get(slot)===candidate)this.slots.delete(slot)}},log:message=>console.log(`[plugin ${id}] ${message}`)}
    const fiber=this.context.plugin({name:id,apply:async ctx=>{const dispose=await plugin.setup(sdk,config);if(dispose)ctx.effect(()=>dispose)}})
    try{await Promise.race([fiber.await(),new Promise((_,reject)=>setTimeout(()=>reject(Error('插件启动超时')),3000))]);if(!candidate)throw Error('插件未提供声明的功能');this.slots.set(plugin.manifest.slot,candidate);this.fibers.set(id,fiber);this.configs.set(id,config);this.failures.delete(id);if(previous&&previous.id!==id){await this.fibers.get(previous.id)?.dispose();this.fibers.delete(previous.id)}await prior?.dispose();return this.list()}
    catch(error){await fiber.dispose();if(previous)this.slots.set(plugin.manifest.slot,previous);this.failures.set(id,String(error));throw error}
  }
  register(plugin:HostPlugin){if(this.plugins.has(plugin.manifest.id))throw Error('插件 ID 已存在');this.plugins.set(plugin.manifest.id,plugin)}
  async close(){for(const fiber of this.fibers.values())await fiber.dispose();this.fibers.clear();this.slots.clear()}
}
