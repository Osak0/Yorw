import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {writeFile} from 'node:fs/promises'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'
import type {Suggestion, TopicView} from '../shared/status'

/** Owned loopback provider and workspace only; never uses the user's real key. */
export async function runDraftRecoverySmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string){
 const calls:any[]=[]
 let mode:'complete'|'partial'='complete'
 const server=createServer((req,res)=>{
  let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
   const payload=JSON.parse(raw);calls.push(payload)
   const continuing=payload.messages.length===4
   const content=continuing?' Continuation [S1].':'# Draft recovery\n\nPartial evidence [S1].'
   const finish=continuing&&mode==='complete'?'stop':'length'
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   res.end('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const previous=(await providers.list()).find(c=>c.kind==='chat')
  await providers.save({kind:'chat',version:previous?.version??0,base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:'local-recovery-fixture',key:'recovery-fixture-key'})
  const doc=(await backend.request('/v1/documents')).items[0]
  const selected=(await backend.request(`/v1/documents/${doc.id}/search`,'POST',{query:'English'})).items[0]
  const generate=async(title:string)=>{
   const view:TopicView=await backend.request('/v1/topics','POST',{id:randomUUID(),title,parent_id:null})
   const payload={topic_id:view.topic.id,base_revision_id:view.revision.id,instruction:'Organize this evidence',materials:[{kind:'document',id:doc.id,version:String(selected.extraction_version),segment_ids:[selected.segment_id]}],request_id:randomUUID(),config_version:(await providers.list()).find(c=>c.kind==='chat')!.version}
   const result=await window.webContents.executeJavaScript(`window.yorw.suggestions.generate(${JSON.stringify(payload)})`)
   if(!result.ok)throw new Error('RECOVERY_SUBMISSION_FAILED')
   for(let i=0;i<150;i++){
    const draft:Suggestion=(await backend.request(`/v1/topics/${view.topic.id}/suggestions`)).items[0]
    if(draft.status!=='running')return {view,draft}
    await new Promise(resolve=>setTimeout(resolve,100))
   }
   throw new Error('RECOVERY_DRAFT_TIMEOUT')
  }
  const completed=await generate('Recovered automatically')
  if(completed.draft.status!=='completed'||!completed.draft.body_md.includes('Continuation'))throw new Error('CONTINUATION_NOT_COMPLETED')
  mode='partial'
  const partial=await generate('Editable incomplete draft'),tid=partial.view.topic.id
  if(partial.draft.status!=='partial'||!partial.draft.recoverable)throw new Error('PARTIAL_NOT_RECOVERABLE')
  if(calls.length!==4||calls.some(call=>call.max_tokens!==8192)||JSON.stringify(calls).includes('recovery-fixture-key'))throw new Error('RECOVERY_REQUEST_CONTRACT')
  const run=(body:string)=>window.webContents.executeJavaScript(`(async()=>{
   const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('RECOVERY_UI_TIMEOUT')}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
   ${body}
  })()`)
  await run(`document.querySelector('nav button:nth-child(2)').click();await wait(()=>button('刷新目录'));button('刷新目录').click();await wait(()=>document.querySelector('[data-topic-id="${tid}"]'));document.querySelector('[data-topic-id="${tid}"]').click();await wait(()=>button('材料与 AI 草稿'));button('材料与 AI 草稿').click();await wait(()=>button('编辑并补全草稿'));if(!document.querySelector('.suggestion-record summary').textContent.includes('草稿未完成'))throw new Error('RECOVERY_LABEL');button('编辑并补全草稿').click();await wait(()=>document.querySelector('[aria-label="确认后的正文"]'))`)
  const reviewed='# 人工补全的专题\n\nReviewed original evidence [S1].'
  await run(`const input=document.querySelector('[aria-label="确认后的正文"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(reviewed)});input.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelector('[aria-label="确认后的正文"]').value.includes('Reviewed'));document.querySelector('.wiki-review input[type="checkbox"]').click();await wait(()=>!button('确认采纳并保存修订').disabled)`)
  const layouts=[]
  for(const [width,height] of [[1440,1024],[1024,768]]){
   window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,500))
   await run(`document.querySelector('[aria-label="确认后的正文"]').scrollIntoView({block:'center'})`)
   const layout=await window.webContents.executeJavaScript(`({width:innerWidth,fits:document.documentElement.scrollWidth<=innerWidth})`)
   layouts.push(layout)
   await writeFile(join(reportDir,`draft-recovery-${width}.png`),(await window.webContents.capturePage()).toPNG())
  }
  if(layouts.some(layout=>!layout.fits))throw new Error('RECOVERY_LAYOUT_OVERFLOW')
  await run(`button('确认采纳并保存修订').click();await wait(()=>!document.querySelector('[aria-label="确认后的正文"]'));await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 2'))`)
  const saved:TopicView=await backend.request(`/v1/topics/${tid}`)
  const retained:Suggestion=(await backend.request(`/v1/topics/${tid}/suggestions`)).items[0]
  if(saved.revision.body_md!==reviewed||saved.revision.sources.length!==1||retained.status!=='partial'||retained.error_code!=='OUTPUT_TRUNCATED'||retained.body_md!==partial.draft.body_md)throw new Error('RECOVERY_SAVE_CONTRACT')
  await writeFile(join(reportDir,'draft-recovery-smoke.json'),JSON.stringify({result:'passed',requests:calls.length,automaticCompletion:completed.draft.status,incompleteStatus:retained.status,originalError:retained.error_code,originalOutputPreserved:true,editedBodySaved:true,sourceCount:saved.revision.sources.length,layouts},null,2))
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
