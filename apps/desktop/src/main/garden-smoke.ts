import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export async function runGardenSmoke(window:BrowserWindow,backend:Backend,reportDir:string){
 const first=await window.webContents.executeJavaScript(`(async()=>{
  const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw new Error('GARDEN_TIMEOUT')}
  const button=text=>[...document.querySelectorAll('.garden-workspace button')].find(x=>x.textContent===text)
  const input=document.querySelector('nav button:nth-child(2)');input.click()
  await wait(()=>button('创建专题')&&!button('刷新目录').disabled)
  const set=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
  set('新专题名称','Medical reliability fixture');await wait(()=>!button('创建专题').disabled);button('创建专题').click()
  await wait(()=>document.querySelector('.garden-editor .cm-content'))
  document.querySelector('.garden-editor .cm-content').focus()
  return {id:document.querySelector('.garden-directory button[aria-current]').dataset.topicId}
 })()`)
 await window.webContents.insertText('# Medical reliability\n\nManual Wiki fixture. 中文研究正文。')
 const run=(body:string)=>window.webContents.executeJavaScript(`(async()=>{
  const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw new Error('GARDEN_TIMEOUT')}
  const button=text=>[...document.querySelectorAll('.garden-workspace button')].find(x=>x.textContent===text)
  ${body}
 })()`)
 await run(`await wait(()=>!button('保存修订').disabled);button('保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 2'));document.querySelector('.garden-editor .cm-content').focus()`)
 await window.webContents.insertText(' DRAFT retained')
 await run(`await wait(()=>document.querySelector('.wiki-status').textContent.includes('未保存'));document.querySelector('nav button:nth-child(3)').click();document.querySelector('nav button:nth-child(2)').click();if(!document.querySelector('.garden-editor .cm-content').textContent.includes('DRAFT retained'))throw new Error('GARDEN_DRAFT_LOST')`)
 // Native beforeunload chooses continue editing for this isolated smoke.
 window.close();await new Promise(resolve=>setTimeout(resolve,400))
 if(window.isDestroyed())throw new Error('GARDEN_CLOSE_NOT_PROTECTED')
 await run(`button('保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 3'));button('查看修订历史').click();await wait(()=>document.querySelector('[aria-label="历史修订"] option'));if(document.querySelectorAll('[aria-label="历史修订"] option').length!==3)throw new Error('GARDEN_HISTORY_MISSING')`)
 // Inject a second writer, then verify the UI cannot blindly overwrite it.
 const baseline=await backend.request(`/v1/topics/${first.id}`)
 await backend.request(`/v1/topics/${first.id}/revisions`,'POST',{body_md:'Concurrent remote Wiki fixture',base_revision_id:baseline.revision.id})
 await run(`document.querySelector('.garden-editor .cm-content').focus()`)
 await window.webContents.insertText(' conflict draft')
 await run(`button('保存修订').click();await wait(()=>button('比较最新修订'));if(!document.querySelector('.garden-editor .cm-content').textContent.includes('conflict draft'))throw new Error('GARDEN_CONFLICT_LOST');button('比较最新修订').click();await wait(()=>button('保留草稿，基于最新继续'));button('保留草稿，基于最新继续').click();await wait(()=>!button('保存修订').disabled);button('保存修订').click();await wait(()=>document.querySelector('.wiki-status').textContent.includes('修订 5'))`)
 const child=await run(`
  const input=document.querySelector('[aria-label="新专题名称"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Child fixture')
  input.dispatchEvent(new Event('input',{bubbles:true}))
  const select=document.querySelector('[aria-label="新专题父级"]');select.value='${first.id}';select.dispatchEvent(new Event('change',{bubbles:true}))
  await wait(()=>!button('创建专题').disabled);button('创建专题').click();await wait(()=>document.querySelector('.garden-editor h2')?.textContent==='Child fixture')
  return {id:document.querySelector('.garden-directory button[aria-current]').dataset.topicId}
 `)
 const nested=await backend.request(`/v1/topics/${child.id}`)
 if(nested.topic.parent_id!==first.id)throw new Error('GARDEN_CHILD_PARENT')
 await run(`
  document.querySelector('.topic-metadata summary').click()
  const input=document.querySelector('[aria-label="专题名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renamed child fixture');input.dispatchEvent(new Event('input',{bubbles:true}))
  const select=document.querySelector('[aria-label="专题父级"]');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))
  await new Promise(r=>setTimeout(r,100));button('保存目录信息').click();await wait(()=>document.querySelector('.garden-editor h2')?.textContent==='Renamed child fixture')
 `)
 const renamed=await backend.request(`/v1/topics/${child.id}`)
 if(renamed.topic.parent_id!==null)throw new Error('GARDEN_MOVE_FAILED')
 await run(`document.querySelector('[data-topic-id="${first.id}"]').click();await wait(()=>document.querySelector('.garden-editor h2')?.textContent==='Medical reliability fixture')`)
 const proof={topicId:first.id,nestedCreation:true,renameAndMove:true,draftAcrossNavigation:true,closeProtected:true,conflictProtected:true,revisionCount:(await backend.request(`/v1/topics/${first.id}/revisions`)).items.length}
 window.showInactive()
 const layouts=[]
 for(const [width,height] of [[1440,1024],[1024,768]]){
  window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,650))
  const result=await window.webContents.executeJavaScript(`({width:innerWidth,editorVisible:!!document.querySelector('.garden-editor .cm-content'),fits:[...document.querySelectorAll('.garden-workspace input,.garden-workspace select,.garden-workspace button')].filter(x=>x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})})`)
  layouts.push(result);await writeFile(join(reportDir,`garden-${width}.png`),(await window.webContents.capturePage()).toPNG())
 }
 if(layouts.some(x=>!x.fits))throw new Error('GARDEN_LAYOUT_OVERFLOW')
 await writeFile(join(reportDir,'garden-smoke.json'),JSON.stringify({proof,layouts},null,2))
 return proof
}
