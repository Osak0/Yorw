import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'

/** No external parser programs. Only a local protocol fixture for chat. */
export async function runBuiltinReadingSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 window.webContents.setBackgroundThrottling(false)
 const server=createServer((request,response)=>{let raw='';request.on('data',data=>raw+=data);request.on('end',()=>{
  try{
   const body=JSON.parse(raw),system=body.messages[0].content,data=JSON.parse(body.messages[1].content)
   let text='Self-written fixture evidence [S1].'
   if(system.includes('筛选器')){const query=JSON.parse(data.question);text=JSON.stringify({items:query.candidates.map((item:{id:string})=>({id:item.id,sentence:0}))})}
   else if(system.includes('改写'))text=JSON.stringify({query:'self-written fixture'})
   response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
  }catch{response.writeHead(500);response.end()}
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const address=server.address();if(!address||typeof address==='string')throw new Error('MODEL_FIXTURE')
  await providers.save({kind:'chat',base_url:`http://127.0.0.1:${address.port}`,model:'owned-fixture',key:'fixture-key',clear_key:false,version:0})
  const settings=await backend.request('/v1/parsers')
  if(settings.settings.docling_executable||settings.settings.libreoffice_executable)throw new Error('EXPECTED_NO_COMPONENT_CONFIG')
  for(const name of ['fixture.docx','fixture.md','fixture.txt']){const bytes=await readFile(join(folder,name)),form=new FormData();form.append('file',new Blob([bytes]),name);await backend.request('/v1/documents/import','POST',form)}
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   const click=async text=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent===text&&!x.closest('[hidden]'));if(!button)throw new Error('BUTTON:'+text);button.click();await new Promise(r=>setTimeout(r,100))}
   const input=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))}
   await click('Storage')
   await wait(()=>[...document.querySelectorAll('.document-row')].some(x=>x.textContent.includes('fixture.docx')),'DOCX_ROW')
   const row=[...document.querySelectorAll('.document-row')].find(x=>x.textContent.includes('fixture.docx'));[...row.querySelectorAll('button')].find(x=>x.textContent==='打开阅读').click()
   await wait(()=>document.querySelector('.docx-original')?.textContent.includes('self-written'),'BUILTIN_DOCX')
   if(!document.querySelector('.docx-original table'))throw new Error('ORIGINAL_TABLE')
   if(document.querySelector('.original-reader input,.original-reader textarea,[contenteditable=true]'))throw new Error('EDITABLE_ORIGINAL')
   await click('版式预览（可选）');await wait(()=>document.querySelector('.reader-feedback')?.textContent.includes('需要可选 LibreOffice'),'OPTIONAL_HINT')
   if(!document.querySelector('.docx-original'))throw new Error('OPTIONAL_BLOCKED_BASELINE')
   const reader=document.querySelector('.original-reader');[...reader.querySelectorAll('button')].find(x=>x.textContent==='检索').click()
   await wait(()=>document.querySelector('[aria-label="文献内检索"]'),'SEARCH_INPUT');input('[aria-label="文献内检索"]','self-written');await click('搜索')
   await wait(()=>document.querySelector('.search-hit'),'SEARCH_RESULT');document.querySelector('.search-hit button:last-child').click()
   await wait(()=>document.querySelector('.evidence-basis')?.textContent.includes('self-written'),'SEARCH_BASIS')
   await wait(()=>document.querySelector('.original-evidence-highlight'),'ORIGINAL_MATCH')
   ;[...reader.querySelectorAll('button')].find(x=>x.textContent==='问答').click()
   await wait(()=>document.querySelector('[aria-label="研究问题"]'),'CHAT_INPUT');input('[aria-label="研究问题"]','self-written fixture');await click('发送')
   await wait(()=>document.querySelector('.chat-citations button'),'CHAT_SOURCE');document.querySelector('.chat-citations button').click()
   await wait(()=>document.querySelector('.evidence-basis')?.textContent.includes('self-written'),'CHAT_BASIS')
   await wait(()=>!document.querySelector('.chat-message.running')&&![...document.querySelectorAll('.chat-panel button')].some(x=>x.textContent==='停止'),'CHAT_COMPLETED')
   return {withoutParserComponents:true,originalDocx:true,table:true,readOnly:true,optionalHint:true,searchEvidence:true,originalHighlight:true,chatEvidence:true}
  })()`)
  await writeFile(join(folder,'builtin-reading.png'),(await window.webContents.capturePage()).toPNG())
  return proof
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
