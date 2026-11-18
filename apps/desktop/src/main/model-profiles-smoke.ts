import {runLiveResearchSmoke} from './live-research-smoke'
import type {Backend} from './backend'
import {BrowserWindow,safeStorage} from 'electron'
import {createServer} from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {Providers} from './providers'

export async function runModelProfilesSmoke(window:BrowserWindow,providers:Providers,reportDir:string,backend:Backend){
 let requests=0
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const payload=JSON.parse(Buffer.concat(chunks).toString());requests++
  if(!payload.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return}
  const results=payload.messages.filter((m:any)=>m.role==='tool')
  res.setHeader('Content-Type','text/event-stream')
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\n\n')
  if(results.length<2){const name=results.length?'read_local':'search_local';const args=results.length?'["invalid"]':'{"query":"verification"}'
   const valid=results.length?'{"id":"fixture-1"}':args
   emit({reasoning_content:'fixture reasoning',tool_calls:[{index:0,id:'call-'+results.length,type:'function',function:{name,arguments:valid.slice(0,5)}}]})
   emit({tool_calls:[{index:0,function:{arguments:valid.slice(5)}}]});emit({},'tool_calls')
  }else{emit({content:'violet-42 [S1]'});emit({},'stop')}
  res.end('data: [DONE]\n\n')
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const address=server.address() as {port:number}
  const saved=await providers.profileSave({id:randomUUID(),name:'模型工具验证',provider:'compatible',base_url:`http://127.0.0.1:${address.port}`,model:'owned-fixture',version:0,key:'owned-fixture-key'})
  const defaults=(await providers.profileList()).defaults
  await providers.profileDefaults({...defaults,research_id:saved.id})
  async function run(id:string,kind:'chat'|'tools'){
   const job=await providers.profileTest({id,kind});const until=Date.now()+195000
   while(Date.now()<until){await new Promise(r=>setTimeout(r,200));const state=await providers.profileCheck(job.id);if(state.status!=='running')return state}
   throw new Error('CHECK_TIMEOUT')
  }
  const chat=await run(saved.id,'chat'),tools=await run(saved.id,'tools')
  if(chat.status!=='completed'||tools.status!=='completed'||tools.result?.tool_calls!==2)throw new Error('FIXTURE_PROOF_FAILED')
  const report:any={chat:true,tools:true,requests,secretNotReturned:!JSON.stringify(await providers.profileList()).includes('owned-fixture-key')}
  await window.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='House');b?.click()})()`)
  await new Promise(r=>setTimeout(r,300))
  await window.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('.house-entries button')].find(b=>b.querySelector('strong')?.textContent==='研究助理模型');if(!b)throw new Error('ENTRY_MISSING');b.click()})()`)
  await new Promise(r=>setTimeout(r,600))
  report.ui=await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="研究助理模型配置"]')`)
  if(!report.ui){await writeFile(join(reportDir,'missing-ui.txt'),await window.webContents.executeJavaScript('document.body.innerText'));throw new Error('PROFILE_UI_MISSING')}
  report.layouts=[]
  for(const width of [1024,1280,1440]){window.setSize(width,800);await new Promise(r=>setTimeout(r,200));const overflow=await window.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth');report.layouts.push({width,overflow});if(overflow)throw new Error('LAYOUT_OVERFLOW');await writeFile(join(reportDir,`models-${width}.png`),(await window.webContents.capturePage()).toPNG())}
  const liveConfig=process.argv.find(a=>a.startsWith('--live-config='))?.slice(14)
  const liveKey=process.argv.find(a=>a.startsWith('--live-key-file='))?.slice(16)
  if(liveConfig&&liveKey){
   const config=JSON.parse(await readFile(liveConfig,'utf8'))
   let key=(await safeStorage.decryptStringAsync(await readFile(liveKey))).result
   try{const profile=await providers.profileSave({id:randomUUID(),name:'真实模型阶段一验证',provider:'deepseek',base_url:config.base_url,model:config.model,version:0,key});key='';const realChat=await run(profile.id,'chat');const realTools=await run(profile.id,'tools');report.live={model:config.model,base_url:config.base_url,chat:realChat,tools:realTools};if(realChat.status!=='completed'||realTools.status!=='completed')throw new Error('LIVE_CHECK_FAILED');if(process.argv.includes('--live-business'))await runLiveResearchSmoke(window,backend,profile.id,reportDir)}
   finally{key='';await writeFile(join(reportDir,'model-profiles-smoke.json'),JSON.stringify(report,null,2))}
  }
  await writeFile(join(reportDir,'model-profiles-smoke.json'),JSON.stringify(report,null,2))
  return report
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
