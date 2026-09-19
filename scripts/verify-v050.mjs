import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {createHash} from 'node:crypto'

const base=path.resolve('.test-data/v050-'+Date.now()),source=path.join(base,'回归媒体'),userData=path.join(base,'data')
await fs.mkdir(source,{recursive:true});await fs.mkdir('test-results',{recursive:true})
const pixels=Buffer.alloc(1280*800*3)
for(let i=0;i<pixels.length;i++)pixels[i]=(i*13+(i>>11))%256
const sample=await sharp(pixels,{raw:{width:1280,height:800,channels:3}}).png().toBuffer()
const alternate=await sharp(sample).negate().png().toBuffer()
for(let i=0;i<8;i++){const folder=path.join(source,'目录'+i,'子目录');await fs.mkdir(folder,{recursive:true});for(let j=0;j<4;j++)await fs.writeFile(path.join(folder,j+'.png'),j===1?alternate:sample)}
await fs.copyFile('.test-data/fixtures/色彩与节奏.mp4',path.join(source,'目录0','子目录','video.mp4'))
const app=await electron.launch({executablePath:path.resolve(process.env.VM_TEST_EXECUTABLE||'node_modules/electron/dist/electron.exe'),args:[...(process.env.VM_TEST_EXECUTABLE?[]:['.']),'--disable-gpu','--in-process-gpu'],env:{...process.env,VM_DATA_DIR:userData,VM_TEST_HIDDEN:'1'},timeout:30000})
const results=[],errors=[];let page
const report=(name,data={})=>{results.push({name,...data});console.log('PASS',name,JSON.stringify(data))}
async function api(method,...args){return page.evaluate(([method,args])=>window.vm[method](...args),[method,args])}
async function waitFor(fn){const end=Date.now()+90000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Timed out')}
async function dimensions(id){const url=await api('media',id,'thumbnail');return page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight}},url)}
try{
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.vm)
 assert.equal((await api('bootstrap')).version,'0.5.0')
 await api('settings',{indexConcurrency:4,coverConcurrency:4})
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]})},source)
 const choice=await api('pickRoot'),start=performance.now(),root=await api('addRoot',choice.grant)
 const completed=await waitFor(async()=>{const b=await api('bootstrap');return b.tasks.find(t=>t.kind==='scan'&&!['running','paused'].includes(t.state))})
 assert.equal(completed.state,'completed');assert.equal(completed.failed,0);assert.equal(completed.discovered,49)
 report('4 路索引与封面完成，计数无遗漏',{elapsedMs:Math.round(performance.now()-start),processed:completed.processed})
 const parent=(await api('children',root.entryId)).find(e=>e.name==='目录0'),child=(await api('children',parent.id))[0]
 const q=await api('openQuery',{folderId:child.id,scope:'direct'}),entries=(await api('page',q.id,0,100)).entries
 const image=entries.find(e=>e.name==='1.png'),video=entries.find(e=>e.kind==='video')
 assert.equal((await dimensions(image.id)).width,768)
 assert.equal((await dimensions(parent.id)).width,768)
 report('默认预览实际为 768px，不再二次缩成 240px')
 // Changing quality generates a separately keyed preview; no manual cache purge.
 await api('settings',{coverQuality:'high'})
 assert.equal((await dimensions(image.id)).width,1280)
 assert.equal((await dimensions(parent.id)).width,1280)
 await assert.rejects(api('settings',{coverQuality:'invalid'}))
 const handle=await api('coverSource',image.id),frame=await api('frame',handle.handle,0,0,1)
 const saved=await api('saveCover',video.id,frame.token,{mode:'cover',x:.5,y:.5,zoom:1},(await api('entry',video.id)).coverRevision,'high')
 for(const id of [child.id,parent.id,root.entryId])assert.equal((await api('entry',id)).coverHash,saved.coverHash)
 const coverStart=performance.now();assert.equal((await dimensions(parent.id)).width,1280)
 await api('closeSource',handle.handle)
 report('子项封面立即传递到父级和祖父级',{ancestorPreviewMs:Math.round(performance.now()-coverStart)})
 // Compare the decoded WebP with the saved PNG to verify the preview is lossless.
 const library=(await api('bootstrap')).libraryId,cache=path.join(userData,'libraries',library,'cache')
 const updatedParent=await api('entry',parent.id)
 const preview=`thumb-v2-${parent.id}-${updatedParent.revision}-${updatedParent.coverRevision}-1280.webp`
 const actual=await sharp(path.join(cache,preview)).raw().toBuffer(),original=await sharp(path.join(cache,saved.coverHash+'.png')).raw().toBuffer()
 assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(original).digest('hex'));report('封面 WebP 与 PNG 解码像素一致')
 await page.locator('.tree-target').filter({hasText:'回归媒体'}).first().click()
 await page.locator('.tree-target').filter({hasText:'目录0'}).first().waitFor()
 await page.waitForTimeout(1100)
 await page.evaluate(()=>{window.__treeNode=document.querySelector('.tree-line');window.__changes=[];window.vm.onEvent(event=>{if(event.topic==='changed')window.__changes.push(event)})})
 await page.locator('.tree-target').filter({hasText:'目录0'}).first().click()
 await page.waitForTimeout(1200)
 assert.equal(await page.evaluate(()=>window.__treeNode.isConnected),true)
 assert.equal(await page.evaluate(()=>window.__changes.length),0)
 report('导航自动保存不触发全局刷新，原目录节点保持挂载')
 await page.getByRole('button',{name:'设置与插件',exact:true}).click()
 await page.getByRole('button',{name:'媒体库与资源',exact:true}).click()
 assert.deepEqual(await page.getByLabel('默认封面分辨率',{exact:true}).locator('option').evaluateAll(items=>items.map(item=>item.value)),['original','high','balanced','fast','compact'])
 assert.equal(await page.getByLabel('默认封面分辨率',{exact:true}).inputValue(),'high')
 await page.screenshot({path:'test-results/v050-settings.png'})
 report('默认分辨率设置持久化，选项从高到低排列')
 assert.deepEqual(errors,[])
}finally{
 await app.close()
 await fs.writeFile('test-results/v050-regression.json',JSON.stringify({date:new Date().toISOString(),base,results,errors},null,2))
}
