import {_electron as electron} from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const record=JSON.parse((await fs.readFile('test-results/install-smoke.json','utf8')).replace(/^\uFEFF/,''));const directory=path.resolve(record.Directory)
assert(directory.startsWith(path.resolve('.test-data')+path.sep));assert.equal(record.ExitCode,0);assert(record.ExecutableExists)
const application=await electron.launch({executablePath:path.join(directory,'VideoManager.exe'),args:[],env:{...process.env,VM_DATA_DIR:path.join(directory,'smoke-user-data'),VM_TEST_HIDDEN:'1'}})
try{const page=await application.firstWindow();await page.getByRole('button',{name:'添加第一个资源目录',exact:true}).waitFor();const details=await page.evaluate(async()=>({nodeAccess:typeof window.require,version:(await window.vm.bootstrap()).version}));assert.equal(details.nodeAccess,'undefined');assert.equal(details.version,'0.1.0');record.Launched=true;record.Runtime=details;console.log('Installed application launches with sandbox and correct version')}finally{await application.close();await fs.writeFile('test-results/install-smoke.json',JSON.stringify(record,null,2))}
