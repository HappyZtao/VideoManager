import type { HostPlugin,PluginManifest,PluginSlot } from '../packages/plugin-sdk'
const definitions: [string,string,string,string,PluginSlot][]=[
 ['navigation-tree','目录树','按真实层级展开目录，快速返回常用位置','导航','navigation.presenter'],
 ['navigation-visual','可视化路径','沿封面路径浏览，展开节点切换同级目录','导航','navigation.presenter'],
 ['content-grid','封面网格','以大幅缩略图浏览图片、视频与文件夹集合','内容展示','content.layout'],
 ['content-list','详细列表','在紧凑列表中比较类型、大小和修改时间','内容展示','content.layout'],
 ['viewer-image','图片查看器','适应窗口、缩放、旋转与连续浏览','查看与播放','viewer.image'],
 ['viewer-video','视频播放器','本地播放、倍速、续播与全屏','查看与播放','viewer.video'],
 ['cover-local','本地封面优选','按清晰度和曝光选择候选；支持手动视频选帧','封面','cover.strategy'],
 ['organization','标签与收藏','批量整理内容，信息只保存在媒体库中','组织','organize.actions'],
 ['file-actions','文件管理','重命名、移动与系统回收站','文件操作','file.actions'],
 ['source-local','本地资源','连接磁盘、增量扫描与离线索引','资源','source.provider']
]
export const builtins:HostPlugin[]=definitions.map(([id,name,description,group,slot])=>{
 const manifest:PluginManifest={id:'builtin.'+id,name,description,group,slot,version:'1.0.0',hostApiVersion:'^1.0.0',platforms:['win32'],requires:['library.query'],configSchema:{type:'object',properties:slot==='content.layout'?{cardWidth:{type:'integer',minimum:160,maximum:320},fit:{type:'string',enum:['cover','contain']}}:{},additionalProperties:false},defaults:slot==='content.layout'?{cardWidth:224,fit:'cover'}:{}}
 return {manifest,setup(sdk,config){return sdk.register(slot,manifest.id,config)}}
})
