import {vi,expect,test} from 'vitest'
vi.mock('electron',()=>({dialog:{showOpenDialog:vi.fn(),showMessageBox:vi.fn()}}))
import {dialog} from 'electron'
import {Parsers} from '../src/main/parsers'
import type {Backend} from '../src/main/backend'
const settings={enhanced_enabled:true,ocr_enabled:true,version:1,docling_executable:'C:/Tools/python.exe',docling_prefix:['-m','docling'],libreoffice_executable:'',timeout_seconds:60,ocr_mode:'default',ocr_engine:'auto'}
test('renderer paths and code arguments require native selection and confirmation',async()=>{
 const request=vi.fn(async()=>({}))
 const parsers=new Parsers({request} as unknown as Backend)
 expect(()=>parsers.save(settings)).toThrow('COMPONENT_APPROVAL_REQUIRED')
 expect(request).not.toHaveBeenCalled()
 vi.mocked(dialog.showOpenDialog).mockResolvedValue({canceled:false,filePaths:['C:/Tools/python.exe']})
 vi.mocked(dialog.showMessageBox).mockResolvedValue({response:1,checkboxChecked:false})
 await parsers.choose('docling')
 expect(()=>parsers.save({...settings,docling_prefix:['-c','print(1)']})).toThrow('INVALID_INPUT')
 await parsers.save(settings)
 expect(request).toHaveBeenCalledWith('/v1/parsers','PUT',expect.objectContaining({approved:true,docling_prefix:['-m','docling']}))
})
test('cancelled native confirmation never approves a component',async()=>{
 const request=vi.fn(async()=>({})),parsers=new Parsers({request} as unknown as Backend)
 vi.mocked(dialog.showOpenDialog).mockResolvedValue({canceled:false,filePaths:['C:/Tools/python.exe']})
 vi.mocked(dialog.showMessageBox).mockResolvedValue({response:0,checkboxChecked:false})
 expect(await parsers.choose('docling')).toEqual({cancelled:true})
 expect(()=>parsers.save(settings)).toThrow('COMPONENT_APPROVAL_REQUIRED')
})

test('restart restores unchanged approved programs and rejects replaced binaries',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const directory=await mkdtemp(join(tmpdir(),'yorw-parser-approval-'))
 try{
  const program=join(directory,'python.exe'),approval=join(directory,'approved.json')
  await writeFile(program,'version-one')
  const current={...settings,docling_executable:program,singleton:1}
  const request=vi.fn(async()=>({settings:current}))
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({canceled:false,filePaths:[program]})
  vi.mocked(dialog.showMessageBox).mockResolvedValue({response:1,checkboxChecked:false})
  await new Parsers({request} as unknown as Backend,approval).choose('docling')
  request.mockClear()
  await new Parsers({request} as unknown as Backend,approval).status()
  expect(request).toHaveBeenCalledWith('/v1/parsers/approve','POST',expect.objectContaining({docling_executable:program}))
  await writeFile(program,'version-two')
  request.mockClear()
  await new Parsers({request} as unknown as Backend,approval).status()
  expect(request).toHaveBeenCalledTimes(1)
 }finally{await rm(directory,{recursive:true,force:true})}
})
