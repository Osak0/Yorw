import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import type {BrowserWindow} from 'electron'
import {join} from 'node:path'
import {writeFile} from 'node:fs/promises'
import type {Backend} from './backend'
import type {Providers} from './providers'

export async function runSuggestionsSmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string){
 const calls:unknown[]=[]
 const server=createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{
  calls.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'# Wiki fixture\n\n原文事实 [S1]。'}}]})+'\n\n')
  setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'个人观点 [S2]。'}}]})+'\n\ndata: [DONE]\n\n'),650)
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const port=(server.address() as {port:number}).port
  const config=(await providers.list()).find(c=>c.kind==='chat')
  await providers.save({kind:'chat',version:config?.version??0,base_url:`http://127.0.0.1:${port}`,model:'local-wiki-fixture',key:'local-fixture-key'})
  const document=(await backend.request('/v1/documents')).items[0]
  await backend.request('/v1/notes','POST',{id:randomUUID(),document_id:document.id,body_md:'User hypothesis fixture: model reliability needs testing.'})
  const topic=await backend.request('/v1/topics','POST',{id:randomUUID(),title:'Wiki suggestion fixture',parent_id:null})
  const run=(body:string)=>window.webContents.executeJavaScript(`(async()=>{
   const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('SUGGESTION_UI_TIMEOUT')}
   const button=text=>[...document.querySelectorAll('.garden-workspace button')].find(b=>b.textContent===text)
   ${body}
  })()`)
  await run(`document.querySelector('nav button:nth-child(2)').click();await wait(()=>button('刷新目录'));button('刷新目录').click();await wait(()=>document.querySelector('[data-topic-id="${topic.topic.id}"]'));document.querySelector('[data-topic-id="${topic.topic.id}"]').click();await wait(()=>document.querySelector('.garden-editor .cm-content'));document.querySelector('.garden-editor .cm-content').focus()`)
  await window.webContents.insertText('Manual unsaved Wiki draft')
  await run(`button('材料与 AI 草稿').click();await wait(()=>document.querySelector('.wiki-suggestions'));const details=[...document.querySelectorAll('.wiki-suggestions details')];details[0].querySelector('summary').click();details[1].querySelector('summary').click();await wait(()=>document.querySelector('[aria-label="选材论文"] option[value="${document.id}"]'));const select=document.querySelector('[aria-label="选材论文"]');select.value='${document.id}';select.dispatchEvent(new Event('change',{bubbles:true}));const input=document.querySelector('[aria-label="选材检索条件"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'English');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>!button('检索选材片段').disabled);button('检索选材片段').click();await wait(()=>document.querySelector('.material-choice input'));document.querySelector('.material-choice input').click();const note=[...document.querySelectorAll('.wiki-suggestions label')].find(x=>x.textContent.includes('User hypothesis fixture'));if(!note)throw new Error('NOTE_MATERIAL_MISSING');note.querySelector('input').click();await wait(()=>!button('预览发送材料').disabled);button('预览发送材料').click();await wait(()=>document.querySelector('.material-preview'));if(document.querySelectorAll('.material-preview .suggestion-sources>details').length!==2)throw new Error('PREVIEW_SCOPE');const label=[...document.querySelectorAll('.material-preview label')].find(x=>x.textContent.includes('确认发送'));label.querySelector('input').click();await wait(()=>!button('生成建议草稿').disabled);button('生成建议草稿').click();await wait(()=>[...document.querySelectorAll('.suggestion-record summary')].some(x=>x.textContent.includes('草稿已完成')));const record=document.querySelector('.suggestion-record');if(!record.open)record.querySelector('summary').click();if(!document.querySelector('.garden-editor .cm-content').textContent.includes('Manual unsaved Wiki draft'))throw new Error('MANUAL_DRAFT_OVERWRITTEN')`)
  const unchanged=await backend.request(`/v1/topics/${topic.topic.id}`)
  if(unchanged.revision.id!==topic.revision.id||unchanged.revision.body_md!=='')throw new Error('WIKI_BODY_OVERWRITTEN')
  const drafts=(await backend.request(`/v1/topics/${topic.topic.id}/suggestions`)).items
  const layouts=[];window.showInactive()
  for(const [width,height] of [[1440,1024],[1024,768]]){
   window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,650))
   const layout=await window.webContents.executeJavaScript(`({width:innerWidth,fits:[...document.querySelectorAll('.wiki-suggestions input,.wiki-suggestions select,.wiki-suggestions button')].filter(x=>x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})})`)
   layouts.push(layout);await window.webContents.executeJavaScript(`document.querySelector('.suggestion-record').scrollIntoView({block:'center'})`);await new Promise(resolve=>setTimeout(resolve,200));await writeFile(join(reportDir,`suggestions-${width}.png`),(await window.webContents.capturePage()).toPNG())
  }
  if(layouts.some(l=>!l.fits))throw new Error('SUGGESTION_OVERFLOW')
  await run(`button('保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 2'))`)
  const proof={materials:drafts[0].sources.length,draftStatus:drafts[0].status,bodyUnchanged:true,manualDraftPreserved:true,citations:drafts[0].citations,requests:calls.length,keyInPayload:JSON.stringify(calls).includes('local-fixture-key'),layouts}
  await writeFile(join(reportDir,'suggestions-smoke.json'),JSON.stringify(proof,null,2))
  return proof
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
