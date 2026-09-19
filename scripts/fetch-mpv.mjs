import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
const pinned=JSON.parse(await fs.readFile('native/mpv-dependency.json','utf8'))
const archive=path.resolve('native/vendor/mpv-'+pinned.version+'.7z'),destination=path.resolve('native/bin/mpv')
const digest=buffer=>createHash('sha256').update(buffer).digest('hex')
await fs.mkdir(path.dirname(archive),{recursive:true})
let bytes=await fs.readFile(archive).catch(()=>null)
if(!bytes||digest(bytes)!==pinned.sha256){console.log('Downloading pinned mpv build…');execFileSync('curl.exe',['--fail','--location','--max-time','180','--output',archive+'.download',pinned.url],{windowsHide:true,stdio:'pipe'});bytes=await fs.readFile(archive+'.download');if(digest(bytes)!==pinned.sha256)throw Error('mpv checksum mismatch');await fs.rename(archive+'.download',archive)}
await fs.mkdir(destination,{recursive:true})
execFileSync(path.resolve('node_modules/electron-winstaller/vendor/7z.exe'),['x',archive,'-o'+destination,'-y'],{windowsHide:true,stdio:'pipe'})
await fs.access(path.join(destination,'mpv.exe'))
for(const name of ['Copyright','LICENSE.GPL','LICENSE.LGPL']){
 const target=path.join(destination,name)
 try{await fs.access(target)}catch{execFileSync('curl.exe',['--fail','--location','--max-time','45','--output',target,'https://raw.githubusercontent.com/mpv-player/mpv/69e63f425a/'+name],{windowsHide:true,stdio:'pipe'})}
}
await fs.writeFile(path.join(destination,'source-manifest.json'),JSON.stringify(pinned,null,2))
console.log('Verified and extracted mpv '+pinned.version)
