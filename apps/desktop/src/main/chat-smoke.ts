import {createServer} from 'node:http'
import type {BrowserWindow} from 'electron'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {Providers} from './providers'

export async function runChatSmoke(window:BrowserWindow, providers:Providers, reportDir:string) {
 const received:unknown[]=[]
 const server=createServer((req,res)=>{
  let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{
   received.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'})
   res.write('data: '+JSON.stringify({choices:[{delta:{content:'Local fixture answer '}}]})+'\n\n')
   setTimeout(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:'[S1]'}}]})+'\n\n');res.end('data: [DONE]\n\n')},800)
  })
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try {
  const address=server.address() as {port:number}
  const config=(await providers.list()).find(c=>c.kind==='chat')
  await providers.save({kind:'chat',version:config?.version??0,base_url:`http://127.0.0.1:${address.port}`,model:'local-fixture',key:'local-fixture-key'})
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,100))}throw new Error('CHAT_UI_TIMEOUT')}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
   document.querySelector('[aria-label="关闭文献侧栏"]')?.click()
   await wait(()=>!document.querySelector('.workspace-panel-tabs'))
   document.querySelector('.chat-toggle').click()
   await wait(()=>document.querySelector('.chat-panel')&&!document.querySelector('.chat-panel').parentElement.hidden)
   const input=document.querySelector('textarea[aria-label="研究问题"]')
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'fixed English fixture')
   input.dispatchEvent(new Event('input',{bubbles:true}))
   await wait(()=>!button('准备本次证据').disabled)
   button('准备本次证据').click()
   await wait(()=>document.querySelector('.chat-evidence'))
   // Only select physical page 1 to make citation jump deterministic.
   for(const label of document.querySelectorAll('.chat-evidence'))if(!label.textContent.startsWith('物理页 1'))label.querySelector('input').click()
   const consent=[...document.querySelectorAll('.chat-panel label')].find(x=>x.textContent.includes('确认发送问题'))
   consent.querySelector('input').click()
   await wait(()=>!button('发送并生成回答').disabled)
   button('发送并生成回答').click()
   await wait(()=>document.querySelector('.chat-answer')?.textContent.includes('Local fixture answer'))
   await wait(()=>button('回答转笔记'))
   const source=button('[S1] · 第 1 页')
   if(!source)throw new Error('CITATION_MISSING')
   source.click()
   await wait(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 1 页'))
   document.querySelector('.chat-toggle').click()
   await wait(()=>button('回答转笔记'))
   const answer=document.querySelector('.chat-answer').textContent
   button('回答转笔记').click()
   await wait(()=>document.querySelector('.notes-heading h2')?.textContent==='笔记')
   await wait(()=>document.querySelector('.cm-content')?.textContent.includes('Local fixture answer'))
   return {answer,citationPage:1,noteImported:true}
  })()`)
  await writeFile(join(reportDir,'chat-smoke.json'),JSON.stringify({proof,requests:received.length,containsKeyInPayload:JSON.stringify(received).includes('local-fixture-key')},null,2))
  // Hidden Electron windows can retain an old compositor frame despite current DOM.
  window.showInactive()
  await new Promise(resolve=>setTimeout(resolve,800))
  await writeFile(join(reportDir,'chat-note.png'),(await window.webContents.capturePage()).toPNG())
  return proof
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
