import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const regression=JSON.parse(await fs.readFile('test-results/v060-regression.json','utf8'))
assert.equal(regression.results.length,5)
const executable=path.resolve('release/win-unpacked/VideoManager.exe')
const application=await electron.launch({executablePath:executable,args:['--disable-gpu','--in-process-gpu'],env:{...process.env,VM_DATA_DIR:path.join(regression.base,'data'),VM_TEST_HIDDEN:'1'},timeout:30000})
try{
 const page=await application.firstWindow();await page.waitForFunction(()=>!!window.vm)
 const result=await page.evaluate(async()=>{
  const data=await window.vm.bootstrap()
  await window.vm.setPlugin('builtin.viewer-mpv',true,{})
  const query=await window.vm.openQuery({folderId:null,scope:'library',text:'sample.ts'})
  const entry=(await window.vm.page(query.id,0,10)).entries.find(item=>item.kind==='video')
  if(!entry)throw Error('TS fixture missing')
  window.__states=[];window.vm.onEvent(event=>{if(event.topic==='mpv-state')window.__states.push(event.data)})
  const state=await window.vm.startMpv(entry.id)
  return {version:data.version,state}
 })
 assert.equal(result.version,'0.6.0');assert.equal(result.state.status,'ready')
 await page.waitForFunction(()=>window.__states.some(state=>state.status==='ready'&&state.position>.2),undefined,{timeout:15000})
 await page.evaluate(id=>window.vm.closeMpv(id),result.state.sessionId)
 await fs.writeFile('test-results/v060-package.json',JSON.stringify({date:new Date().toISOString(),executable,version:result.version,mpv:'TS playback confirmed from packaged resources'},null,2))
 console.log('PASS packaged v0.6.0 startup and bundled mpv TS playback')
}finally{await application.close()}
