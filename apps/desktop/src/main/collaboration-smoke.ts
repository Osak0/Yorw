import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'

/** Owned, isolated native UI verification. No real credentials, papers or SQL hooks. */
export async function runCollaborationSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 let requests=0
 const owner=randomUUID()
 const operations=[
  {key:'topic',action:'create_topic',title:'Candidate research branch',reason:'Separate an unverified research direction'},
  {key:'note',action:'create_note',owner:'$topic',title:'Candidate hypothesis',body_md:'Unverified hypothesis; no experiment has been completed.',reason:'Preserve hypothesis status'},
  {key:'relation',action:'link',first_kind:'topic',first:owner,second_kind:'topic',second:'$topic',reason:'Related questions, independent scope'},
  {key:'independent',action:'create_note',owner,title:'Independent owned note',body_md:'An independent idea for later validation.',reason:'Can be adopted independently'}
 ]
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
  const payload=JSON.parse(Buffer.concat(chunks).toString());requests++
  if(!payload.tools){
   const input=JSON.parse(payload.messages.at(-1).content)
   const result=input.blocks?{title:'Owned imported material',authors:[],year:null,tags:['collaboration'],summary_md:'The owned material describes a candidate collaboration idea, not measured results.',evidence_ids:input.blocks.map((b:any)=>b.id)}:{related:[],topics:[],new_topics:[{title:'Imported research topic',reason:'Organize the owned imported candidate'}]}
   res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(result)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return
  }
  const actual=payload.tools?.some((t:any)=>t.function.name==='propose_changes')
  const results=payload.messages.filter((m:any)=>m.role==='tool')
  let delta:any,finish='tool_calls'
  if(actual){
   await new Promise(resolve=>setTimeout(resolve,1800))
   if(!results.length)delta={tool_calls:[{index:0,id:'owned-proposal',type:'function',function:{name:'propose_changes',arguments:JSON.stringify({operations:JSON.stringify(operations)})}}]}
   else{delta={content:'已生成研究资料预览，正式资料尚未修改。'};finish='stop'}
  }else if(results.length<2){
   const name=results.length?'read_local':'search_local',args=results.length?{id:JSON.parse(results[0].content).items[0].id}:{query:'fixture'}
   delta={tool_calls:[{index:0,id:'capability-'+results.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}
  }else{delta={content:'violet-42 [S1]'};finish='stop'}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:finish}]})+'\n\ndata: [DONE]\n\n')
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const profile=await providers.profileSave({id:randomUUID(),name:'Owned collaboration fixture',provider:'compatible',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:'owned-proposal-fixture',version:0,key:'owned-loopback-key'})
  const check=await providers.profileTest({id:profile.id,kind:'tools'})
  let verified=false
  for(let i=0;i<100;i++){const job=await providers.profileCheck(check.id);if(job.status==='completed'){verified=true;break}if(job.status!=='running')throw Error('CAPABILITY_'+job.error_code);await new Promise(r=>setTimeout(r,100))}
  if(!verified)throw Error('CAPABILITY_TIMEOUT')
  await providers.profileDefaults({...((await providers.profileList()).defaults),research_id:profile.id})
  const prefs=await backend.request('/v1/research-memory/preferences')
  await backend.request('/v1/research-memory/preferences','PUT',{...prefs,enabled:false})
  await backend.request('/v1/topics','POST',{id:owner,title:'Owned collaboration topic',parent_id:null})
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const owner=${JSON.stringify(owner)}
   const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
   const click=(label,root=document)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label);if(!b)throw Error('BUTTON_'+label);b.click()}
   const set=(el,value)=>{Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
   window.__collaborationSmoke={wait,click,set,owner}
   click('Garden');await wait(()=>document.querySelector('#research-home-input'),'HOME')
   const input=document.querySelector('#research-home-input');set(input,'Organize candidate research ideas');await new Promise(r=>setTimeout(r,100));input.closest('form').requestSubmit()
   await wait(()=>document.querySelector('.research-turn'),'RUNNING_TURN_MOUNTED')
   if(document.querySelector('.proposal-summary'))throw Error('PROPOSAL_BEFORE_TOOL')
   await wait(()=>document.querySelector('.research-turn .proposal-summary'),'ASYNC_REPLY_CARD')
   await wait(async()=>{const sessions=(await window.yorw.research.list()).value.items;if(!sessions.length)return false;const r=await window.yorw.research.get({id:sessions[0].id});const task=r.value.items[0];if(task.status!=='completed')return false;const listed=await window.yorw.collaboration.list({task_id:task.id});return listed.ok&&listed.value.items.length>0},'PROPOSAL_LIST')
   await wait(()=>document.querySelector('.proposal-summary'),'PROPOSAL_CARD')
   const sessions=(await window.yorw.research.list()).value.items,sid=sessions[0].id
   await wait(async()=>{const r=await window.yorw.research.get({id:sid});return r.value.items[0].status==='completed'},'COMPLETED')
   if((await window.yorw.garden.list()).value.items.length!==1)throw Error('FORMAL_BEFORE_ACCEPT')
   click('查看方案',document.querySelector('.proposal-summary'))
   await wait(()=>document.querySelector('.proposal-dossier'),'PROPOSAL_TAB')
   const dossier=document.querySelector('.proposal-dossier')
   dossier.querySelector('[data-operation-key="topic"] input').click();await new Promise(r=>setTimeout(r,100))
   if(dossier.querySelector('[data-operation-key="note"] input').checked||dossier.querySelector('[data-operation-key="relation"] input').checked)throw Error('DEPENDENCIES')
   if(!dossier.querySelector('[data-operation-key="independent"] input').checked)throw Error('INDEPENDENT')
   click('采纳所选',dossier)
   await wait(async()=>{const r=await window.yorw.garden.overview(owner);return r.value.owned_notes.length===1},'PARTIAL_ACCEPT')
   if((await window.yorw.garden.list()).value.items.length!==1)throw Error('UNSELECTED_TOPIC_CREATED')
   const view=(await window.yorw.research.get({id:sid})).value
   window.__collaborationSmoke.sid=sid;window.__collaborationSmoke.taskId=view.items[0].id
   return {previewOnly:true,dependenciesCancel:true,independentAdopted:true,taskId:view.items[0].id,sid}
  })()`)
  for(const width of [1024,1280,1440]){window.setSize(width,800);await new Promise(r=>setTimeout(r,220));await writeFile(join(folder,`proposal-detail-${width}.png`),(await window.webContents.capturePage()).toPNG())}
  const preview=await backend.request('/v1/collaboration/preview','POST',{request_id:randomUUID(),topic_id:owner,operations:operations.slice(0,3)})
  const second=await window.webContents.executeJavaScript(`(async()=>{
   const {wait,click,owner}=window.__collaborationSmoke
   click('Garden');await wait(()=>document.querySelector('#research-home-input'),'GARDEN');document.querySelector('.garden-home-toolbar .workspace-more summary').click();click('刷新目录');await wait(()=>document.querySelector('[data-topic-id="'+owner+'"]'),'TREE')
   document.querySelector('[data-topic-id="'+owner+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await wait(()=>document.querySelector('[aria-label="专题概览"]'),'OVERVIEW');click('管理关联专题')
   await wait(()=>document.querySelector('[aria-label="专题普通关联"]'),'RELATION_PANEL')
   const panel=document.querySelector('[aria-label="专题普通关联"]');panel.querySelector('details').open=true
   await wait(()=>panel.querySelector('.proposal-summary'),'MANUAL_PREVIEW')
   click('查看方案',panel.querySelector('.proposal-summary'))
   await wait(()=>document.querySelector('.proposal-dossier'),'MANUAL_TAB')
   const manual=document.querySelector('.proposal-dossier')
   if(!manual.textContent.includes('专题：Owned collaboration topic'))throw Error('RELATION_TYPE')
   click('采纳所选',manual)
   await wait(async()=>{const p=await window.yorw.collaboration.get(${JSON.stringify(preview.id)});return p.value.status==='accepted'},'BATCH_ACCEPT')
   await wait(async()=>{const p=await window.yorw.collaboration.topics(owner);return p.value.items[0]?.title==='Candidate research branch'},'RELATION_VISIBLE')
   const related=(await window.yorw.collaboration.topics(owner)).value.items[0].id
   const scope=(await window.yorw.garden.noteScope(owner)).value
   if(scope.selected.includes(related))throw Error('RELATION_EXPANDED_SCOPE')
   const oldConfirm=window.confirm;window.confirm=()=>true
   try{click('撤回本次采纳',document.querySelector('.proposal-dossier'));await wait(async()=>{const p=await window.yorw.collaboration.get(${JSON.stringify(preview.id)});return p.value.status==='undone'},'UNDO')}finally{window.confirm=oldConfirm}
   if((await window.yorw.collaboration.topics(owner)).value.items.length)throw Error('UNDO_RELATION')
   const notes=(await window.yorw.garden.overview(owner)).value.owned_notes
   if(notes.length!==1)throw Error('UNDO_INDEPENDENT_LOST')
   window.__collaborationSmoke.previewId=${JSON.stringify(preview.id)}
   document.querySelector('[data-tab-key^="assistant:"]').click();await wait(()=>!document.querySelector('.research-host').hidden,'ASSISTANT_BACK')
   const note=(await window.yorw.garden.get(notes[0].id)).value
   const saved=await window.yorw.garden.save({id:notes[0].id,base_revision_id:note.revision.id,body_md:'Manual follow-up must survive undo.'});if(!saved.ok)throw Error('FOLLOWUP_EDIT')
   const acceptedCard=document.querySelector('.research-turn .proposal-summary')
   await wait(()=>acceptedCard?.textContent.includes('查看方案'),'ACCEPTED_CARD')
   click('查看方案',acceptedCard);await wait(()=>document.querySelector('.proposal-dossier'),'ACCEPTED_TAB')
   window.confirm=()=>true
   try{click('撤回本次采纳',document.querySelector('.proposal-dossier'));await wait(()=>document.querySelector('.proposal-notice')?.textContent.includes('成果已有后续修改'),'UNDO_CONFLICT_MESSAGE')}finally{window.confirm=oldConfirm}
   if((await window.yorw.garden.get(notes[0].id)).value.revision.body_md!=='Manual follow-up must survive undo.')throw Error('FOLLOWUP_LOST')
   return {batchAdopted:true,relationVisible:true,scopeUnchanged:true,undoPreservesIndependent:true,undoConflictPreservesEdit:true,selectionReflectsActualAdoption:true,previewId:${JSON.stringify(preview.id)}}
  })()`)
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:'owned-enrichment-fixture',version:0,key:'owned-loopback-key'})
  const form=new FormData();form.append('file',new Blob(['Owned imported material describes a candidate collaboration idea, not measured results.']),'owned-import.txt')
  const imported=await backend.request('/v1/documents/import','POST',form)
  for(let i=0;i<100;i++){if((await backend.request('/v1/documents/'+imported.document.id)).extraction_status==='ready')break;await new Promise(r=>setTimeout(r,80))}
  const enrichmentProof=await window.webContents.executeJavaScript(`(async()=>{
   const {wait,click}=window.__collaborationSmoke
   click('Storage');await wait(()=>document.querySelector('.document-list .document-actions'),'STORAGE_IMPORT')
   click('管理文献');await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='编辑元数据'),'MANAGEMENT_OPEN');click('编辑元数据');await wait(()=>document.querySelector('.enrichment-entry'),'METADATA_TOOL');click('AI 辅助文献整理')
   await wait(()=>document.querySelector('.collaboration-entry')?.textContent.includes('建议新专题：Imported research topic'),'ENRICHMENT_NEW_TOPIC')
   if((await window.yorw.resources.documentTopics(${JSON.stringify(imported.document.id)})).value.items.length)throw Error('ENRICHMENT_AUTO_LINK')
   const entry=document.querySelector('.collaboration-entry');click('使用此名称并预览关联',entry);await new Promise(r=>setTimeout(r,100));click('预览所选关联与新专题',entry)
   await wait(()=>entry.querySelector('.proposal-summary'),'ENRICHMENT_PREVIEW')
   click('查看方案',entry.querySelector('.proposal-summary'))
   await wait(()=>document.querySelector('.proposal-dossier'),'ENRICHMENT_TAB')
   const dossier=document.querySelector('.proposal-dossier')
   if(!dossier.textContent.includes('依赖')||!dossier.textContent.includes('Imported research topic'))throw Error('ENRICHMENT_DEPENDENCY')
   click('采纳所选',dossier)
   await wait(async()=>{const r=await window.yorw.resources.documentTopics(${JSON.stringify(imported.document.id)});return r.value.items.length===1},'ENRICHMENT_ADOPT')
   document.querySelector('[data-tab-key^="assistant:"]').click();await wait(()=>!document.querySelector('.research-host').hidden,'ASSISTANT_RETURN')
   const enrichmentTask=(await window.yorw.enrichment.view({id:${JSON.stringify(imported.document.id)}})).value.task.id;return {enrichmentTaskId:enrichmentTask,enrichmentPreviewOnly:true,enrichmentSameProtocol:true,newTopicAndDocumentLinkAdopted:true,documentId:${JSON.stringify(imported.document.id)}}
  })()`)
  const layouts=[]
  for(const [width,height] of [[1024,768],[1280,800],[1440,900]]){
   window.setSize(width,height);await new Promise(r=>setTimeout(r,180))
   const layout=await window.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.research-conversation');return {overflow:document.documentElement.scrollWidth>innerWidth+2,conversationWidth:el.getBoundingClientRect().width}})()`)
   if(layout.overflow||layout.conversationWidth<450)throw Error('LAYOUT_'+width)
   layouts.push({width,height,...layout});await writeFile(join(folder,'collaboration-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
  }
  await writeFile(join(folder,'collaboration-smoke.json'),JSON.stringify({...proof,...second,...enrichmentProof,owner,layouts,requests,externalRequests:0},null,2))
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}

export async function resumeCollaborationSmoke(window:BrowserWindow,backend:Backend,folder:string){
 const prior=JSON.parse(await readFile(join(folder,'collaboration-smoke.json'),'utf-8'))
 const result=await window.webContents.executeJavaScript(`(async()=>{
  const prior=${JSON.stringify(prior)}
  const sessions=await window.yorw.research.get({id:prior.sid});if(sessions.value.items.length!==1||sessions.value.items[0].status!=='completed')throw Error('TASK_RESTART')
  const first=await window.yorw.collaboration.list({task_id:prior.taskId});if(first.value.items[0].status!=='accepted')throw Error('DECISION_RESTART')
  const second=await window.yorw.collaboration.get(prior.previewId);if(second.value.status!=='undone')throw Error('UNDO_RESTART')
  if(!second.value.decisions?.length)throw Error('DECISION_HISTORY_RESTART')
  let proposalTab=false
  for(let i=0;i<100;i++){if(document.querySelector('[data-tab-key^="proposal:"]')){proposalTab=true;break}await new Promise(r=>setTimeout(r,100))}
  if(!proposalTab){const layout=await window.yorw.layout.load();const docs=await window.yorw.documents.list();const topics=await window.yorw.garden.list();throw Error('PROPOSAL_TAB_RESTART_'+JSON.stringify({layout:layout.ok?layout.value:null,docs:docs.ok,topics:topics.ok,notice:document.querySelector('.app-notice')?.textContent,tabs:document.querySelectorAll('[data-tab-key]').length,body:document.body.innerText.slice(0,160)}))}
  const notes=await window.yorw.garden.overview(prior.owner);if(notes.value.owned_notes.length!==1)throw Error('NOTE_RESTART')
  if(prior.documentId&&(await window.yorw.resources.documentTopics(prior.documentId)).value.items.length!==1)throw Error('DOCUMENT_LINK_RESTART')
  if(prior.enrichmentTaskId&&(await window.yorw.enrichment.view({id:prior.documentId})).value.task.id!==prior.enrichmentTaskId)throw Error('ENRICHMENT_AUTOMATIC_RESUME');return {taskRestored:true,decisionRestored:true,undoRestored:true,formalNotePreserved:true,documentLinkPreserved:true,enrichmentNotRepeated:true,proposalTabRestored:proposalTab,decisionHistoryRestored:true}
 })()`)
 const tasks=await backend.request('/v1/research/sessions/'+prior.sid)
 if(tasks.items.some((t:any)=>t.status==='running'))throw Error('AUTOMATIC_RESUME')
 await writeFile(join(folder,'collaboration-resume.json'),JSON.stringify({...result,noAutomaticTask:true},null,2))
}
