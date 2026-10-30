import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'

/** Owned loopback protocol fixture in an isolated --yorw-smoke profile. */
export async function runEnrichmentSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 const docx=process.argv.includes('--enrichment-docx-smoke')
 const filename=docx?'phase2.docx':'phase2.txt',tag=docx?'EventBudget':'LDCT'
 const sourceNeedle=docx?'活动名称':'Computed tomography',overview=docx?'Synthetic event budget overview.':'Synthetic lung imaging overview.'
 let calls=0
 const server=createServer((request,response)=>{let raw='';request.on('data',d=>raw+=d);request.on('end',()=>{
  try{
   calls++
   const body=JSON.parse(raw),value=JSON.parse(JSON.parse(body.messages[1].content).question)
   const ids=value.blocks.map((b:{id:string})=>b.id)
   const text=JSON.stringify({overview,method:null,data:[docx?'活动总额：946.2元。':'Synthetic original evidence.'],research_question:null,conclusion:[],limitations:null,tags:[tag],synonyms:null,evidence_ids:ids})
   response.writeHead(200,{'Content-Type':'text/event-stream'})
   response.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  }catch{response.writeHead(500);response.end()}
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 window.webContents.setBackgroundThrottling(false)
 try{
  const address=server.address();if(!address||typeof address==='string')throw new Error('FIXTURE_SERVER')
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${address.port}`,model:'enrichment-protocol-fixture',key:'fixture-key',version:0})
  const topic=await backend.request('/v1/topics','POST',{id:randomUUID(),title:docx?'event budget':'lung imaging'})
  await window.webContents.executeJavaScript(`(async()=>{
   const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('HOUSE_TIMEOUT')}
   const visible=n=>!n.closest('[hidden]')
   ;[...document.querySelectorAll('nav button')].find(b=>b.textContent==='House').click()
   await wait(()=>[...document.querySelectorAll('.house-entries button')].some(visible))
   ;[...document.querySelectorAll('.house-entries button')].find(b=>visible(b)&&b.textContent.startsWith('文献解析与预览')).click()
   await wait(()=>document.querySelector('[aria-label="自动整理新文献"]')&&!document.querySelector('[aria-label="自动整理新文献"]').disabled)
   const toggle=document.querySelector('[aria-label="自动整理新文献"]');if(toggle.checked)throw new Error('ENRICHMENT_DEFAULT_ON');toggle.click()
   await wait(()=>[...document.querySelectorAll('[role=status]')].some(n=>visible(n)&&n.textContent.includes('已授权')))
  })()`)
  const bytes=docx?await readFile(join(folder,'phase2.docx')):Buffer.from('Computed tomography finds lung nodules. Synthetic original evidence.')
  const upload=new FormData();upload.append('file',new Blob([bytes]),filename)
  const imported=await backend.request('/v1/documents/import','POST',upload)
  const id=imported.document.id
  const deadline=Date.now()+45000
  let view:any
  while(Date.now()<deadline){view=await backend.request(`/v1/enrichment/documents/${id}`);if(view.task?.status==='succeeded')break;if(view.task?.status==='failed')throw new Error('AUTO_ENRICH_FAILED');await new Promise(r=>setTimeout(r,200))}
  if(!view?.enrichment||view.task?.status!=='succeeded')throw new Error('AUTO_ENRICH_TIMEOUT')
  const fresh=await backend.request(`/v1/documents/${id}`)
  if(fresh.summary_md||fresh.tags.length)throw new Error('HUMAN_FIELDS_OVERWRITTEN')
  if(view.enrichment.recommendations[0]?.topic_id!==topic.topic.id)throw new Error('TOPIC_RECOMMENDATION_MISSING')
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+25000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   const visible=n=>!n.closest('[hidden]')
   ;[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Storage').click()
   await wait(()=>[...document.querySelectorAll('.document-row')].some(n=>n.textContent.includes(${JSON.stringify(filename)})),'DOCUMENT_ROW')
   const row=[...document.querySelectorAll('.document-row')].find(n=>n.textContent.includes(${JSON.stringify(filename)}));[...row.querySelectorAll('button')].find(b=>b.textContent==='文献资料').click()
   await wait(()=>document.querySelector('[aria-label="AI 文献整理"]')?.textContent.includes(${JSON.stringify(overview)}),'AI_RESOURCE')
   const panel=document.querySelector('[aria-label="AI 文献整理"]')
   if(!panel.textContent.includes(${JSON.stringify(tag)}))throw new Error('TAG_OR_RECOMMENDATION')
   const page=panel.closest('.document-resource-page'),sections=page?.querySelector('.document-resource-view')
   if(!page||!sections||getComputedStyle(page).overflowY!=='auto'||getComputedStyle(sections).overflowY!=='visible')throw new Error('MULTIPLE_SCROLL_OWNERS')
   const before=panel.getBoundingClientRect().top;page.scrollTop=200;await new Promise(r=>setTimeout(r,150))
   if(panel.getBoundingClientRect().top>=before-100)throw new Error('AI_PANEL_NOT_SCROLLING_WITH_PAGE')
   page.scrollTop=0
   if(page.scrollWidth>page.clientWidth+1)throw new Error('RESOURCE_HORIZONTAL_OVERFLOW')
   return {singleScrollPage:true,optInHouse:true,automaticAfterImport:true,derivedTags:true,humanFieldsPreserved:true}
  })()`)
  for(const [width,height] of [[1280,720],[1024,768]]){
   window.setContentSize(width,height);await new Promise(r=>setTimeout(r,250))
   const layout=await window.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.document-resource-page');return {fits:p.scrollWidth<=p.clientWidth+1,scrolls:p.scrollHeight>p.clientHeight}})()`)
   if(!layout.fits||!layout.scrolls)throw new Error('RESOURCE_LAYOUT_'+width)
   await writeFile(join(folder,'enrichment-resource-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
  }
  await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   ;[...document.querySelectorAll('button')].find(b=>b.textContent==='编辑元数据').click()
   await wait(()=>document.querySelector('[aria-label="推荐关联专题"]'),'TOPIC_IN_METADATA')
   const section=document.querySelector('[aria-label="推荐关联专题"]');[...section.querySelectorAll('button')].find(b=>b.textContent==='确认关联').click()
   await wait(()=>document.querySelector('[aria-label="所属专题"]')?.textContent.includes(${JSON.stringify(docx?'event budget':'lung imaging')}),'TOPIC_CONFIRMED')
   ;[...document.querySelectorAll('.workspace-tab')].find(b=>b.querySelector('.workspace-tab-kind')?.textContent==='文献资料').click()
   await wait(()=>document.querySelector('[aria-label="AI 文献整理"]'),'RESOURCE_BACK')
  })()`)
  const evidence=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   const panel=document.querySelector('[aria-label="AI 文献整理"]');panel.querySelector('summary').click()
   await wait(()=>[...panel.querySelectorAll('button')].some(b=>b.textContent==='查看依据'),'SUPPORT')
   ;[...panel.querySelectorAll('button')].find(b=>b.textContent==='查看依据').click()
   await wait(()=>document.querySelector('.evidence-basis')?.textContent.includes(${JSON.stringify(sourceNeedle)}),'EVIDENCE_READER')
   await wait(()=>document.querySelector('.reader-feedback')?.textContent.includes('标记'),'ORIGINAL_LOCATION_NOTICE')
   if(!document.querySelector('mark[id^=original-hit],.original-evidence-highlight'))throw new Error('ORIGINAL_HIGHLIGHT')
   return {originalHighlight:true,originalEvidence:true}
  })()`)
  const prefs=await backend.request('/v1/ai/preferences')
  await backend.request('/v1/ai/preferences','PUT',{...prefs,semantic_enabled:false,metadata_enabled:true})
  const credentials={chat:await providers.chatCredentials(),embedding:{key:'',version:0}}
  const task=await backend.request('/v1/ai/tasks','POST',{kind:'search',target_id:id,text:tag,request_id:randomUUID()},undefined,credentials)
  let search:any
  for(let i=0;i<100;i++){search=await backend.request(`/v1/ai/tasks/${task.id}`);if(!['running','queued'].includes(search.status))break;await new Promise(r=>setTimeout(r,100))}
  if(search.status!=='succeeded'||!search.result.items[0]?.snippet.includes(sourceNeedle))throw new Error('METADATA_SEARCH')
  await writeFile(join(folder,'enrichment.png'),(await window.webContents.capturePage()).toPNG())
  return {...proof,...evidence,confirmedTopic:true,docx,nullAndListResponse:true,metadataOriginalEvidence:true,modelCalls:calls,schema:22}
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
