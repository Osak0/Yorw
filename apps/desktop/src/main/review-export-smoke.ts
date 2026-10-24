import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {dialog,type BrowserWindow} from 'electron'
import {join,basename} from 'node:path'
import {writeFile,readFile} from 'node:fs/promises'
import type {Backend} from './backend'
import type {Providers} from './providers'

export async function runReviewExportSmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string){
 const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'# Draft\n\nFact [S1]'}}]})+'\n\ndata: [DONE]\n\n')})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const originalDialog=dialog.showSaveDialog
 try{
  const port=(server.address() as {port:number}).port
  const config=(await providers.list()).find(c=>c.kind==='chat')
  await providers.save({kind:'chat',version:config?.version??0,base_url:`http://127.0.0.1:${port}`,model:'local-review-fixture',key:'local-review-key'})
  const document=(await backend.request('/v1/documents')).items[0]
  const note=await backend.request('/v1/notes','POST',{id:randomUUID(),document_id:document.id,body_md:'Saved export note 中文\n'})
  const topic=await backend.request('/v1/topics','POST',{id:randomUUID(),title:'Review and export fixture',parent_id:null}),tid=topic.topic.id
  const selected=(await backend.request(`/v1/documents/${document.id}/search`,'POST',{query:'English'})).items[0]
  const generate=async(base:string)=>{
   const suggestion=await backend.request(`/v1/topics/${tid}/suggestions`,'POST',{base_revision_id:base,instruction:'Organize fixture',materials:[{kind:'document',id:document.id,version:String(selected.extraction_version),segment_ids:[selected.segment_id]}],request_id:randomUUID(),config_version:(await providers.list()).find(c=>c.kind==='chat')!.version},'local-review-key')
   for(let i=0;i<100;i++){const value=(await backend.request(`/v1/topics/${tid}/suggestions`)).items.find((s:any)=>s.id===suggestion.id);if(value.status==='completed')return value;await new Promise(resolve=>setTimeout(resolve,100))}
   throw new Error('DRAFT_TIMEOUT')
  }
  const suggestion=await generate(topic.revision.id)
  const run=(body:string)=>window.webContents.executeJavaScript(`(async()=>{
   const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('REVIEW_EXPORT_UI_TIMEOUT:'+${JSON.stringify(body.slice(0,80))})}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
   ${body}
  })()`)
  await run(`document.querySelector('nav button:nth-child(2)').click();await wait(()=>button('刷新目录'));button('刷新目录').click();await wait(()=>document.querySelector('[data-topic-id="${tid}"]'));document.querySelector('[data-topic-id="${tid}"]').click();await wait(()=>button('材料与 AI 草稿'));button('材料与 AI 草稿').click();await wait(()=>button('比较与处理建议'));const record=document.querySelector('.suggestion-record');record.open=true;button('比较与处理建议').click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'));const text=document.querySelector('[aria-label="确认后的正文"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,${JSON.stringify('# Reviewed Wiki\n\nEdited fact [S1]')});text.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelector('[aria-label="确认后的正文"]').value.includes('Edited'));document.querySelector('.wiki-review input[type="checkbox"]').click();await wait(()=>!button('确认采纳并保存修订').disabled);`)
  window.showInactive();await run(`document.querySelector('.wiki-review').scrollIntoView({block:'center'})`);await writeFile(join(reportDir,'review-comparison.png'),(await window.webContents.capturePage()).toPNG())
  await run(`button('确认采纳并保存修订').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'));await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 2'))`)
  const accepted=await backend.request(`/v1/topics/${tid}`)
  if(!accepted.revision.body_md.includes('Edited fact [S1]')||accepted.revision.origin!=='ai_accepted'||accepted.revision.sources.length!==1)throw new Error('ACCEPT_MISMATCH')
  await run(`button('查看修订历史').click();await wait(()=>document.querySelector('[aria-label="历史修订"]'));const select=document.querySelector('[aria-label="历史修订"]');select.value='${topic.revision.id}';select.dispatchEvent(new Event('change',{bubbles:true}));button('比较并回退此修订').click();await wait(()=>button('确认回退为新修订'));button('确认回退为新修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 3'))`)
  const restored=await backend.request(`/v1/topics/${tid}`)
  if(restored.revision.body_md!==''||restored.revision.restored_from_id!==topic.revision.id)throw new Error('RESTORE_MISMATCH')
  // Restore the accepted source snapshot for export, then reject another completed draft.
  const final=(await backend.request(`/v1/topics/${tid}/revisions/${accepted.revision.id}/restore`,'POST',{request_id:randomUUID(),base_revision_id:restored.revision.id})).view
  const rejected=await generate(final.revision.id)
  await run(`window.confirm=()=>true;await wait(()=>document.querySelectorAll('.suggestion-record').length===2);const records=[...document.querySelectorAll('.suggestion-record')];const record=records[records.length-1];record.open=true;record.querySelector('button').click();await wait(()=>button('拒绝此建议'));button('拒绝此建议').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'));`)
  if((await backend.request(`/v1/topics/${tid}/suggestions`)).items.find((s:any)=>s.id===rejected.id).decision?.action!=='reject')throw new Error('REJECT_MISSING')
  await run(`document.querySelector('nav button:nth-child(3)').click();await wait(()=>document.querySelector('.workspace-location'));await wait(()=>document.querySelectorAll('.export-choices input').length>=2);const section=document.querySelector('.workspace-panel');const labels=[...section.querySelectorAll('label')];labels.find(l=>l.textContent.includes('Saved export note')).querySelector('input').click();labels.find(l=>l.textContent.includes('Review and export fixture')).querySelector('input').click()`)
  dialog.showSaveDialog=(async()=>({canceled:true,filePath:''})) as typeof originalDialog
  await run(`await wait(()=>!button('创建快照并导出 ZIP').disabled);button('创建快照并导出 ZIP').click();await wait(()=>document.querySelector('.workspace-panel [role="status"]').textContent.includes('已取消保存'))`)
  const output=join(reportDir,'..',basename(reportDir)+'-saved-content.zip')
  dialog.showSaveDialog=(async()=>({canceled:false,filePath:output})) as typeof originalDialog
  await run(`await wait(()=>!button('再次保存这份快照').disabled);button('再次保存这份快照').click();await wait(()=>document.querySelector('.workspace-panel [role="status"]').textContent.includes('ZIP 已保存'))`)
  const bytes=await readFile(output);if(bytes[0]!==80||bytes[1]!==75)throw new Error('ZIP_NOT_SAVED')
  const layouts=[]
  for(const [width,height] of [[1440,1024],[1024,768]]){
   window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,500));await run(`document.querySelector('.workspace-panel').scrollIntoView({block:'center'})`)
   const layout=await window.webContents.executeJavaScript(`({width:innerWidth,fits:document.documentElement.scrollWidth<=innerWidth})`);layouts.push(layout)
   await writeFile(join(reportDir,`house-export-${width}.png`),(await window.webContents.capturePage()).toPNG())
  }
  if(layouts.some(l=>!l.fits))throw new Error('HOUSE_OVERFLOW')
  await writeFile(join(reportDir,'review-export-smoke.json'),JSON.stringify({topic:tid,note:note.id,accepted:accepted.revision.id,restored:restored.revision.id,final:final.revision.id,rejected:rejected.id,suggestion:suggestion.id,exportPath:output,exportBytes:bytes.length,cancelThenSave:true,layouts},null,2))
 }finally{dialog.showSaveDialog=originalDialog;await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
