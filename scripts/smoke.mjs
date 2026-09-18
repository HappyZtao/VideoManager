import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
const folder=path.resolve('.test-data/smoke-'+Date.now());await fs.mkdir(folder,{recursive:true});await fs.mkdir('test-results',{recursive:true})
const application=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env:{...process.env,VM_DATA_DIR:folder,VM_TEST_HIDDEN:'1'},timeout:30000})
application.process().stderr.on('data',d=>process.stdout.write(d))
try{const page=await application.firstWindow();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));await page.waitForSelector('text=添加第一个资源目录',{timeout:20000});await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.waitForTimeout(350);console.log('Empty screen ready');console.log(await page.evaluate(()=>({bridge:!!window.vm,node:typeof window.require,body:document.body.innerText.slice(0,150)})));await page.screenshot({path:'test-results/empty.png'})}finally{await application.close()}
