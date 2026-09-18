export type PluginSlot = 'navigation.presenter'|'content.layout'|'viewer.image'|'viewer.video'|'cover.strategy'|'organize.actions'|'file.actions'|'source.provider'
export interface PluginManifest {
 id: string;name: string;description: string;version: string;hostApiVersion: string;platforms: string[];requires: string[];slot: PluginSlot;group: string;configSchema: Record<string,unknown>;defaults: Record<string,unknown>
}
export interface HostPluginSDK { register(slot: PluginSlot,id: string,config: Record<string,unknown>):()=>void; log(message:string):void }
export interface HostPlugin { manifest: PluginManifest; setup(sdk:HostPluginSDK,config:Record<string,unknown>):void|(()=>void)|Promise<void|(()=>void)> }
