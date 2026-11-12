import {createServer} from 'node:http'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'

/** Isolated UI regression; local protocol fixture only, no remote model. */
export async function runHistoryLayoutSmoke(window:BrowserWindow,backend:Backend,providers:Providers,report:string){
 const prefs=await backend.request('/v1/ai/preferences')
 await backend.request('/v1/ai/preferences','PUT',{...prefs,semantic_enabled:false})
 const proof=await window.webContents.executeJavaScript(`(async()=>{
  const wait=async(fn,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  const input=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))}
  button('检索').click();await wait(()=>document.querySelector('.search-panel-reader'),'READER_SEARCH')
  if(button('检索历史')||document.querySelector('.search-history-sidebar'))throw Error('HISTORY_IN_READER')
  const field=()=>document.querySelector('[aria-label="文献内检索"]')
  input(field(),'English evidence');button('搜索').click();await wait(()=>document.querySelector('.search-hit'),'SEARCH_RESULT')
  button('展开为标签').click();await wait(()=>document.querySelector('.search-panel-detailed'),'DETAILED_SEARCH')
  await wait(()=>document.querySelector('.search-history-select'),'HISTORY_LOADED')
  const old=await window.yorw.resources.searchHistory((await window.yorw.documents.list()).value.items[0].id)
  document.querySelector('.search-history-select').click();await wait(()=>document.querySelector('.search-snapshot'),'SNAPSHOT')
  const count=old.value.items.length
  if((await window.yorw.resources.searchHistory((await window.yorw.documents.list()).value.items[0].id)).value.items.length!==count)throw Error('VIEW_RERAN_SEARCH')
  const form=document.querySelector('.search-topbar').getBoundingClientRect(), sidebar=document.querySelector('.search-history-sidebar').getBoundingClientRect(),results=document.querySelector('.search-results').getBoundingClientRect()
  if(form.bottom>results.top+1||sidebar.right>results.left+1||results.height<200)throw Error('SEARCH_GEOMETRY')
  input(field(),'');await new Promise(r=>setTimeout(r,100))
  field().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))
  await wait(()=>!document.querySelector('.search-hit'),'EMPTY_ENTER_CLEAR')
  await new Promise(r=>setTimeout(r,2200))
  if(document.querySelector('.search-hit'))throw Error('CLEARED_RESULTS_REAPPEARED')
  if((await window.yorw.resources.searchHistory((await window.yorw.documents.list()).value.items[0].id)).value.items.length!==count)throw Error('CLEAR_DELETED_HISTORY')
  document.querySelector('.search-history-select').click();await wait(()=>document.querySelector('.search-hit'),'RESTORE_SNAPSHOT')
  button('检索历史').click();await wait(()=>!document.querySelector('.search-history-sidebar'),'COLLAPSED')
  button('检索历史').click();await wait(()=>document.querySelector('.search-history-sidebar'),'REOPENED')
  return {emptyEnterClears:true,clearPreservesHistory:true,readerHasNoHistory:true,snapshotNoModelCall:true,leftSidebar:true,fixedTopbar:true,resultsHeight:results.height,collapsible:true}
 })()`)
 for(const width of [1024,1280,1440]){
  window.setContentSize(width,768);await new Promise(r=>setTimeout(r,200))
  const fits=await window.webContents.executeJavaScript(`document.querySelector('.search-results').clientHeight>200&&document.documentElement.scrollWidth<=innerWidth`)
  if(!fits)throw Error('SEARCH_LAYOUT_'+width)
  await writeFile(join(report,'search-history-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
 }
 const server=createServer((req,res)=>{let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{
  const body=JSON.parse(raw),system=body.messages[0].content,data=JSON.parse(body.messages[1].content)
  let text='Fixture history answer with visual evidence [S1].'
  if(system.includes('筛选器')){const value=JSON.parse(data.question);text=JSON.stringify({items:value.candidates.map((v:{id:string})=>({id:v.id,sentence:0}))})}
  else if(system.includes('改写'))text=JSON.stringify({query:'English evidence'})
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const old=(await providers.list()).find(c=>c.kind==='chat')
  await providers.save({kind:'chat',version:old?.version??0,base_url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,model:'history-fixture',key:'fixture'})
  const chatProof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
   const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
   const tab=[...document.querySelectorAll('.workspace-tab')].find(t=>t.querySelector('.workspace-tab-kind')?.textContent==='文献');tab.click()
   await wait(()=>button('问答'),'READER');button('问答').click();await wait(()=>document.querySelector('.chat-panel'),'CHAT')
   const id=(await window.yorw.documents.list()).value.items[0].id
   await window.yorw.ai.run({kind:'chat',target_id:id,text:'English evidence',request_id:crypto.randomUUID()})
   await wait(()=>document.querySelector('.chat-answer')?.textContent.includes('Fixture history answer'),'ANSWER')
   const field=document.querySelector('[aria-label="搜索当前文献问答"]')
   if(!field||field.closest('details'))throw Error('FOLDED_SEARCH')
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'visual evidence');field.dispatchEvent(new Event('input',{bubbles:true}))
   await wait(()=>document.querySelector('.chat-search-matches button'),'MATCH')
   document.querySelector('.chat-search-matches button').click();await wait(()=>document.querySelector('.history-match'),'HIGHLIGHT')
   await new Promise(r=>setTimeout(r,2200))
   if(document.querySelector('.history-match'))throw Error('PERMANENT_HIGHLIGHT')
   button('展开为标签').click();await wait(()=>document.querySelector('.chat-header-search input'),'HEADER_SEARCH')
   const search=document.querySelector('.chat-header-search input'),read=[...document.querySelectorAll('.document-tool-actions button')].find(b=>b.textContent==='打开阅读')
   if(search.getBoundingClientRect().right>read.getBoundingClientRect().left)throw Error('HEADER_ORDER')
   if(document.querySelector('.chat-panel').textContent.includes('搜索问答记录'))throw Error('REDUNDANT_SEARCH_LABEL')
   return {headerSearch:true,searchBeforeRead:true,searchAlwaysVisible:true,bodySearch:true,highlightCleared:true}
  })()`)
  await writeFile(join(report,'chat-search.png'),(await window.webContents.capturePage()).toPNG())
  return {...proof,...chatProof}
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
