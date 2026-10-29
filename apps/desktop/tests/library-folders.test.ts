import {expect,test} from 'vitest'
import {folderScope,folderPath,directDocuments} from '../src/renderer/LibraryDirectory'
test('folder scope includes descendants, excludes neighbors, and terminates for corrupt cycles',()=>{
 const f=[{id:'a',parent_id:null,name:'A',version:1},{id:'b',parent_id:'a',name:'B',version:1},{id:'c',parent_id:'b',name:'C',version:1},{id:'d',parent_id:null,name:'D',version:1}]
 expect([...folderScope(f,'a')]).toEqual(['a','b','c'])
 expect([...folderScope([...f,{id:'a',parent_id:'c',name:'A',version:1}],'a')]).toEqual(['a','b','c'])
})

import {clampDirectoryWidth} from '../src/renderer/DirectorySplitter'
test('root and folder browsing show only direct files and preserve ancestor order',()=>{
 const folders=[{id:'a',parent_id:null,name:'A',version:1},{id:'b',parent_id:'a',name:'B',version:1}]
 const docs=[{id:'root',folder_id:null},{id:'a-file',folder_id:'a'},{id:'b-file',folder_id:'b'}] as any
 expect(directDocuments(docs,'root').map(d=>d.id)).toEqual(['root'])
 expect(directDocuments(docs,'a').map(d=>d.id)).toEqual(['a-file'])
 expect(folderPath(folders,'b').map(f=>f.name)).toEqual(['A','B'])
 expect(folderPath([{...folders[0],parent_id:'b'},folders[1]],'b')).toHaveLength(2)
})
test('directory resizing protects both panes from extreme widths',()=>{
 expect(clampDirectoryWidth(10,1024)).toBe(200)
 expect(clampDirectoryWidth(9999,1024)).toBe(520)
 expect(clampDirectoryWidth(520,800)).toBe(420)
})
