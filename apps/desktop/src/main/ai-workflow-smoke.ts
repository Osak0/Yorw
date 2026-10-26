/** Real UI and private bridge with owned loopback models and synthetic PDFs. */
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {dialog,type BrowserWindow} from 'electron'
import {join,basename} from 'node:path'
import {writeFile,readFile} from 'node:fs/promises'
import type {Backend} from './backend'
import type {Providers} from './providers'

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const snapshot=async(window:BrowserWindow,path:string)=>{
 // A hidden smoke window can retain its previous composited frame even after
 // DOM assertions pass. Let rendering settle before preserving visual evidence.
 window.webContents.invalidate()
 await pause(500)
 await writeFile(path,(await window.webContents.capturePage()).toPNG())
}
const ui=(window:BrowserWindow,code:string)=>window.webContents.executeJavaScript(`(async()=>{
 const wait=async fn=>{const end=Date.now()+45000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('AI_UI_TIMEOUT:'+${JSON.stringify(code.slice(0,100))})}
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
 const input=(selector,value)=>{const el=document.querySelector(selector);if(!el)throw new Error('AI_CONTROL_MISSING:'+selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
 ${code}
})()`)

export async function runAiWorkflowSmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string,fault=false):Promise<boolean>{
 window.webContents.setBackgroundThrottling(false)
 const calls:{path:string;body:any}[]=[]
 const server=createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
  const body=JSON.parse(raw);calls.push({path:req.url??'',body})
  if(req.url?.endsWith('/embeddings')){
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:body.input.map((_text:string,index:number)=>({index,embedding:[1,0]}))}));return
  }
  const system=body.messages[0].content,data=JSON.parse(body.messages[1].content)
  let text:string
  if(system.includes('筛选器')){const parsed=JSON.parse(data.question);text=JSON.stringify({items:parsed.candidates.map((item:any)=>({id:item.id,sentence:0}))})}
  else if(system.includes('改写'))text=JSON.stringify({query:'English evidence'})
  else if(system.includes('Wiki 草稿助手'))text='# AI workflow Wiki\n\n'+data.evidence.map((source:any)=>`Evidence from ${source.kind} [${source.id}].`).join('\n\n')
  else text='English fixture evidence [S1].'
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  if(data.question.includes('interrupt-for-recovery')){res.write('data: '+JSON.stringify({choices:[{delta:{content:'Partial interrupted [S1].'}}]})+'\n\n');return}
  res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const save=dialog.showSaveDialog,open=dialog.showOpenDialog
 try{
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  for(const kind of ['chat','embedding'] as const){const old=(await providers.list()).find(c=>c.kind===kind);await providers.save({kind,version:old?.version??0,base_url:url,model:'local-workflow-fixture',key:`${kind}-workflow-key`})}
  const doc=(await backend.request('/v1/documents')).items[0]
  window.setContentSize(1440,1024)
  await ui(window,`document.querySelector('.search-toggle').click();await wait(()=>document.querySelector('[aria-label="文献内检索"]'));input('[aria-label="文献内检索"]','English evidence');await wait(()=>!button('搜索').disabled);button('搜索').click();await wait(()=>document.querySelectorAll('.search-hit').length>0)`)
 const search=await ui(window,`const items=[...document.querySelectorAll('.search-hit')];if(items.some(item=>item.querySelector('.search-snippet').textContent.length>220))throw new Error('LONG_SEARCH_RESULT');return {count:items.length,firstPage:Number(items[0].querySelector('small').textContent.match(/\\d+/)[0]),snippets:items.map(item=>item.querySelector('.search-snippet').textContent),checkboxes:document.querySelectorAll('.search-panel input[type=checkbox]').length,clamp:getComputedStyle(document.querySelector('.search-snippet')).webkitLineClamp}`)
  if(search.count>5||search.checkboxes||search.clamp!=='4')throw new Error('SEARCH_SIMPLIFICATION_FAILED')
  await ui(window,`document.querySelector('.search-hit button:last-child').click();await wait(()=>document.querySelector('.reader-feedback').textContent.includes('第 ${search.firstPage} 页'))`)
  await snapshot(window,join(reportDir,'ai-search.png'))
  await ui(window,`document.querySelector('.chat-toggle').click();await wait(()=>document.querySelector('[aria-label="研究问题"]'));input('[aria-label="研究问题"]','What is the English evidence?');await wait(()=>!button('发送').disabled);button('发送').click();await wait(()=>button('保存到笔记'));button('保存到笔记').click();await wait(()=>document.querySelector('.note-status')?.textContent.includes('已保存')||document.querySelector('.note-editor'))`)
  const first=(await backend.request(`/v1/documents/${doc.id}/chat`)).items[0]
  if(!first.note_id||!first.sources.length)throw new Error('AUTO_CHAT_NOTE_FAILED')
  await ui(window,`document.querySelector('.chat-toggle').click();await wait(()=>document.querySelector('[aria-label="研究问题"]'));input('[aria-label="研究问题"]','它是什么？');await wait(()=>!button('发送').disabled);button('发送').click();await wait(()=>document.querySelectorAll('.chat-panel article').length===2);await wait(()=>[...document.querySelectorAll('.chat-panel article')].every(item=>item.querySelector('button')?.textContent!=='取消生成'))`)
  const messages=(await backend.request(`/v1/documents/${doc.id}/chat`)).items
  for(let i=0;i<100&&messages[messages.length-1].status==='running';i++){await pause(100);Object.assign(messages[messages.length-1],(await backend.request(`/v1/documents/${doc.id}/chat`)).items.at(-1))}
  if(!messages.at(-1).context.history.length)throw new Error('FOLLOWUP_CONTEXT_MISSING')
  await snapshot(window,join(reportDir,'ai-chat.png'))
  const prior=await backend.request('/v1/topics','POST',{id:randomUUID(),title:'Prior English knowledge',parent_id:null})
  await backend.request(`/v1/topics/${prior.topic.id}/revisions`,'POST',{base_revision_id:prior.revision.id,body_md:'Prior English evidence synthesis.'})
  await ui(window,`document.querySelector('nav button:nth-child(2)').click();await wait(()=>document.querySelector('.garden-directory'));button('新建').click();await wait(()=>document.querySelector('[aria-label="新专题名称"]'));input('[aria-label="新专题名称"]','AI English synthesis');await wait(()=>!button('创建专题').disabled);button('创建专题').click();await wait(()=>document.querySelector('.topic-body-view h2')?.textContent==='AI English synthesis');button('AI 优化').click();await wait(()=>document.querySelector('[aria-label="Wiki 生成要求"]'));input('[aria-label="Wiki 生成要求"]','Summarize English evidence and prior findings');await wait(()=>!button('生成草稿').disabled);button('生成草稿').click();await new Promise(resolve=>setTimeout(resolve,50));document.querySelector('nav button:nth-child(2)').click();await wait(()=>document.querySelector('.garden-directory'));button('刷新').click();await wait(()=>document.querySelector('[data-topic-id="${prior.topic.id}"]'));document.querySelector('[data-topic-id="${prior.topic.id}"]').click();await wait(()=>document.querySelector('.topic-body-view .cm-content'));if(document.querySelector('.topic-body-view .cm-content').getAttribute('contenteditable')==='false')throw new Error('PARALLEL_TOPIC_NOT_EDITABLE');const aiTab=[...document.querySelectorAll('.workspace-tab')].find(tab=>tab.textContent.includes('AI English synthesis')&&tab.querySelector('.workspace-tab-kind')?.textContent==='AI 优化');aiTab.click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'))`)
  const topic=(await backend.request('/v1/topics')).items.find((item:any)=>item.title==='AI English synthesis'),tid=topic.id
  const initial=(await backend.request(`/v1/topics/${tid}/suggestions`)).items[0]
  if(initial.sources.some((source:any)=>source.source_object_id===tid)||!['document','note','wiki'].every(kind=>initial.sources.some((source:any)=>source.kind===kind)))throw new Error('AUTO_MATERIAL_SCOPE_FAILED')
  if((await backend.request(`/v1/topics/${tid}`)).revision.body_md!=='')throw new Error('DRAFT_SILENTLY_SAVED')
  const layouts=[]
  for(const [width,height] of [[1440,1024],[1024,768]]){
   window.setContentSize(width,height);await pause(500)
   await ui(window,`document.querySelector('[aria-label="确认后的正文"]').scrollIntoView({block:'center'})`)
   layouts.push(await window.webContents.executeJavaScript(`({width:innerWidth,fits:document.documentElement.scrollWidth<=innerWidth,confirmations:document.querySelectorAll('.wiki-review input[type=checkbox]').length})`))
   await snapshot(window,join(reportDir,`ai-draft-${width}.png`))
  }
  if(layouts.some(layout=>!layout.fits||layout.confirmations))throw new Error('DRAFT_LAYOUT_OR_CONFIRMATION_FAILED')
  window.setContentSize(1440,1024)
  await ui(window,`button('追加到正文').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'));input('[aria-label="Wiki 生成要求"]','Summarize English evidence again');await wait(()=>!button('生成草稿').disabled);button('生成草稿').click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'));input('[aria-label="确认后的正文"]','Appended fact [S1].');await wait(()=>document.querySelector('[aria-label="确认后的正文"]').value==='Appended fact [S1].');button('追加到正文').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'))`)
  const appended=await backend.request(`/v1/topics/${tid}`)
  if(!appended.revision.body_md.includes(`[S${initial.sources.length+1}]`)||!appended.revision.body_md.startsWith(initial.body_md))throw new Error('APPEND_CITATIONS_FAILED')
  const replacement='# Reviewed replacement\n\nReplacement [S1].'
  await ui(window,`input('[aria-label="Wiki 生成要求"]','Write concise English evidence');await wait(()=>!button('生成草稿').disabled);button('生成草稿').click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'));input('[aria-label="确认后的正文"]',${JSON.stringify(replacement)});await wait(()=>document.querySelector('[aria-label="确认后的正文"]').value.includes('Reviewed replacement'));button('替换正文').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'))`)
  let final=await backend.request(`/v1/topics/${tid}`)
  if(final.revision.body_md!=='# Reviewed replacement\n\nReplacement [S1].')throw new Error('REPLACE_FAILED')
  const replacementRevision=final.revision.id
  await ui(window,`button('返回正文').click();await wait(()=>document.querySelector('.topic-body-view .cm-content'));document.querySelector('.topic-body-view .cm-content').focus()`)
  await window.webContents.insertText('Manual edit for rollback. ')
  await ui(window,`await wait(()=>!button('保存').disabled);button('保存').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 5'));button('修订历史').click();await wait(()=>document.querySelector('[aria-label="历史修订"]'));const select=document.querySelector('[aria-label="历史修订"]');select.value='${replacementRevision}';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));button('比较并回退此修订').click();await wait(()=>button('确认回退为新修订'));button('确认回退为新修订').click();await wait(()=>document.querySelector('.topic-tool-view[aria-label="修订历史"]')?.textContent.includes('已回退为新修订'))`)
  final=await backend.request(`/v1/topics/${tid}`)
  if(final.revision.restored_from_id!==replacementRevision||final.revision.body_md!==replacement)throw new Error('AI_ROLLBACK_FAILED')
  await ui(window,`document.querySelector('nav button:nth-child(3)').click();await wait(()=>document.querySelector('[aria-label="语义检索"]')&&!document.querySelector('[aria-label="语义检索"]').disabled);if(!document.querySelector('[aria-label="语义检索"]').checked)throw new Error('SEMANTIC_DEFAULT_OFF');document.querySelector('[aria-label="语义检索"]').click();await wait(()=>!document.querySelector('[aria-label="语义检索"]').disabled)`)
  if((await backend.request('/v1/ai/preferences')).semantic_enabled)throw new Error('SETTING_NOT_SAVED')
  await ui(window,`await wait(()=>document.querySelectorAll('.export-choices input').length>=3);for(const label of document.querySelectorAll('.export-choices label'))if(label.textContent.includes('AI English synthesis')||label.textContent.includes('AI 讨论笔记'))label.querySelector('input').click();await wait(()=>!button('创建快照并导出 ZIP').disabled)`)
  const output=join(reportDir,'..',basename(reportDir)+'-ai-content.zip')
  dialog.showSaveDialog=(async()=>({canceled:false,filePath:output})) as typeof save
  await ui(window,`button('创建快照并导出 ZIP').click();await wait(()=>document.querySelector('.workspace-panel [role="status"]').textContent.includes('ZIP 已保存'))`)
  if((await readFile(output))[0]!==80)throw new Error('AI_EXPORT_FAILED')
  await ui(window,`document.querySelector('[aria-label="语义检索"]').scrollIntoView({block:'center'})`)
  await snapshot(window,join(reportDir,'ai-house.png'))
  await ui(window,`document.querySelector('nav button:first-child').click();button('返回文献库').click();await wait(()=>button('导入 PDF'))`)
  const names=['SyntheticStudyA.pdf','SyntheticStudyB.pdf','SyntheticStudyC.pdf','SyntheticStudyD.pdf','negative/encrypted.pdf','negative/no-text.pdf','negative/broken.pdf','fixture.pdf']
  for(const name of names){
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[join(reportDir,'fixtures',name)]})) as typeof open
   await ui(window,`await wait(()=>!button('导入 PDF').disabled);button('导入 PDF').click();await new Promise(r=>setTimeout(r,200));await wait(()=>!button('导入 PDF').disabled)`)
  }
  let documents:any[]=[]
  for(let i=0;i<200;i++){documents=(await backend.request('/v1/documents')).items;if(documents.length===8&&documents.every(item=>!['pending','running'].includes(item.extraction_status)))break;await pause(100)}
  if(documents.length!==8||documents.filter(item=>item.extraction_status==='ready').length!==5)throw new Error('AI_IMPORT_MATRIX_FAILED')
  if(documents.filter(item=>item.warning).map(item=>item.warning).sort().join(',')!==['ENCRYPTED_PDF','NO_TEXT_NO_OCR','PDF_PARSE_FAILED'].sort().join(','))throw new Error('AI_NEGATIVE_IMPORT_FAILED')
  const other=documents.find(item=>item.original_name==='SyntheticStudyB.pdf')
  const searchDoc=async(target:string)=>{
   const result=await window.webContents.executeJavaScript(`window.yorw.ai.run(${JSON.stringify({kind:'search',target_id:target,text:'survival',request_id:randomUUID()})})`)
   if(!result.ok)throw new Error('AI_SCOPE_SEARCH_SUBMISSION')
   for(let i=0;i<100;i++){const task=await backend.request('/v1/ai/tasks/'+result.value.id);if(task.status==='succeeded')return task.result;if(task.status==='failed')throw new Error('AI_SCOPE_SEARCH_FAILED');await pause(100)}
   throw new Error('AI_SCOPE_SEARCH_TIMEOUT')
  }
  if(!(await searchDoc(other.id)).items.length||(await searchDoc(doc.id)).items.length)throw new Error('AI_CROSS_DOCUMENT_LEAK')
  if(JSON.stringify(calls).includes('workflow-key'))throw new Error('KEY_IN_MODEL_PAYLOAD')
  const note=(await backend.request(`/v1/notes?document_id=${doc.id}`)).items.find((item:any)=>item.id===first.note_id)
  const state={document_id:doc.id,message_id:first.id,note_id:first.note_id,topic_id:tid,revision_id:final.revision.id,body_md:final.revision.body_md,note_body:note.body_md,last_page:(await backend.request(`/v1/documents/${doc.id}`)).last_page,source_kinds:final.revision.sources.map((source:any)=>source.kind),export_path:output,pending_id:null as string|null}
  await writeFile(join(reportDir,'ai-workflow-smoke.json'),JSON.stringify({result:'passed',search,followup:true,sourceKinds:initial.sources.map((source:any)=>source.kind),appendRenumbered:true,replace:true,rollback:true,settingsSaved:true,export:true,textDocuments:5,negativeDocuments:3,duplicateImport:true,crossDocumentScope:true,layouts,modelRequests:calls.length,cloudCalls:0},null,2))
  if(fault){
   const args={kind:'draft',target_id:tid,text:'English interrupt-for-recovery',base_revision_id:final.revision.id,request_id:randomUUID()}
   await window.webContents.executeJavaScript(`window.yorw.ai.run(${JSON.stringify(args)})`)
   for(let i=0;i<200;i++){
    const pending=(await backend.request(`/v1/topics/${tid}/suggestions`)).items.find((item:any)=>item.instruction==='English interrupt-for-recovery')
    if(pending?.body_md){state.pending_id=pending.id;break}await pause(100)
   }
   if(!state.pending_id)throw new Error('INFLIGHT_DRAFT_NOT_CREATED')
   if(!backend.processId)throw new Error('BACKEND_PROCESS_MISSING')
   process.kill(backend.processId)
   await ui(window,`await wait(()=>document.querySelector('.app-status.failed')?.textContent.includes('本地服务已退出')||document.body.textContent.includes('本地服务已退出'))`)
  }
  await writeFile(join(reportDir,'ai-state.json'),JSON.stringify(state,null,2))
  return fault
 }finally{dialog.showSaveDialog=save;dialog.showOpenDialog=open;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}

export async function resumeAiWorkflowSmoke(window:BrowserWindow,backend:Backend,reportDir:string){
 window.webContents.setBackgroundThrottling(false)
 const state=JSON.parse(await readFile(join(reportDir,'ai-state.json'),'utf8'))
 const wiki=await backend.request(`/v1/topics/${state.topic_id}`),doc=await backend.request(`/v1/documents/${state.document_id}`)
 const note=(await backend.request(`/v1/notes?document_id=${state.document_id}`)).items.find((item:any)=>item.id===state.note_id)
 const pending=(await backend.request(`/v1/topics/${state.topic_id}/suggestions`)).items.find((item:any)=>item.id===state.pending_id)
 if(wiki.revision.id!==state.revision_id||wiki.revision.body_md!==state.body_md||note.body_md!==state.note_body||doc.last_page!==state.last_page)throw new Error('AI_RESTART_CONTENT_LOST')
 if(state.pending_id&&(pending?.status!=='interrupted'||!pending.body_md))throw new Error('AI_INTERRUPTION_NOT_PRESERVED')
 if((await backend.request('/v1/ai/preferences')).semantic_enabled)throw new Error('AI_PREFERENCE_NOT_PERSISTED')
 await ui(window,`document.querySelector('nav button:nth-child(2)').click();await wait(()=>document.querySelector('[data-topic-id="${state.topic_id}"]'));document.querySelector('[data-topic-id="${state.topic_id}"]').click();await wait(()=>document.querySelector('.topic-body-view .cm-content')?.textContent.includes('Reviewed replacement'))`)
 await writeFile(join(reportDir,'ai-restart.json'),JSON.stringify({result:'passed',wiki:true,note:true,readingPage:true,preferences:true,pendingStatus:pending?.status??null,noAutomaticRetry:true},null,2))
 await snapshot(window,join(reportDir,'ai-resumed.png'))
}
