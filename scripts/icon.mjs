import sharp from 'sharp'
import fs from 'node:fs/promises'
await fs.mkdir('build',{recursive:true})
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="62" fill="#14232a"/><path d="M61 70h37l31 84 31-84h35l-49 120h-35z" fill="#73d7bf"/><circle cx="191" cy="182" r="12" fill="#73d7bf"/></svg>'
await fs.writeFile('build/icon.svg',svg)
const png=await sharp(Buffer.from(svg)).png().toBuffer();await fs.writeFile('build/icon.png',png)
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);await fs.writeFile('build/icon.ico',Buffer.concat([header,png]))
