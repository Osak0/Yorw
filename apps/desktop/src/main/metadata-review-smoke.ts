import {createServer} from 'node:http'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
/** Owned protocol fixture. It checks metadata flow, never real model quality. */
export async function runMetadataReviewSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 let calls=0,contextSeen=false
 const server=createServer((request,response)=>{let raw='';request.on('data',d=>raw+=d);request.on('end',()=>{
  try{
   calls++;const body=JSON.parse(raw),question=JSON.parse(JSON.parse(body.messages[1].content).question)
   contextSeen ||= question.current_metadata?.summary_md==='Original user summary'
   const value={overview:'Synthetic summary based on the original evidence.',tags:['shared','Proposed'],synonyms:[],metadata:{title:'Suggested document title',authors:['Synthetic Author'],year:2026},evidence_ids:question.blocks.map((b:{id:string})=>b.id)}
   response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(value)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  }catch{response.writeHead(500);response.end()}
 })})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try{
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('FIXTURE_SERVER')
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${addr.port}`,model:'metadata-review-fixture',key:'fixture-key',version:0})
  let record=(await backend.request('/v1/documents')).items[0]
  record=await backend.request('/v1/documents/'+record.id,'PATCH',{version:record.version,tags:['Shared'],summary_md:'Original user summary'})
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('METADATA_UI_'+label)}
   const visible=n=>n.getClientRects().length>0
   const button=text=>[...document.querySelectorAll('button')].find(n=>visible(n)&&n.textContent.trim()===text)
   const click=async text=>{await wait(()=>button(text)&&!button(text).disabled,text);button(text).click()}
   const set=(element,value)=>{Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}))}
   await click('资料');await wait(()=>document.querySelector('[aria-label="AI 文献整理"]'),'resource')
   if(document.querySelector('[aria-label="文献资料"] [aria-label="所属专题"]'))throw new Error('RELATIONS_IN_ACTIVITY')
   await click('生成 / 重试');await wait(()=>document.querySelector('[aria-label="AI 生成记录"]')?.options.length===1,'first-result')
   await click('重新生成');await wait(()=>document.querySelector('[aria-label="AI 生成记录"]')?.options.length===2,'second-result')
   await click('隐藏本条结果');await wait(()=>button('恢复显示完整结果'),'hidden')
   await click('恢复显示完整结果');await wait(()=>button('替换标题'),'restored')
   const history=document.querySelector('[aria-label="AI 生成记录"]');set(history,history.options[1].value)
   await wait(()=>document.querySelector('[data-enrichment-id]')?.dataset.enrichmentId===history.options[1].value&&button('添加到标签'),'older-result')
   await click('添加到标签');await wait(()=>document.querySelector('.enrichment-suggestions')?.textContent.includes('Proposed、Shared'),'tags-merged')
   await click('添加到总结');await wait(()=>document.querySelector('.enrichment-suggestions')?.textContent.includes('Original user summary')&&document.querySelector('.enrichment-suggestions')?.textContent.includes('Synthetic summary'),'summary-merged')
   const confirm=window.confirm;window.confirm=()=>true
   await click('替换标题');await wait(()=>document.querySelector('.resource-header h2')?.textContent==='Suggested document title','title-applied');window.confirm=confirm
   await click('编辑元数据');await wait(()=>document.querySelector('[aria-label="编辑文献元数据"]'),'metadata-page')
   await wait(()=>document.querySelector('[aria-label="文献关联"]'),'relations-in-metadata')
   if(document.querySelector('[aria-label="元数据建议"]')||document.querySelector('[aria-label="笔记"]'))throw new Error('ACTIVITY_IN_METADATA')
   if(!document.querySelector('[aria-label="总结"]').value.includes('Synthetic summary'))throw new Error('CANONICAL_SUMMARY')
   return {history:true,restore:true,oldRecordAdoption:true,canonicalTags:true,canonicalSummary:true,pageResponsibilities:true}
  })()`)
  await writeFile(join(folder,'metadata-editor.png'),(await window.webContents.capturePage()).toPNG())
  const current=await backend.request('/v1/documents/'+record.id)
  if(current.tags.join('|')!=='Proposed|Shared'||current.summary_md!=='Original user summary\n\nSynthetic summary based on the original evidence.')throw new Error('CANONICAL_METADATA')
  const f=(await backend.request('/v1/library-folders','POST',{name:'Competition'})).items.find((v:any)=>v.name==='Competition')
  await backend.request('/v1/library-folder-assignment','POST',{folder_id:f.id,documents:{[current.id]:current.version}})
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="文献关联"]').scrollIntoView({block:'start'})`);await new Promise(r=>setTimeout(r,150))
  await writeFile(join(folder,'metadata-relations.png'),(await window.webContents.capturePage()).toPNG())
  const directory=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('DIRECTORY_UI_'+label)}
   ;[...document.querySelectorAll('nav button')].find(n=>n.textContent==='Storage').click()
   await wait(()=>document.querySelector('.directory-folder[title="Competition"]'),'folder')
   await wait(()=>!document.querySelector('.directory-file'),'assignment')
   const f=document.querySelector('.directory-folder[title="Competition"]');f.click()
   await wait(()=>document.querySelector('.directory-subtree .directory-file'),'single-click-expand')
   if(!document.querySelector('.directory-location').textContent.includes('根目录'))throw new Error('SINGLE_CLICK_NAVIGATED')
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
   return {singleClickExpand:true}
  })()`)
  await writeFile(join(folder,'folder-expanded.png'),(await window.webContents.capturePage()).toPNG())
  const navigation=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('DIRECTORY_UI_'+label)}
   const f=document.querySelector('.directory-folder[title="Competition"]')
   f.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await wait(()=>document.querySelector('.directory-location').textContent.includes('Competition'),'double-click-enter')
   await wait(()=>document.querySelector('.document-management summary'),'management')
   const summary=document.querySelector('.document-management summary'),before=getComputedStyle(summary,'::after').content
   summary.click();await wait(()=>summary.parentElement.open,'open')
   const after=getComputedStyle(summary,'::after').content
   if(before===after)throw new Error('EXPANSION_INDICATOR')
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
   return {doubleClickEnter:true,expandedManagementIndicator:true}
  })()`)
  await writeFile(join(folder,'folder-entered.png'),(await window.webContents.capturePage()).toPNG())
  return {...proof,...directory,...navigation,metadataInPrompt:contextSeen,modelCalls:calls,schema:22,confirmationStub:true}
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
