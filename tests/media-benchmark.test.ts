import {it,expect} from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {NativeClient} from '../packages/platform/native'
it('1080p H.264 长 GOP 精确定位30次性能',async()=>{const root=path.resolve('.test-data/media-benchmark-'+randomUUID());await fs.mkdir(root,{recursive:true});const decoder=new NativeClient(path.resolve('native/bin/vm-media.exe'));try{const source=path.resolve('.test-data/1080p-h264.mp4');const meta=await decoder.call('open',{path:source});expect(meta.width).toBe(1920);const times:number[]=[];for(let i=0;i<30;i++){const requested=(i*137%760)/100;const output=path.join(root,`${i}.png`);const start=performance.now();const frame=await decoder.call('frame',{time:requested,step:0,output});const png=await sharp(output).rotate(frame.rotation).png().toBuffer();expect(png.length).toBeGreaterThan(1000);expect(frame.time).toBeLessThanOrEqual(requested+.001);times.push(performance.now()-start)}times.sort((a,b)=>a-b);const report={sample:'1920×1080 H.264、B帧、GOP=120、30fps、8秒',runs:30,p50Ms:+times[14]!.toFixed(1),p95Ms:+times[28]!.toFixed(1),maxMs:+times[29]!.toFixed(1),scope:'原生定位、解码、PNG持久化与Sharp快照归一化；不包含UI呈现。'};await fs.writeFile('test-results/media-performance.json',JSON.stringify(report,null,2));console.log(report)}finally{decoder.close()}},120000)
