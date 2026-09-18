import {describe,it,expect} from 'vitest'
import {naturalKey,parseRange,validateName,compileQuery,safeRelative} from '../packages/domain'
import {querySchema} from '../packages/contracts'
describe('查询、路径与资源协议合同',()=>{
 it('名称按数字自然排序，且顺序确定',()=>{expect(['图20','图2','图10','图1'].sort((a,b)=>naturalKey(a)<naturalKey(b)?-1:1)).toEqual(['图1','图2','图10','图20'])})
 it('短中文和多个词按 AND 匹配，注入内容只作为绑定参数',()=>{const q=querySchema.parse({folderId:'folder',scope:'direct',text:'西湖 test\' OR 1=1'});const result=compileQuery(q);expect(result.where).toContain('e.parentId=?');expect(result.where).not.toContain('OR 1=1');expect(result.params).toContain('西湖');expect(result.params).toContain('1=1')})
 it('Windows 非法文件名与路径穿越被拒绝',()=>{for(const name of ['CON','NUL.txt','test.','x/y','..','COM1','a:b'])expect(()=>validateName(name)).toThrow();expect(validateName('杭州 2026.jpg')).toBe('杭州 2026.jpg');expect(safeRelative('../x')).toBe(false);expect(safeRelative('a/../../x')).toBe(false);expect(safeRelative('杭州/a.jpg')).toBe(true)})
 it('处理普通范围、开放范围、后缀范围和416',()=>{expect(parseRange('bytes=1-3',10)).toEqual({start:1,end:3,partial:true});expect(parseRange('bytes=3-',10)).toEqual({start:3,end:9,partial:true});expect(parseRange('bytes=-4',10)).toEqual({start:6,end:9,partial:true});expect(parseRange('bytes=0-100',10)?.end).toBe(9);for(const range of ['bytes=10-','bytes=5-2','bytes=0-1,4-5','bytes=-0','bytes=-'])expect(parseRange(range,10)).toBeNull();expect(parseRange(null,10)?.partial).toBe(false)})
})
