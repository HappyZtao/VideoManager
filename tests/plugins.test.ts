import {describe,it,expect} from 'vitest'
import {PluginManager} from '../packages/cordis-adapter'
describe('Cordis 功能生命周期',()=>{
 it('视频播放器互斥选择，默认 Chromium，保存后恢复 mpv 或系统应用',async()=>{
  const manager=new PluginManager();await manager.init()
  expect(manager.slots.get('viewer.video')?.id).toBe('builtin.viewer-video')
  for(const id of ['builtin.viewer-mpv','builtin.viewer-system']){
   await manager.set(id,true,{})
   expect(manager.list().filter(p=>p.slot==='viewer.video'&&p.enabled).map(p=>p.id)).toEqual([id])
   const restored=new PluginManager();await restored.init(manager.serialize())
   expect(restored.slots.get('viewer.video')?.id).toBe(id);await restored.close()
  }
  await manager.set('builtin.viewer-system',false,{})
  expect(manager.slots.get('viewer.video')?.id).toBe('builtin.viewer-video')
  await manager.close()
 })
 it('两个布局切换时只保留一个槽位，配置非法不破坏旧插件',async()=>{const manager=new PluginManager();await manager.init();expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-grid');await manager.set('builtin.content-list',true,{cardWidth:224,fit:'contain'});expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-list');expect(manager.enabled('content-grid')).toBe(false);await expect(manager.set('builtin.content-grid',true,{cardWidth:999})).rejects.toThrow();expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-list');await manager.set('builtin.content-list',false,{});expect(manager.slots.has('content.layout')).toBe(true);await manager.close();expect(manager.slots.size).toBe(0)})
})
