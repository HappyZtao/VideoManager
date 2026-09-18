import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
const run=spawnSync(path.resolve('node_modules/electron/dist/electron.exe'),['-p','JSON.stringify(process.versions)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,encoding:'utf8'})
if(run.status!==0)throw Error(run.stderr)
const pkg=JSON.parse(await fs.readFile('package.json','utf8')),native=JSON.parse(await fs.readFile('native/dependencies.json','utf8'))
const db=new Database(':memory:');const sqlite=db.prepare('SELECT sqlite_version() AS version').get().version;db.close()
await fs.writeFile('docs/versions.json',JSON.stringify({recorded:new Date().toISOString(),app:pkg.version,platform:os.platform(),osRelease:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3),buildNode:process.version,electronRuntime:JSON.parse(run.stdout),sqlite,compiler:'MinGW-w64 GCC 11.2.0 (C++17)',dependencies:pkg.dependencies,devDependencies:pkg.devDependencies,native},null,2))
console.log('Recorded docs/versions.json')
