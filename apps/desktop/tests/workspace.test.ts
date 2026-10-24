import {expect,test,vi} from 'vitest'
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Workspace} from '../src/main/workspace'
import type {Backend} from '../src/main/backend'
const native=vi.hoisted(()=>({showSaveDialog:vi.fn()}))
vi.mock('electron',()=>({dialog:native}))
const id='12345678-1234-1234-1234-123456789abc'

test('export uses native save destination, cancellation never downloads, and protects app data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'yorw-export-'))
 try{
  const data=join(root,'app');await mkdir(join(data,'workspace'),{recursive:true})
  const request=vi.fn(async()=>({workspace_id:id,schema_version:9})),readExport=vi.fn(async()=>new Uint8Array([80,75,3,4]))
  const workspace=new Workspace({request,readExport} as unknown as Backend,join(data,'workspace'),data)
  expect(await workspace.info()).toMatchObject({data_location:join(data,'workspace'),schema_version:9})
  native.showSaveDialog.mockResolvedValueOnce({canceled:true});expect(await workspace.save(id)).toEqual({cancelled:true});expect(readExport).not.toHaveBeenCalled()
  native.showSaveDialog.mockResolvedValueOnce({canceled:false,filePath:join(data,'workspace','yorw.sqlite3')})
  await expect(workspace.save(id)).rejects.toThrow('EXPORT_DESTINATION_PROTECTED');expect(readExport).not.toHaveBeenCalled()
  await mkdir(join(data,'..local'))
  native.showSaveDialog.mockResolvedValueOnce({canceled:false,filePath:join(data,'..local','data.zip')})
  await expect(workspace.save(id)).rejects.toThrow('EXPORT_DESTINATION_PROTECTED');expect(readExport).not.toHaveBeenCalled()
  const output=join(root,'saved.zip');native.showSaveDialog.mockResolvedValueOnce({canceled:false,filePath:output})
  expect(await workspace.save(id)).toEqual({saved:true});expect([...await readFile(output)]).toEqual([80,75,3,4])
  expect(()=>workspace.create({note_ids:['../escape'],topic_ids:[]})).toThrow('INVALID_INPUT')
  expect(()=>workspace.create({note_ids:[],topic_ids:[]})).toThrow('INVALID_INPUT')
 }finally{await rm(root,{recursive:true,force:true})}
})
