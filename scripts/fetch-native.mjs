import fs from 'node:fs/promises'
import { createWriteStream,createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
const pinned=JSON.parse(await fs.readFile('native/dependencies.json','utf8'))
await fs.mkdir('native/vendor',{recursive:true})
async function hash(file){const value=createHash('sha256');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex')}
for(const [dependency,destination]of [[pinned.ffmpeg,'native/vendor/ffmpeg.zip'],[pinned.json,'native/vendor/json.hpp']]){
  let current=null;try{current=await hash(destination)}catch{}
  if(current&&(!dependency.sha256||current===dependency.sha256)){console.log('Verified local dependency',destination);continue}
  const response=await fetch(dependency.url)
  if(!response.ok)throw Error(`Download failed: ${response.status} ${dependency.url}`)
  await pipeline(Readable.fromWeb(response.body),createWriteStream(destination+'.download'))
  if(dependency.sha256&&await hash(destination+'.download')!==dependency.sha256)throw Error('The upstream asset has changed. Use the archived dependency matching native/dependencies.json. A new binary requires a dependency update and codec regression tests.')
  await fs.rename(destination+'.download',destination)
  console.log('Downloaded and verified',destination)
}
await fs.writeFile('native/vendor/manifest.json',JSON.stringify(pinned.ffmpeg,null,2))
