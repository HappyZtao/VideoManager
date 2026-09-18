import { contextBridge,ipcRenderer } from 'electron'
import type { VMApi,VMEvent } from '../../../../packages/contracts'
const methods=['bootstrap','pickRoot','addRoot','removeRoot','refreshRoot','rebindPreview','rebindRoot','openQuery','page','position','entry','ancestors','children','freeze','organize','media','release','playback','system','coverSource','coverSnapshot','frame','closeSource','saveCover','recommend','restoreCover','plan','commit','taskAction','plugins','setPlugin','loadPlugin','settings','clearCache','exportLibrary','importLibrary','switchLibrary','diagnostics'] as const
const api:Record<string,unknown>={};for(const method of methods)api[method]=async(...args:unknown[])=>{const response=await ipcRenderer.invoke('vm:'+method,...args);if(!response.ok)throw Error(response.error.message);return response.data}
api.onEvent=(callback:(event:VMEvent)=>void)=>{const listener=(_event:unknown,message:VMEvent)=>callback(message);ipcRenderer.on('vm:event',listener);return ()=>ipcRenderer.removeListener('vm:event',listener)}
contextBridge.exposeInMainWorld('vm',Object.freeze(api) as unknown as VMApi)
