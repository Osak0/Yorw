import {dialog} from 'electron'
import {writeFile,rename,unlink} from 'node:fs/promises'
import {resolve,relative,dirname,join,isAbsolute,sep,basename} from 'node:path'
import {realpath} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import type {Backend} from './backend'

const id=(value:unknown):string=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('INVALID_INPUT');return value}
export class Workspace {
 constructor(private backend:Backend,private location:string,private protectedRoot:string){}
 async info(){return {...await this.backend.request('/v1/workspace'),data_location:this.location}}
 catalog(){return this.backend.request('/v1/exports/catalog')}
 create(input:{note_ids:string[];topic_ids:string[]}){
  if(!input||!Array.isArray(input.note_ids)||!Array.isArray(input.topic_ids)||input.note_ids.length+input.topic_ids.length<1||input.note_ids.length+input.topic_ids.length>500)throw new Error('INVALID_INPUT')
  return this.backend.request('/v1/exports','POST',{note_ids:input.note_ids.map(id),topic_ids:input.topic_ids.map(id)})
 }
 async save(value:unknown){
  const identity=id(value)
  const chosen=await dialog.showSaveDialog({title:'导出已保存内容（非完整备份）',defaultPath:'Yorw-content.zip',filters:[{name:'ZIP 内容导出',extensions:['zip']}],properties:['showOverwriteConfirmation']})
  if(chosen.canceled||!chosen.filePath)return {cancelled:true}
  // Resolve directory junctions too. Never overwrite the live database, PDFs or secrets.
  const path=join(await realpath(dirname(resolve(chosen.filePath))),basename(chosen.filePath))
  for(const root of [this.location,this.protectedRoot]){
   const rel=relative(await realpath(root),path)
   if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)))throw new Error('EXPORT_DESTINATION_PROTECTED')
  }
  // Existing file symlinks are replaced by rename rather than followed.
  const bytes=await this.backend.readExport(identity)
  const temporary=join(dirname(path),`.yorw-export-${randomUUID()}.tmp`)
  try{await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,path)}
  finally{await unlink(temporary).catch(()=>{})}
  return {saved:true}
 }
}
