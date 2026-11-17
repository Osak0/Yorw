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
   calls++;const body=JSON.parse(raw),input=JSON.parse(body.messages[1].content),question=input.question?JSON.parse(input.question):input
   contextSeen ||= question.current_metadata?.summary_md==='Original user summary'
   const value=question.blocks?{summary_md:'Synthetic summary based on the original evidence. '.repeat(24),tags:['shared','Proposed'],title:'Suggested document title',authors:[],year:null,evidence_ids:question.blocks.map((b:{id:string})=>b.id)}:{related:[],topics:[],new_topics:[]}
   response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(value)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  }catch{response.writeHead(500);response.end()}
 })})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try{
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('FIXTURE_SERVER')
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${addr.port}`,model:'metadata-review-fixture',key:'fixture-key',version:0})
  let record=(await backend.request('/v1/documents')).items[0]
  record=await backend.request('/v1/documents/'+record.id,'PATCH',{version:record.version,title:'Original title',authors:['Existing author'],year:2024,tags:['Shared'],summary_md:'Original user summary'})
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('SELECTION_'+label)}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text)
   const click=async text=>{await wait(()=>button(text)&&!button(text).disabled,text);button(text).click()}
   await click('编辑元数据');await wait(()=>button('AI 辅助文献整理'),'metadata')
   await click('AI 辅助文献整理');await wait(()=>document.querySelector('[aria-label="AI 生成记录"]'),'auto-result')
   const count=document.querySelector('[aria-label="AI 生成记录"]').options.length
   if(count!==1)throw Error('AUTO_DUPLICATE')
   const labels=['标题','作者','年份','关键词／标签','总结']
   for(const label of labels)if(!document.querySelector('[aria-label="添加'+label+'"]'))throw Error('MISSING_FIELD_'+label)
   if(document.querySelector('[aria-label="添加相关文献"], [aria-label="添加所属专题"]')||!document.querySelector('.collaboration-entry'))throw Error('RELATION_PREVIEW_BOUNDARY')
   if(!document.querySelector('.enrichment-suggestions').textContent.includes('缺少信息'))throw Error('MISSING_EMPTY_STATE')
   const host=document.querySelector('.enrichment-tool')
   if(host.scrollHeight<=host.clientHeight)throw Error('NO_VERTICAL_SCROLL')
   host.scrollTop=host.scrollHeight
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
   const bottom=host.querySelector('.enrichment-panel').getBoundingClientRect().bottom
   if(bottom>host.getBoundingClientRect().bottom+1)throw Error('CLIPPED_BOTTOM')
   if(document.querySelector('.enrichment-panel dl'))throw Error('LEGACY_SECTIONS')
   if(document.querySelector('.enrichment-suggestions input[type="checkbox"]'))throw Error('CHECKBOX_REMAINS')
   await click('添加关键词／标签');await wait(()=>document.querySelector('.enrichment-panel').textContent.includes('已添加关键词／标签'),'add-tags')
   await click('添加总结');await wait(()=>document.querySelector('.enrichment-panel').textContent.includes('已添加总结'),'add-summary')
   const stateBefore=(await window.yorw.enrichment.view({id:${JSON.stringify(record.id)}})).value
   await click('全部添加');await wait(()=>document.querySelector('.enrichment-panel').textContent.includes('已全部添加可用建议'),'bulk-add')
   const stateAdded=(await window.yorw.enrichment.view({id:${JSON.stringify(record.id)}})).value
   if(stateAdded.metadata.title!==stateBefore.metadata.title||JSON.stringify(stateAdded.metadata.authors)!==JSON.stringify(stateBefore.metadata.authors)||stateAdded.metadata.year!==2024)throw Error('BULK_ADD_CHANGED_FILLED_OR_EMPTY')
   const confirm=window.confirm;window.confirm=()=>false
   await click('全部替换');await new Promise(r=>setTimeout(r,180))
   if((await window.yorw.enrichment.view({id:${JSON.stringify(record.id)}})).value.document_version!==stateAdded.document_version)throw Error('BULK_CANCEL_CHANGED')
   window.confirm=()=>true
   await click('全部替换');await wait(()=>document.querySelector('.enrichment-panel').textContent.includes('已全部替换可用建议'),'bulk-replace')
   window.confirm=confirm
   const stateReplaced=(await window.yorw.enrichment.view({id:${JSON.stringify(record.id)}})).value
   if(stateReplaced.metadata.title!=='Suggested document title'||stateReplaced.metadata.authors.join(',')!=='Existing author'||stateReplaced.metadata.year!==2024)throw Error('BULK_REPLACE_MISSING_INFO')
   window.confirm=()=>true
   await click('替换标题');await wait(()=>document.querySelector('.enrichment-panel').textContent.includes('已替换标题'),'replace-title');window.confirm=confirm
   await click('隐藏本条结果');await wait(()=>button('恢复显示完整结果'),'hidden')
   await click('恢复显示完整结果');await wait(()=>document.querySelector('[aria-label="添加标题"]'),'restored')
   const tab=[...document.querySelectorAll('.workspace-tab')].find(t=>t.textContent.includes('编辑元数据'))
   tab.click();await wait(()=>button('AI 辅助文献整理'),'return')
   await click('AI 辅助文献整理');await wait(()=>document.querySelector('[aria-label="AI 生成记录"]'),'reopen')
   if(document.querySelector('[aria-label="AI 生成记录"]').options.length!==1)throw Error('REOPEN_GENERATED')
   return {fiveMetadataFields:true,relationsUseProposal:true,missingInfo:true,scrollReachable:true,noLegacySections:true,autoGeneratedOnce:true,perFieldButtons:true,checkboxesRemoved:true,bulkAdd:true,bulkReplace:true,bulkReplaceCancelled:true,missingSuggestionsSkipped:true,added:true,replaced:true,history:true,restore:true,reopenReused:true}
  })()`)
  await writeFile(join(folder,'metadata-selection.png'),(await window.webContents.capturePage()).toPNG())
  for(const width of [1024,1280,1440]){
   window.setContentSize(width,768)
   await new Promise(r=>setTimeout(r,180))
   const fits=await window.webContents.executeJavaScript(`(async()=>{
    const host=document.querySelector('.enrichment-tool');host.scrollTop=host.scrollHeight
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    return host.scrollHeight>host.clientHeight && document.querySelector('.enrichment-panel').getBoundingClientRect().bottom<=host.getBoundingClientRect().bottom+1 && document.documentElement.scrollWidth<=innerWidth
   })()`)
   if(!fits)throw Error('METADATA_SCROLL_LAYOUT_'+width)
   await writeFile(join(folder,'metadata-bottom-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
  }
  const current=await backend.request('/v1/documents/'+record.id)
  if(!current.tags.includes('Proposed')||!current.summary_md.includes('Synthetic summary'))throw Error('CANONICAL_METADATA')
  return {...proof,metadataInPrompt:contextSeen,modelCalls:calls,schema:(await backend.request('/v1/health')).schema_version}
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
