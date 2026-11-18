import {createServer} from 'node:http'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Owned PDF and SSE fixtures: verify visible highlighting and failed-turn follow-up context. */
export async function runChatMemorySmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 let answerCalls=0,contextSeen=false,plainQuestion=false
 const server=createServer((request,response)=>{let raw='';request.on('data',d=>raw+=d);request.on('end',()=>{
  try{
   const payload=JSON.parse(raw),system=payload.messages[0].content,user=payload.messages.find((m:{role:string})=>m.role==='user')
   const data=JSON.parse(user.content)
   let text='',finish='stop'
   if(system.includes('改写'))text=JSON.stringify({query:'English evidence'})
   else if(system.includes('压缩当前'))text=JSON.stringify({summary_md:'User asks about fixture evidence and completing an interrupted answer.'})
   else{
    answerCalls++
    const context=payload.messages.filter((m:{role:string})=>m.role==='system').slice(1).map((m:{content:string})=>m.content).join('')
    if(answerCalls>1){contextSeen=context.includes('First unfinished answer')&&context.includes('English evidence');plainQuestion=data.question==='请回答完全'}
    text=answerCalls===1?'First unfinished answer [S1].':'Completed follow-up answer [S1].'
    if(answerCalls===1)finish='length'
   }
   response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n')
  }catch{response.writeHead(500);response.end()}
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('FIXTURE_ADDRESS')
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${address.port}`,model:'history-owned-fixture',key:'fixture',version:0})
  const prefs=await backend.request('/v1/ai/preferences');await backend.request('/v1/ai/preferences','PUT',{...prefs,semantic_enabled:false})
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
   const input=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
   button('检索').click();await wait(()=>document.querySelector('[aria-label="文献内检索"]'),'SEARCH')
   input(document.querySelector('[aria-label="文献内检索"]'),'English evidence');button('搜索').click()
   await wait(()=>document.querySelector('.search-hit'),'HITS')
   document.querySelector('.search-hit button:last-child').click()
   await wait(()=>document.querySelector('.pdf-evidence-highlight'),'PDF_HIGHLIGHT')
   button('问答').click();await wait(()=>document.querySelector('.chat-panel'),'CHAT')
   button('展开为标签').click();await wait(()=>document.querySelector('.document-tool-actions'),'CHAT_TAB')
   if(button('打开阅读')||!button('返回阅读侧栏')||!button('查看 History.md'))throw Error('TOOL_NAVIGATION')
   const id=(await window.yorw.documents.list()).value.items[0].id
   await window.yorw.ai.run({kind:'chat',target_id:id,text:'English evidence',request_id:crypto.randomUUID()})
   await wait(async()=>{const r=await window.yorw.chat.list(id);return r.value.items.some(m=>m.status==='failed'&&m.error_code==='OUTPUT_TRUNCATED')},'PARTIAL_FIXTURE')
   await window.yorw.ai.run({kind:'chat',target_id:id,text:'请回答完全',request_id:crypto.randomUUID()})
   await wait(async()=>{const r=await window.yorw.chat.list(id);return r.value.items.some(m=>m.status==='completed'&&m.body_md.includes('Completed follow-up'))},'FOLLOWUP_COMPLETED')
   button('查看 History.md').click();await wait(()=>document.querySelector('.chat-memory-content').textContent.includes('Completed follow-up'),'HISTORY_VIEW')
   const memory=await window.yorw.chat.history(id)
   if(!memory.ok||memory.value.token_estimate>memory.value.token_limit||!memory.value.export_available)throw Error('MEMORY_BUDGET_EXPORT')
   return {pdfHighlight:true,failedPartialRetained:true,followupCompleted:true,headerActions:true,historyViewer:true,historyExport:true,tokenEstimate:memory.value.token_estimate}
  })()`)
  await writeFile(join(folder,'chat-memory.png'),(await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.chat-memory-dialog header button:last-child').click()`)
  await writeFile(join(folder,'chat-memory-toolbar.png'),(await window.webContents.capturePage()).toPNG())
  if(!contextSeen||!plainQuestion)throw Error('SYSTEM_CONTEXT_NOT_SENT')
  return {...proof,systemContextBeforeUser:contextSeen,plainQuestion,answerCalls}
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
