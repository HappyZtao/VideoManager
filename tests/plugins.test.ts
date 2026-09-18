import {describe,it,expect} from 'vitest'
import {PluginManager} from '../packages/cordis-adapter'
describe('Cordis 功能生命周期',()=>{
 it('两个布局切换时只保留一个槽位，配置非法不破坏旧插件',async()=>{const manager=new PluginManager();await manager.init();expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-grid');await manager.set('builtin.content-list',true,{cardWidth:224,fit:'contain'});expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-list');expect(manager.enabled('content-grid')).toBe(false);await expect(manager.set('builtin.content-grid',true,{cardWidth:999})).rejects.toThrow();expect(manager.slots.get('content.layout')?.id).toBe('builtin.content-list');await manager.set('builtin.content-list',false,{});expect(manager.slots.has('content.layout')).toBe(true);await manager.close();expect(manager.slots.size).toBe(0)})
})
