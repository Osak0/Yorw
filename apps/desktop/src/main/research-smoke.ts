import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'
export async function runResearchSmoke(window:BrowserWindow,backend:Backend,providers:Providers,folder:string){
 let requests=0
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const data=JSON.parse(Buffer.concat(chunks).toString());requests++
  const results=data.messages.filter((m:any)=>m.role==='tool'),actual=!!data.tools.find((t:any)=>t.function.name==='read_local').function.parameters.properties.handle
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n')
  if(results.length<2){const name=results.length?'read_local':'search_local';let args:any={query:'fixture'}
   if(results.length){const found=JSON.parse(results[0].content).items[0];args=actual?{handle:found.handle}:{id:found.id}}
   const raw=JSON.stringify(args);emit({tool_calls:[{index:0,id:'call-'+results.length,type:'function',function:{name,arguments:raw.slice(0,3)}}]});emit({tool_calls:[{index:0,function:{arguments:raw.slice(3)}}]},'tool_calls')
  }else{emit({content:actual?'The original fixture evidence supports this answer ':'violet-42 '});await new Promise(r=>setTimeout(r,180));emit({content:'[S1].'},'stop')}
  res.end('data: [DONE]\n\n')
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const addr=server.address() as {port:number};const profile=await providers.profileSave({id:randomUUID(),name:'研究协议夹具',provider:'compatible',base_url:`http://127.0.0.1:${addr.port}`,model:'research-fixture',version:0,key:'owned-fixture'})
  const check=await providers.profileTest({id:profile.id,kind:'tools'})
  for(let i=0;i<100;i++){const job=await providers.profileCheck(check.id);if(job.status!=='running'){if(job.status!=='completed')throw Error('CAPABILITY');break}await new Promise(r=>setTimeout(r,100))}
  await providers.profileDefaults({...((await providers.profileList()).defaults),research_id:profile.id})
  const form=new FormData();form.append('file',new Blob([new Uint8Array(await readFile(join(folder,'fixture.pdf')))]),'fixture.pdf')
  const imported=await backend.request('/v1/documents/import','POST',form)
  for(let i=0;i<100;i++){const task=await backend.request('/v1/tasks/'+imported.task.id);if(!['queued','running'].includes(task.status))break;await new Promise(r=>setTimeout(r,100))}
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
   const click=text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);if(!b)throw Error('BUTTON_'+text);b.click()}
   const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
   click('Garden');await wait(()=>document.querySelector('#research-home-input'),'HOME')
   const before=(await window.yorw.research.list()).value.items.length
   const input=document.querySelector('#research-home-input');input.closest('form').requestSubmit();await new Promise(r=>setTimeout(r,200))
   if((await window.yorw.research.list()).value.items.length!==before)throw Error('EMPTY_CREATED')
   set(input,'Explain the original fixture evidence');await new Promise(r=>setTimeout(r,100));input.closest('form').requestSubmit()
   await wait(()=>document.querySelector('[aria-label="研究助理会话"]'),'ASSISTANT')
   let sid
   await wait(async()=>{const r=await window.yorw.research.list();sid=r.value.items[0]?.id;if(!sid)return false;const v=await window.yorw.research.get({id:sid});return v.ok&&v.value.items[0]?.status==='completed'},'COMPLETE')
   await wait(()=>document.querySelector('.research-sources button'),'SOURCE')
   const view=(await window.yorw.research.get({id:sid})).value
   if(view.items[0].usage.tool_calls!==2||!view.items[0].sources[0].available)throw Error('READ_PROOF')
   document.querySelector('.research-sources button').click();await wait(()=>document.querySelector('.pdf-evidence-highlight'),'HIGHLIGHT')
   document.querySelector('[data-tab-key^="assistant:"]').click();await wait(()=>!document.querySelector('.research-host').hidden,'BACK')
   const count=(await window.yorw.research.list()).value.items.length
   click('Storage');document.querySelector('[data-tab-key^="assistant:"]').click();await new Promise(r=>setTimeout(r,200))
   if((await window.yorw.research.list()).value.items.length!==count)throw Error('AUTO_SWITCH')
   const newButton=[...document.querySelectorAll('.research-toolbar button')].find(b=>b.textContent==='新会话');newButton.click();await new Promise(r=>setTimeout(r,200))
   if(document.querySelector('.research-turn'))throw Error('NEW_NOT_EMPTY')
   document.querySelector('.research-session-list button').click();await wait(()=>document.querySelector('.research-turn'),'RESTORE')
   const countBeforeClose=(await window.yorw.research.list()).value.items.length
   const tab=document.querySelector('[data-tab-key^="assistant:"]');tab.closest('.workspace-tab-item').querySelector('.workspace-tab-close').click()
   click('Garden');await wait(()=>document.querySelector('#research-home-input'),'HOME_AGAIN')
   document.querySelector('.research-entry button[type="button"]').click();await wait(()=>document.querySelector('.research-host'),'REOPEN')
   await new Promise(r=>setTimeout(r,900))
   if((await window.yorw.research.list()).value.items.length!==countBeforeClose||document.querySelector('.research-turn'))throw Error('CLOSE_REPLAY')
   document.querySelector('.research-session-list button').click();await wait(()=>document.querySelector('.research-turn'),'HISTORY_AGAIN')
   return {emptyNoSession:true,searchReadCite:true,highlight:true,userControlledHistory:true,noCloseReplay:true,sessionId:sid}
  })()`)
  const memoryProof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
   const click=text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);if(!b)throw Error(text);b.click()}
   click('研究记忆');await wait(()=>document.querySelector('[aria-label="用户研究指引"]'),'MEMORY_OPEN')
   const input=document.querySelector('[aria-label="用户研究指引"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Prefer owned controlled experiments');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));click('保存指引')
   await wait(async()=>{const r=await window.yorw.researchMemory.view('global');return r.ok&&r.value.guide==='Prefer owned controlled experiments'},'SAVE_MEMORY')
   let memory=(await window.yorw.researchMemory.view('global')).value
   await window.yorw.researchMemory.edit({scope_key:'global',version:memory.content_version,text:'Owned candidate to correct'})
   click('重新载入');await wait(()=>[...document.querySelectorAll('.memory-content article')].some(e=>e.textContent.includes('Owned candidate')),'PIN')
   click('纠正');await wait(()=>document.querySelector('[aria-label="纠正研究背景"]'),'CORRECTION')
   const correction=document.querySelector('[aria-label="纠正研究背景"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(correction,'Corrected owned candidate');correction.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));click('保存纠正')
   await wait(async()=>{const r=await window.yorw.researchMemory.view('global');return r.value.entries.some(e=>e.text_md==='Corrected owned candidate')},'CORRECTED')
   window.confirm=()=>true;await wait(()=>[...document.querySelectorAll('.memory-content article')].some(e=>e.textContent.includes('Corrected owned candidate')),'CORRECT_RENDERED');[...document.querySelectorAll('.memory-content article')].find(e=>e.textContent.includes('Corrected owned candidate')).querySelectorAll('button').forEach(b=>{if(b.textContent==='忘记')b.click()})
   await wait(async()=>{const r=await window.yorw.researchMemory.view('global');return !r.value.entries.some(e=>e.text_md==='Corrected owned candidate')},'FORGOTTEN')
   click('活动记录');await wait(()=>document.querySelector('.memory-content article'),'JOURNAL')
   click('自动维护设置');await wait(()=>document.querySelector('[aria-label="每日模型摘要调用上限"]'),'SETTINGS')
   document.querySelector('.memory-content input[type=checkbox]').click();await new Promise(r=>setTimeout(r,100));click('保存自动维护设置');await wait(async()=>{const r=await window.yorw.researchMemory.view('global');return r.ok&&!r.value.preferences.enabled},'PAUSE')
   const exported=await window.yorw.researchMemory.export('global');if(!exported.ok)throw Error('EXPORT')
   return {guideSaved:true,corrected:true,forgotten:true,journalVisible:true,settingsVisible:true,exported:true}
  })()`)
  for(const width of [1024,1440]){window.setSize(width,800);await new Promise(r=>setTimeout(r,250));await writeFile(join(folder,`research-memory-${width}.png`),(await window.webContents.capturePage()).toPNG())}
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('.memory-panel button')].find(b=>b.textContent==='关闭').click()` )
  await writeFile(join(folder,'research-memory-smoke.json'),JSON.stringify(memoryProof,null,2))
  for(const width of [1024,1280,1440]){window.setSize(width,800);await new Promise(r=>setTimeout(r,250));const metrics=await window.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,height:document.querySelector('.research-messages').clientHeight})`);if(metrics.overflow||metrics.height<180)throw Error('LAYOUT');await writeFile(join(folder,`research-${width}.png`),(await window.webContents.capturePage()).toPNG())}
  await writeFile(join(folder,'research-smoke.json'),JSON.stringify({...proof,requests,ownedOnly:true},null,2))
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
