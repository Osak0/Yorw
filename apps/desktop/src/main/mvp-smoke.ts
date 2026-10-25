/** One continuous, isolated, local-fixture workflow plus process-death recovery. */
import {createServer} from 'node:http'
import {dialog,type BrowserWindow} from 'electron'
import {randomUUID} from 'node:crypto'
import {join,basename} from 'node:path'
import {writeFile,readFile} from 'node:fs/promises'
import type {Backend} from './backend'
import type {Providers} from './providers'
import {runChatSmoke} from './chat-smoke'

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const ui=(window:BrowserWindow,code:string)=>window.webContents.executeJavaScript(`(async()=>{
 const wait=async predicate=>{const end=Date.now()+25000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,100))}throw new Error('MVP_UI_TIMEOUT:'+${JSON.stringify(code.slice(0,90))})}
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
 const input=(selector,value)=>{const el=document.querySelector(selector);if(!el)throw new Error('MVP_CONTROL_MISSING:'+selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
 ${code}
})()`)

export async function runMvpSmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string):Promise<boolean>{
 // All cloud calls below point to disposable loopback providers with synthetic keys.
 await runChatSmoke(window,providers,reportDir)
 const document=(await backend.request('/v1/documents')).items[0]
 const message=(await backend.request(`/v1/documents/${document.id}/chat`)).items[0]
 const note=(await backend.request(`/v1/notes?document_id=${document.id}`)).items.find((n:any)=>n.id===message.note_id)
 if(!note||!note.sources.length)throw new Error('CHAT_NOTE_CHAIN_MISSING')
 const payloads:unknown[]=[]
 const server=createServer((request,response)=>{
  let raw='';request.on('data',b=>raw+=b);request.on('end',()=>{
   const payload=JSON.parse(raw);payloads.push(payload)
   response.writeHead(200,{'Content-Type':'text/event-stream'})
   if(payload.messages[1].content.includes('interrupt-for-recovery')){
    response.write('data: '+JSON.stringify({choices:[{delta:{content:'Partial interrupted fixture [S1]'}}]})+'\n\n');return
   }
   response.end('data: '+JSON.stringify({choices:[{delta:{content:'# MVP Wiki\n\n原文事实 [S1]。用户笔记观点 [S2]。模型讨论推断 [S3]。'}}]})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const originalSave=dialog.showSaveDialog,originalOpen=dialog.showOpenDialog
 try{
  const config=(await providers.list()).find(c=>c.kind==='chat')!
  await providers.save({kind:'chat',version:config.version,base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:'local-mvp-protocol-fixture',key:'local-mvp-key'})
  await ui(window,`document.querySelector('nav button:nth-child(2)').click();await wait(()=>document.querySelector('[aria-label="新专题名称"]'));input('[aria-label="新专题名称"]','MVP continuous workflow');await wait(()=>!button('创建专题').disabled);button('创建专题').click();await wait(()=>document.querySelector('.garden-editor h2')?.textContent==='MVP continuous workflow');button('材料与 AI 草稿').click();await wait(()=>document.querySelector('[aria-label="选材论文"] option[value="${document.id}"]'));document.querySelectorAll('.wiki-suggestions>details').forEach(d=>d.open=true);const select=document.querySelector('[aria-label="选材论文"]');select.value='${document.id}';select.dispatchEvent(new Event('change',{bubbles:true}));input('[aria-label="选材检索条件"]','fixed English');await wait(()=>!button('检索选材片段').disabled);button('检索选材片段').click();await wait(()=>document.querySelector('.material-choice input'));document.querySelector('.material-choice input').click();await wait(()=>[...document.querySelectorAll('.wiki-suggestions label')].some(l=>l.textContent.startsWith('用户笔记：')));for(const label of document.querySelectorAll('.wiki-suggestions label'))if(label.textContent.startsWith('用户笔记：')||label.textContent.startsWith('模型对话：'))label.querySelector('input').click();await wait(()=>!button('预览发送材料').disabled);button('预览发送材料').click();await wait(()=>document.querySelectorAll('.material-preview .suggestion-sources>details').length===3);const consent=[...document.querySelectorAll('.material-preview label')].find(l=>l.textContent.includes('确认发送'));consent.querySelector('input').click();await wait(()=>!button('生成建议草稿').disabled);button('生成建议草稿').click();await wait(()=>button('比较与处理建议'));document.querySelector('.suggestion-record').open=true;button('比较与处理建议').click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'));`)
  const topic=(await backend.request('/v1/topics')).items.find((t:any)=>t.title==='MVP continuous workflow')
  const suggestion=(await backend.request(`/v1/topics/${topic.id}/suggestions`)).items[0]
  if(suggestion.sources.map((s:any)=>s.kind).join(',')!=='document,note,message'||suggestion.sources[1].source_object_id!==note.id||suggestion.sources[2].source_object_id!==message.id)throw new Error('WIKI_MATERIAL_CHAIN_BROKEN')
  await ui(window,`document.querySelector('.wiki-review input[type="checkbox"]').click();await wait(()=>!button('确认采纳并保存修订').disabled);button('确认采纳并保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 2'));document.querySelector('.garden-editor .cm-content').focus()`)
  const accepted=await backend.request(`/v1/topics/${topic.id}`)
  await window.webContents.insertText('\n\n人工补充：仍需核查证据。')
  await ui(window,`await wait(()=>!button('保存修订').disabled);button('保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 3'));button('查看修订历史').click();await wait(()=>document.querySelector('[aria-label="历史修订"]'));const select=document.querySelector('[aria-label="历史修订"]');select.value='${accepted.revision.id}';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));button('比较并回退此修订').click();await wait(()=>button('确认回退为新修订'));button('确认回退为新修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 4'));`)
  const final=await backend.request(`/v1/topics/${topic.id}`)
  if(final.revision.body_md!==accepted.revision.body_md||final.revision.sources.length!==3)throw new Error('RESTORED_SOURCE_CHAIN_BROKEN')
  await ui(window,`document.querySelector('.garden-history').scrollIntoView({block:'center'})`)
  await writeFile(join(reportDir,'mvp-garden.png'),(await window.webContents.capturePage()).toPNG())
  await ui(window,`document.querySelector('nav button:nth-child(3)').click();await wait(()=>document.querySelectorAll('.export-choices input').length>=2);for(const label of document.querySelectorAll('.export-choices label'))label.querySelector('input').click();await wait(()=>!button('创建快照并导出 ZIP').disabled)`)
  const output=join(reportDir,'..',basename(reportDir)+'-mvp-content.zip')
  dialog.showSaveDialog=(async()=>({canceled:false,filePath:output})) as typeof originalSave
  await ui(window,`button('创建快照并导出 ZIP').click();await wait(()=>document.querySelector('.workspace-panel [role="status"]').textContent.includes('ZIP 已保存'));document.querySelector('.workspace-panel').scrollIntoView({block:'center'})`)
  if((await readFile(output))[0]!==80)throw new Error('EXPORT_MISSING')
  await writeFile(join(reportDir,'mvp-house.png'),(await window.webContents.capturePage()).toPNG())
  // Five self-authored text PDFs, three deliberate negatives, and duplicate import.
  await ui(window,`document.querySelector('nav button:first-child').click();button('返回文献库').click();await wait(()=>button('导入 PDF'))`)
  const names=['SyntheticStudyA.pdf','SyntheticStudyB.pdf','SyntheticStudyC.pdf','SyntheticStudyD.pdf','negative/encrypted.pdf','negative/no-text.pdf','negative/broken.pdf','fixture.pdf']
  for(const name of names){
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[join(reportDir,'fixtures',name)]})) as typeof originalOpen
   await ui(window,`await wait(()=>!button('导入 PDF').disabled);button('导入 PDF').click();await new Promise(r=>setTimeout(r,200));await wait(()=>!button('导入 PDF').disabled)`)
  }
  let docs:any[]=[]
  for(let i=0;i<200;i++){docs=(await backend.request('/v1/documents')).items;if(docs.length===8&&docs.every(d=>!['pending','running'].includes(d.extraction_status)))break;await pause(100)}
  if(docs.length!==8||docs.filter(d=>d.extraction_status==='ready').length!==5)throw new Error('FIXTURE_IMPORT_MATRIX_FAILED')
  const warnings=docs.filter(d=>d.warning).map(d=>d.warning).sort()
  if(warnings.join(',')!==['ENCRYPTED_PDF','NO_TEXT_NO_OCR','PDF_PARSE_FAILED'].sort().join(','))throw new Error('NEGATIVE_IMPORT_MATRIX_FAILED')
  const noCrossScope=await backend.request(`/v1/documents/${document.id}/search`,'POST',{query:'survival'})
  if(noCrossScope.items.length)throw new Error('CROSS_DOCUMENT_LEAK')
  const fallback=await backend.request(`/v1/documents/${document.id}/search`,'POST',{query:'fixed English',semantic:true,config_version:0})
  if(fallback.mode!=='keyword'||!fallback.reason)throw new Error('MISSING_EMBEDDING_FALLBACK')
  const source=await backend.request(`/v1/documents/${document.id}`)
  await writeFile(join(reportDir,'mvp-storage.png'),(await window.webContents.capturePage()).toPNG())
  // Force a service exit during a second in-flight generation. The first saved Wiki,
  // note and evidence are the recovery baseline; unsaved text is only session-local.
  const pending=await backend.request(`/v1/topics/${topic.id}/suggestions`,'POST',{base_revision_id:final.revision.id,instruction:'interrupt-for-recovery',materials:suggestion.materials,request_id:randomUUID(),config_version:(await providers.list()).find(c=>c.kind==='chat')!.version},'local-mvp-key')
  for(let i=0;i<100;i++){const partial=(await backend.request(`/v1/topics/${topic.id}/suggestions`)).items.find((s:any)=>s.id===pending.id);if(partial.body_md)break;await pause(50)}
  const state={document_id:document.id,message_id:message.id,note_id:note.id,topic_id:topic.id,suggestion_id:suggestion.id,pending_id:pending.id,revision_id:final.revision.id,body_md:final.revision.body_md,note_body:note.body_md,last_page:source.last_page,source_kinds:suggestion.sources.map((s:any)=>s.kind),documents:docs.map(d=>({id:d.id,status:d.extraction_status,warning:d.warning})),export_path:output,embedding_fallback:fallback.reason,contains_key_in_payload:JSON.stringify(payloads).includes('local-mvp-key')}
  if(state.contains_key_in_payload)throw new Error('KEY_IN_MODEL_PAYLOAD')
  await writeFile(join(reportDir,'mvp-state.json'),JSON.stringify(state,null,2))
  await ui(window,`document.querySelector('nav button:nth-child(2)').click();document.querySelector('.garden-editor .cm-content').focus()`)
  await window.webContents.insertText('\nUnsaved session text stays visible after service exit.')
  if(!backend.processId)throw new Error('BACKEND_PID_MISSING')
  process.kill(backend.processId)
  for(let i=0;i<100&&backend.status.state!=='failed';i++)await pause(50)
  if(backend.status.state!=='failed')throw new Error('BACKEND_EXIT_NOT_DETECTED')
  await ui(window,`await wait(()=>[...document.querySelectorAll('main>p')].some(p=>p.textContent.includes('本地服务已退出')));if(!document.querySelector('.garden-editor .cm-content').textContent.includes('Unsaved session text'))throw new Error('SESSION_DRAFT_LOST');document.querySelector('main').scrollIntoView({block:'start'})`)
  await writeFile(join(reportDir,'mvp-failure.png'),(await window.webContents.capturePage()).toPNG())
  await writeFile(join(reportDir,'mvp-fault.json'),JSON.stringify({service_exit_detected:true,session_draft_visible:true,expected_status:'failed'},null,2))
  return true
 }finally{dialog.showSaveDialog=originalSave;dialog.showOpenDialog=originalOpen;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}

export async function resumeMvpSmoke(window:BrowserWindow,backend:Backend,reportDir:string){
 const saved=JSON.parse(await readFile(join(reportDir,'mvp-state.json'),'utf8'))
 const view=await backend.request(`/v1/topics/${saved.topic_id}`)
 const note=(await backend.request(`/v1/notes?document_id=${saved.document_id}`)).items.find((n:any)=>n.id===saved.note_id)
 const drafts=(await backend.request(`/v1/topics/${saved.topic_id}/suggestions`)).items
 const pending=drafts.find((s:any)=>s.id===saved.pending_id)
 const message=(await backend.request(`/v1/documents/${saved.document_id}/chat`)).items.find((m:any)=>m.id===saved.message_id)
 const document=await backend.request(`/v1/documents/${saved.document_id}`)
 if(view.revision.id!==saved.revision_id||view.revision.body_md!==saved.body_md||note.body_md!==saved.note_body||message.status!=='completed'||pending.status!=='interrupted'||!pending.body_md||document.last_page!==saved.last_page)throw new Error('MVP_RESTART_STATE_MISMATCH')
 if(view.revision.sources.map((s:any)=>s.kind).join(',')!=='document,note,message'||view.revision.sources.some((s:any)=>!s.available))throw new Error('MVP_RESTART_SOURCE_MISMATCH')
 await ui(window,`document.querySelector('nav button:nth-child(2)').click();await wait(()=>document.querySelector('[data-topic-id="${saved.topic_id}"]'));document.querySelector('[data-topic-id="${saved.topic_id}"]').click();await wait(()=>document.querySelector('.garden-editor .cm-content')?.textContent.includes('MVP Wiki'));button('材料与 AI 草稿').click();await wait(()=>document.querySelector('.wiki-suggestions')?.textContent.includes('已中断'));document.querySelector('.garden-editor').scrollIntoView({block:'start'})`)
 window.showInactive();await pause(600)
 await writeFile(join(reportDir,'mvp-resumed.png'),(await window.webContents.capturePage()).toPNG())
 await writeFile(join(reportDir,'mvp-restart.json'),JSON.stringify({saved_wiki:true,saved_note:true,chat:true,source_kinds:saved.source_kinds,reading_page:document.last_page,pending_status:pending.status,no_automatic_retry:true},null,2))
}
