import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Explicit live opt-in only. Owned fixtures, isolated profile, no user library. */
export async function runLiveResearchSmoke(window:BrowserWindow,backend:Backend,profileId:string,folder:string){
 const names=['决算单.docx','决算单副本.docx','球票发票.pdf','奖牌发票.pdf']
 await backend.request('/v1/library-folders','POST',{name:'新生杯'})
 const directory=(await backend.request('/v1/library-folders')).items.find((item:any)=>item.name==='新生杯')
 const versions:Record<string,number>={}
 for(let index=0;index<names.length;index++){
  const original=await readFile(join(folder,index<2?'fixture.docx':'fixture.pdf'))
  const bytes=Buffer.concat([original,Buffer.from(index<2?'\0'.repeat(index):`\n% owned-live-${index}`)])
  const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)]),names[index])
  const imported=await backend.request('/v1/documents/import','POST',form)
  let ready=false
  for(let attempt=0;attempt<150;attempt++){const document=await backend.request('/v1/documents/'+imported.document.id);if(document.extraction_status==='ready'){versions[document.id]=document.version;ready=true;break}await new Promise(r=>setTimeout(r,100))}
  if(!ready)throw new Error('LIVE_FIXTURE_PARSE')
 }
 await backend.request('/v1/library-folder-assignment','POST',{folder_id:directory.id,documents:versions})
 const preferences=await backend.request('/v1/research-memory/preferences')
 await backend.request('/v1/research-memory/preferences','PUT',{...preferences,enabled:false})
 const result=await window.webContents.executeJavaScript(`(async()=>{
  const profile=${JSON.stringify(profileId)}
  const finish=async sid=>{for(let i=0;i<1900;i++){const r=await window.yorw.research.get({id:sid});const task=r.value.items.at(-1);if(task&&task.status!=='running')return task;await new Promise(r=>setTimeout(r,100))}throw new Error('LIVE_BUSINESS_TIMEOUT')}
  const start=await window.yorw.research.ask({scope:{mode:'workspace'},profile_id:profile,request_id:crypto.randomUUID(),question:'请查找 Storage 中名为新生杯的文件夹，浏览完全部分页并列出四份文件。请创建一个同名专题的待采纳方案，并推荐把该目录的四份材料全部关联到新专题；关联项标为推荐，依据仅为目录归属，不推断金额或正文事实。创建专题与四条关联放在同一个方案里。'})
  if(!start.ok)throw new Error('LIVE_START_'+start.code)
  const task=await finish(start.value.session_id)
  const summary={status:task.status,error:task.error_code,body:task.body_md,usage:task.usage,tools:task.tool_calls.map(call=>({name:call.tool_name??call.name,status:call.status,error:call.error,result:call.result_summary}))}
  const listed=await window.yorw.collaboration.list({task_id:task.id})
  if(task.status!=='completed'||!listed.ok||!listed.value.items.length)return {passed:false,first:summary}
  const item=(await window.yorw.collaboration.get(listed.value.items[0].id)).value
  const creation=item.operations.find(op=>op.action==='create_topic')
  const links=item.operations.filter(op=>op.action==='link')
  if(!creation||links.length!==4)return {passed:false,first:summary,operations:item.operations}
  const accepted=await window.yorw.collaboration.decide({id:item.id,version:item.version,request_id:crypto.randomUUID(),action:'accept',selected:[creation.key,...links.slice(0,2).map(op=>op.key)]})
  if(!accepted.ok)throw new Error('LIVE_ACCEPT_'+accepted.code)
  const follow=await window.yorw.research.ask({session_id:start.value.session_id,scope:{mode:'workspace'},profile_id:profile,request_id:crypto.randomUUID(),question:'我刚才已采纳创建专题和两条材料关联。请先核对当前方案状态和采纳记录，告诉我实际创建了什么、关联了几份，以及剩余材料是否已经关联；不要生成新方案。'})
  if(!follow.ok)throw new Error('LIVE_FOLLOW_'+follow.code)
  const reply=await finish(start.value.session_id)
  return {passed:reply.status==='completed',first:summary,proposal:{id:item.id,operations:item.operations.map(op=>({key:op.key,action:op.action,recommended:op.recommended}))},adoption:accepted.value.decision,followup:{status:reply.status,body:reply.body_md,usage:reply.usage,tools:reply.tool_calls}}
 })()`)
 await writeFile(join(folder,'live-research-business.json'),JSON.stringify(result,null,2))
 if(!result.passed)throw new Error('LIVE_BUSINESS_FAILED')
 return result
}
