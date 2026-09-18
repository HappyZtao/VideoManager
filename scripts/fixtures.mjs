import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
const directory=path.resolve('.test-data/fixtures')
await fs.mkdir(directory,{recursive:true})
const palettes=[['#183e45','#86b7a4','#edbf77'],['#24364a','#94acb5','#dcbc95'],['#66585b','#ca9586','#f3ce9f'],['#233c50','#799eac','#e4cab0'],['#697360','#a9b8a0','#e6dbc4'],['#353951','#9c98b8','#ebbf9f']]
const folders=['山野与远行','城市漫游','海边的日常','视频素材','空文件夹']
for(const folder of folders)await fs.mkdir(path.join(directory,folder),{recursive:true})
await fs.mkdir(path.join(directory,'山野与远行','山间清晨'),{recursive:true})
for(let i=0;i<36;i++){
 const [dark,mid,light]=palettes[i%palettes.length];const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${mid}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs><rect width="960" height="600" fill="url(#sky)"/><circle cx="${180+(i*37)%500}" cy="${100+i%6*16}" r="58" fill="${light}"/><path d="M0 380L180 ${210+i%4*35}L390 370L660 ${160+i%6*20}L960 340V600H0Z" fill="${mid}"/><path d="M0 490L270 350L570 480L820 330L960 410V600H0Z" fill="${dark}"/><path d="M0 540Q260 470 510 540T960 520V600H0" fill="${dark}" opacity=".6"/></svg>`
 const folder=i<16?directory:path.join(directory,folders[(i-16)%4]);const names=['雾中的山谷','日落之前','沿海公路','静谧的午后','远山与湖','城市的边缘'];const stem=names[i%6]+' '+String(i+1).padStart(2,'0');await sharp(Buffer.from(svg)).jpeg({quality:87}).toFile(path.join(folder,stem+'.jpg'))
}
await sharp({create:{width:1280,height:800,channels:3,background:'#29645b'}}).png().toFile(path.join(directory,'山野与远行','山间清晨','西湖 中文图片.png'))
await sharp({create:{width:200,height:300,channels:4,background:'#9299bb'}}).webp().toFile(path.join(directory,'portrait.webp'))
await fs.writeFile(path.join(directory,'说明.txt'),'测试创建的非媒体文件。')
await fs.writeFile(path.join(directory,'损坏的视频.mp4'),'intentional corrupt test fixture')
const encoder=process.env.VM_TEST_FFMPEG||'D:\\LosslessCut-win-x64\\resources\\ffmpeg.exe'
const run=args=>{const result=spawnSync(encoder,['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr)}
run(['-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-bf','3','-g','48','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(directory,'色彩与节奏.mp4')])
run(['-f','lavfi','-i','testsrc2=size=480x270:rate=30:duration=3','-vf',"select='not(mod(n,3))+not(mod(n,7))'",'-fps_mode','vfr','-c:v','libx264','-bf','3','-pix_fmt','yuv420p',path.join(directory,'视频素材','变帧率 VFR.mp4')])
run(['-f','lavfi','-i','testsrc2=size=480x270:rate=25:duration=2','-f','lavfi','-i','sine=frequency=660:duration=2','-c:v','libvpx-vp9','-c:a','libopus',path.join(directory,'视频素材','WebM VP9.webm')])
run(['-f','lavfi','-i','color=c=teal:size=320x240','-frames:v','1',path.join(directory,'BMP 样本.bmp')])
run(['-f','lavfi','-i','testsrc2=size=180x120:rate=8:duration=1',path.join(directory,'动态 GIF.gif')])
console.log(directory)
