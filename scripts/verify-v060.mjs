import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'

const base=path.resolve('.test-data/v060-'+Date.now()),source=path.join(base,'播放器回归'),child=path.join(source,'父目录','子目录'),data=path.join(base,'data')
await fs.mkdir(child,{recursive:true});await fs.mkdir('test-results',{recursive:true})
await fs.copyFile('.test-data/fixtures/色彩与节奏.mp4',path.join(child,'sample.mp4'))
const vendor=(await fs.readdir('native/vendor')).find(name=>name.startsWith('ffmpeg-')&&!name.endsWith('.zip'))
execFileSync(path.resolve('native/vendor',vendor,'bin/ffmpeg.exe'),['-hide_banner','-loglevel','error','-stream_loop','3','-i',path.join(child,'sample.mp4'),'-t','8','-c','copy','-f','mpegts',path.join(child,'sample.ts')],{windowsHide:true,stdio:'pipe'})
const application=await electron.launch({executablePath:path.resolve(process.env.VM_TEST_EXECUTABLE||'node_modules/electron/dist/electron.exe'),args:[...(process.env.VM_TEST_EXECUTABLE?[]:['.']),'--disable-gpu','--in-process-gpu'],env:{...process.env,VM_DATA_DIR:data,VM_TEST_HIDDEN:'1'},timeout:30000})
let page;const errors=[],results=[]
const report=name=>{results.push(name);console.log('PASS',name)}
async function api(method,...args){return page.evaluate(([method,args])=>window.vm[method](...args),[method,args])}
async function waitFor(check){const deadline=Date.now()+45000;while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Timed out')}
async function choose(name){await page.getByRole('button',{name:'设置与插件',exact:true}).click();await page.getByRole('button',{name:'功能插件',exact:true}).click();const radio=page.getByRole('radio',{name:new RegExp(name)});await radio.click();await waitFor(()=>radio.getAttribute('aria-checked').then(value=>value==='true'));await page.screenshot({path:'test-results/v060-players.png'});await page.getByRole('button',{name:'关闭',exact:true}).click()}
try{
 page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.vm)
 await application.evaluate(({dialog,shell},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});globalThis.__opened=[];shell.openPath=async file=>{globalThis.__opened.push(file);return ''}},source)
 const picked=await api('pickRoot'),root=await api('addRoot',picked.grant)
 await waitFor(async()=>{const state=(await api('bootstrap')).tasks.find(task=>task.kind==='scan'&&!['running','paused'].includes(task.state));if(state){assert.ok(['completed','completed-errors'].includes(state.state));console.log('Fixture scan:',state.state)}return state})
 const parent=(await api('children',root.entryId))[0],folder=(await api('children',parent.id))[0]
 await page.locator('.tree-target').filter({hasText:'父目录'}).first().click()
 const toggle=page.getByRole('button',{name:'折叠 父目录',exact:true});await toggle.waitFor();await toggle.click()
 await page.waitForTimeout(800)
 assert.equal(await page.getByRole('button',{name:'展开 父目录',exact:true}).getAttribute('aria-expanded'),'false')
 assert.equal(await page.locator('.tree-target').filter({hasText:'子目录'}).count(),0)
 assert.equal(await page.locator('.page-heading h1').innerText(),'父目录')
 await page.getByRole('button',{name:'展开 父目录',exact:true}).click();await page.locator('.tree-target').filter({hasText:'子目录'}).first().click()
 // A selected descendant must not force its ancestor back open after manual collapse.
 await page.getByRole('button',{name:'折叠 父目录',exact:true}).click();await page.waitForTimeout(700)
 assert.equal(await page.locator('.tree-target').filter({hasText:'子目录'}).count(),0)
 assert.equal(await page.locator('.page-heading h1').innerText(),'子目录')
 report('选中目录和祖先均可折叠，浏览位置保持不变')
 await choose('mpv')
 assert.equal((await api('plugins')).find(plugin=>plugin.slot==='viewer.video'&&plugin.enabled).id,'builtin.viewer-mpv')
 await page.evaluate(()=>{window.__mpvStates=[];window.vm.onEvent(event=>{if(event.topic==='mpv-state')window.__mpvStates.push(event.data)})})
 await page.getByRole('option',{name:'sample.ts',exact:true}).dblclick()
 await page.getByRole('heading',{name:'正在 mpv 窗口中播放',exact:true}).waitFor({timeout:25000})
 const playing=await waitFor(()=>page.evaluate(()=>window.__mpvStates.find(state=>state.status==='ready'&&state.position>.2)))
 await page.getByRole('button',{name:'暂停播放',exact:true}).click()
 await page.getByRole('button',{name:'继续播放',exact:true}).waitFor()
 await api('mpvControl',playing.sessionId,'seek',2)
 await api('mpvControl',playing.sessionId,'speed',1.5)
 await waitFor(()=>page.evaluate(()=>window.__mpvStates.some(state=>state.position>=1.9&&state.speed===1.5)))
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive())
 await page.screenshot({path:'test-results/v060-mpv.png',timeout:5000}).catch(()=>{})
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 await waitFor(async()=>{const state=await api('entry',playing.entryId);return state.playback>=1.9})
 report('mpv 实际播放 TS、暂停、定位、倍速及关闭后保存进度')
 await assert.rejects(api('mpvControl',playing.sessionId,'seek',1))
 const reopened=await api('startMpv',playing.entryId)
 await waitFor(()=>page.evaluate(sessionId=>window.__mpvStates.some(state=>state.sessionId===sessionId&&state.position>=1.9),reopened.sessionId))
 // An old component cleanup cannot close a newly opened player.
 await api('closeMpv',playing.sessionId);await api('mpvControl',reopened.sessionId,'toggle-pause');await api('closeMpv',reopened.sessionId)
 report('mpv 续播及旧会话隔离')
 await choose('系统默认应用')
 await page.getByRole('option',{name:'sample.ts',exact:true}).dblclick()
 assert.equal(await application.evaluate(()=>globalThis.__opened.at(-1)),path.join(child,'sample.ts'))
 assert.equal(await page.getByRole('heading',{name:'sample.ts',exact:true}).count(),0)
 report('系统默认应用按文件关联分发（测试替身，不启动用户应用）')
 await choose('Chromium')
 await page.getByRole('option',{name:'sample.mp4',exact:true}).dblclick()
 await page.waitForFunction(()=>document.querySelector('.viewer-stage video')?.readyState>=1)
 assert.equal(await page.locator('.mpv-playback').count(),0)
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 report('Chromium 内置视频播放入口保持可用')
 assert.deepEqual(errors,[])
}finally{
 await application.close()
 await fs.writeFile('test-results/v060-regression.json',JSON.stringify({date:new Date().toISOString(),base,results,errors},null,2))
}
