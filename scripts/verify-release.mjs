import fs from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
const {version}=JSON.parse(await fs.readFile('package.json','utf8'))
const files=[`release/VideoManager-${version}-Windows-x64-Setup.exe`,'release/win-unpacked/VideoManager.exe','native/bin/vm-fs.exe','native/bin/vm-media.exe']
const records=[]
for(const file of files){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);records.push({file,bytes:(await fs.stat(file)).size,sha256:digest.digest('hex')})}
await fs.writeFile('release/SHA256SUMS.txt',records.map(row=>`${row.sha256}  ${row.file}`).join('\n')+'\n')
await fs.writeFile('release/artifacts.json',JSON.stringify({created:new Date().toISOString(),platform:'win32-x64',signed:false,artifacts:records},null,2))
console.log(JSON.stringify(records,null,2))
