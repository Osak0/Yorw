import type {BrowserWindow} from 'electron'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {Backend} from './backend'
import type {Providers} from './providers'

/** Owned local fixture only: checks actual IPC, editors, scope and explicit AI adoption. */
export async function runNotebooksSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 let requests=0
 const server=createServer(async(req,res)=>{for await(const _chunk of req){/* consume fixture request */}requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'Refined owned plan [S1].'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const address=server.address() as {port:number}
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${address.port}`,model:'owned-notebook-fixture',version:0,key:'owned-local-key'})
  const prefs=await backend.request('/v1/ai/preferences');await backend.request('/v1/ai/preferences','PUT',{...prefs,semantic_enabled:false})
  const owner=randomUUID(),child=randomUUID(),foreign=randomUUID()
  for(const [id,title,parent_id] of [[owner,'Scope owner',null],[child,'Scope child',owner],[foreign,'Scope foreign',null]])await backend.request('/v1/topics','POST',{id,title,parent_id})
  const notes=[] as any[]
  for(let i=0;i<7;i++){
   const note=await backend.request(`/v1/topics/${owner}/notebooks`,'POST',{id:randomUUID(),title:'Owned note '+i})
   await backend.request(`/v1/topics/${note.id}/revisions`,'POST',{base_revision_id:note.base_revision_id,body_md:'Owned plan '+i+' is a candidate, not a result.'});notes.push(note)
  }
  const shared=await backend.request(`/v1/topics/${child}/notebooks`,'POST',{id:randomUUID(),title:'Child original'})
  const outside=await backend.request(`/v1/topics/${foreign}/notebooks`,'POST',{id:randomUUID(),title:'Foreign original'})
  const form=new FormData();form.append('file',new Blob(['Owned reading fixture evidence.']),'owned.txt')
  const imported=await backend.request('/v1/documents/import','POST',form)
  for(let i=0;i<100;i++){const d=await backend.request('/v1/documents/'+imported.document.id);if(d.extraction_status==='ready')break;await new Promise(r=>setTimeout(r,100))}
  await backend.request(`/v1/topics/${owner}/documents/${imported.document.id}`,'PUT',{})
  const reading=await backend.request('/v1/notes','POST',{id:randomUUID(),document_id:imported.document.id,body_md:'Owned reading note candidate.'})
  const ids={owner,child,foreign,first:notes[0].id,shared:shared.id,outside:outside.id,document:imported.document.id,reading:reading.id}

  const setup=await window.webContents.executeJavaScript(`(async()=>{
   const ids=${JSON.stringify(ids)}
   const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
   const click=(text,root=document)=>{const button=[...root.querySelectorAll('button')].find(b=>b.textContent===text);if(!button)throw Error('BUTTON_'+text);button.click()}
   const set=(el,value)=>{Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
   window.__notebookSmoke={wait,click,set,ids}
   click('Garden');await wait(()=>document.querySelector('#research-home-input'),'HOME');click('刷新');await wait(()=>document.querySelector('[data-topic-id="'+ids.owner+'"]'),'TREE')
   document.querySelector('[data-topic-id="'+ids.owner+'"]').click();await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===3,'OVERVIEW')
   const root=document.querySelector('[aria-label="专题概览"]');if(root.querySelectorAll(':scope>section').length!==3)throw Error('THREE_MODULES')
   if(root.querySelector('.cm-editor'))throw Error('INLINE_FULL_EDITOR')
   if(root.querySelector('section ul').children.length!==5)throw Error('FIRST_FIVE')
   if(root.querySelector('details')?.open)throw Error('SHARED_NOT_COLLAPSED')
   click('笔记范围',root);await wait(()=>document.querySelector('input[aria-label="Scope foreign"]'),'SCOPE')
   document.querySelector('input[aria-label="Scope foreign"]').click();await new Promise(r=>setTimeout(r,100));click('保存笔记范围')
   await wait(async()=>{const r=await window.yorw.garden.noteScope(ids.owner);return r.value.selected.includes(ids.foreign)},'SAVE_SCOPE')
   document.querySelector('input[aria-label="Scope foreign"]').click();await new Promise(r=>setTimeout(r,600))
   document.querySelector('.workspace-tab[aria-selected="true"]').closest('.workspace-tab-item').querySelector('.workspace-tab-close').click();await wait(()=>document.querySelector('.close-dialog'),'SCOPE_CLOSE_GUARD');click('取消')
   if(document.querySelector('input[aria-label="Scope foreign"]').checked)throw Error('SCOPE_DRAFT_LOST')
   document.querySelector('.workspace-tab[aria-selected="true"]').closest('.workspace-tab-item').querySelector('.workspace-tab-close').click();await wait(()=>document.querySelector('.close-dialog'),'SCOPE_SAVE_CLOSE');click('保存并关闭')
   await wait(()=>!document.querySelector('.close-dialog')&&!document.querySelector('[data-tab-key="note-scope:'+ids.owner+'"]'),'SCOPE_SAVED_CLOSED')
   click('笔记范围');await wait(()=>document.querySelector('input[aria-label="Scope foreign"]'),'SCOPE_REOPEN')
   if(document.querySelector('input[aria-label="Scope foreign"]').checked)throw Error('SCOPE_SAVE_FAILED')
   document.querySelector('input[aria-label="Scope foreign"]').click();await new Promise(r=>setTimeout(r,100));click('保存笔记范围');await wait(async()=>{const r=await window.yorw.garden.noteScope(ids.owner);return r.value.selected.includes(ids.foreign)},'SCOPE_RESTORED')
   click('返回专题概览');await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===3,'BACK_OVERVIEW')
   const overview=(await window.yorw.garden.overview(ids.owner)).value;if(!overview.notes.some(n=>n.id===ids.outside))throw Error('SCOPE_NOT_SHARED')
   click('查看全部笔记');await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===1&&[...document.querySelectorAll('.topic-overview-link')].some(b=>b.textContent==='Owned note 0'),'ALL_NOTES')
   click('Owned note 0');await wait(()=>document.querySelector('.topic-body-view .cm-content'),'DETAIL')
   document.querySelector('.topic-body-view .cm-content').focus()
   return {threeModules:true,firstFive:true,sharedCollapsed:true,scopeSaved:true,scopeCloseGuard:true,independentDetail:true}
  })()`)
  await window.webContents.insertText('Manual fixture change. ')
  const edited=await window.webContents.executeJavaScript(`(async()=>{
   const {wait,click,ids}=window.__notebookSmoke
   await wait(()=>document.querySelector('.workspace-tab[aria-selected="true"]')?.closest('.workspace-tab-item').querySelector('.workspace-tab-dirty'),'DIRTY')
   document.querySelector('.workspace-tab[aria-selected="true"]').closest('.workspace-tab-item').querySelector('.workspace-tab-close').click();await wait(()=>document.querySelector('.close-dialog'),'DRAFT_GUARD');click('取消')
   click('保存',document.querySelector('.topic-toolbar'));await wait(async()=>{const r=await window.yorw.garden.get(ids.first);return r.value.revision.body_md.includes('Manual fixture change.')},'SAVE_BODY')
   click('AI 优化',document.querySelector('.topic-toolbar'));await wait(()=>document.querySelector('[aria-label="Wiki 生成要求"]'),'AI_FORM')
   const input=document.querySelector('[aria-label="Wiki 生成要求"]');window.__notebookSmoke.set(input,'Organize owned plan');await new Promise(r=>setTimeout(r,100));click('生成草稿')
   await wait(()=>document.querySelector('.wiki-review'),'AI_REVIEW')
   if((await window.yorw.garden.get(ids.first)).value.revision.body_md==='Refined owned plan [S1].')throw Error('AUTO_APPLIED')
   click('替换正文',document.querySelector('.wiki-review'));await wait(async()=>{const r=await window.yorw.garden.get(ids.first);return r.value.revision.body_md==='Refined owned plan [S1].'},'EXPLICIT_ADOPTION')
   click('返回笔记');await wait(()=>document.querySelector('.topic-body-view'),'RETURN_NOTE')
   return {draftCloseGuard:true,manualSaved:true,aiPreviewOnly:true,explicitAiAdoption:true}
  })()`)
  const layouts=[]
  for(const width of [1024,1280,1440]){window.setSize(width,800);await new Promise(r=>setTimeout(r,250));const metrics=await window.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,editor:document.querySelector('.topic-body-editor')?.clientHeight??0})`);if(metrics.overflow||metrics.editor<150)throw Error('NOTE_LAYOUT_'+width);layouts.push({width,...metrics});await writeFile(join(folder,`notebook-${width}.png`),(await window.webContents.capturePage()).toPNG())}
  await window.webContents.executeJavaScript(`(async()=>{const {click,wait,ids}=window.__notebookSmoke;click('返回所属专题');await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===3,'FINAL_OVERVIEW')})()`)
  const readingProof=await window.webContents.executeJavaScript(`(async()=>{
   const {click,wait,ids}=window.__notebookSmoke
   click('查看全部笔记');await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===1&&[...document.querySelectorAll('.topic-overview-link')].some(b=>b.textContent==='Owned reading note candidate.'),'READING_IN_OVERVIEW')
   click('Owned reading note candidate.');await wait(()=>document.querySelector('.notes-panel .cm-content'),'READING_DETAIL')
   if(!document.querySelector('.notes-panel .cm-content').textContent.includes('Owned reading note'))throw Error('READING_SHARED_ID')
   click('AI 优化笔记');await wait(()=>document.querySelector('[aria-label="Wiki 生成要求"]'),'READING_AI')
   window.__notebookSmoke.set(document.querySelector('[aria-label="Wiki 生成要求"]'),'Organize this reading note');await new Promise(r=>setTimeout(r,100));click('生成草稿')
   await wait(()=>document.querySelector('.wiki-review'),'READING_REVIEW');click('替换正文',document.querySelector('.wiki-review'))
   await wait(async()=>{const r=await window.yorw.notes.list(ids.document);return r.value.items.find(n=>n.id===ids.reading)?.version===2},'READING_ACCEPTED')
   click('返回笔记');await wait(()=>document.querySelector('.notes-panel .cm-content')?.textContent.includes('Refined owned plan'),'READING_RETURN_SYNC')
   const versions=await window.yorw.garden.readingHistory(ids.reading);if(!versions.ok||versions.value.items.length!==2)throw Error('READING_REVISIONS')
   return {readingSharedState:true,readingAiAdoption:true,readingRevisions:true}
  })()`)
  await writeFile(join(folder,'reading-note.png'),(await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`(async()=>{const {wait,ids}=window.__notebookSmoke;document.querySelector('[data-tab-key="topic:'+ids.owner+'"]').click();await wait(()=>document.querySelector('[aria-label="专题概览"]')?.querySelectorAll(':scope>section').length===3,'OVERVIEW_AFTER_READING')})()`)
  await writeFile(join(folder,'notebook-overview.png'),(await window.webContents.capturePage()).toPNG())
  await writeFile(join(folder,'notebooks-smoke.json'),JSON.stringify({...setup,...edited,...readingProof,ids,layouts,requests,ownedOnly:true},null,2))
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}


export async function resumeNotebooksSmoke(window:BrowserWindow,backend:Backend,folder:string){
 const prior=JSON.parse(await readFile(join(folder,'notebooks-smoke.json'),'utf-8'))
 const result=await window.webContents.executeJavaScript(`(async()=>{
  const ids=${JSON.stringify(prior.ids)}
  const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
  await wait(()=>document.querySelector('[data-tab-key="topic-note:'+ids.first+'"]'),'RESTORED_NOTE_TAB')
  document.querySelector('[data-tab-key="topic-note:'+ids.first+'"]').click();await wait(()=>document.querySelector('.topic-body-view .cm-content')?.textContent.includes('Refined owned plan'),'RESTORED_SAVED_BODY')
  const catalog=await window.yorw.garden.notebookCatalog();if(!catalog.ok||!catalog.value.items.some(n=>n.id===ids.first))throw Error('CATALOG_IDS')
  const jobs=await window.yorw.ai.latest({kind:'draft',target_id:ids.first});if(!jobs.ok||jobs.value.items.length!==1)throw Error('PAID_RESUME')
  const reading=await window.yorw.notes.list(ids.document);if(reading.value.items.find(n=>n.id===ids.reading)?.version!==2)throw Error('READING_VERSION')
  return {stableNoteIds:true,editorRestored:true,readingVersionRestored:true,noPaidResume:true}
 })()`)
 await writeFile(join(folder,'notebooks-resume.json'),JSON.stringify(result,null,2))
 await writeFile(join(folder,'notebooks-resume.png'),(await window.webContents.capturePage()).toPNG())
}
