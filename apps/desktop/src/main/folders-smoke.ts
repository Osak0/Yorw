import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
/** Self-authored isolated smoke library; no user workspace is used. */
export async function runFoldersSmoke(window:BrowserWindow,backend:Backend,folder:string){
 const a=(await backend.request('/v1/library-folders','POST',{name:'Research'})).items.find((f:any)=>f.name==='Research')
 const child=(await backend.request('/v1/library-folders','POST',{name:'Medical',parent_id:a.id})).items.find((f:any)=>f.name==='Medical')
 const d=(await backend.request('/v1/documents')).items[0]
 if(!d)throw new Error('NO_FIXTURE_DOCUMENT')
 await backend.request('/v1/library-folder-assignment','POST',{folder_id:child.id,documents:{[d.id]:d.version}})
 await window.webContents.executeJavaScript(`(async()=>{
  const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('FOLDER_UI_TIMEOUT')}
  const visible=n=>!n.closest('[hidden]')
  const btn=text=>[...document.querySelectorAll('button')].find(n=>visible(n)&&n.textContent.trim()===text)
  btn('Storage').click();await wait(()=>btn('返回文献库')||document.querySelector('.directory-folder'))
  if(btn('返回文献库'))btn('返回文献库').click()
  await wait(()=>document.querySelector('.directory-folder[title="Research"]'))
  if(document.querySelector('.directory-entry input')||document.querySelector('.directory-entry button'))throw new Error('ROW_CHROME')
  if(document.querySelectorAll('.directory-toolbar button').length!==2||document.querySelector('.import-button'))throw new Error('DUPLICATE_IMPORT')
  await wait(()=>!document.querySelector('.directory-file'))
  document.querySelector('.directory-folder[title="Research"]').click()
  await wait(()=>document.querySelector('.directory-folder[title="Medical"]'))
  document.querySelector('.directory-folder[title="Medical"]').click()
  await wait(()=>document.querySelector('.directory-file'))
  if(!document.querySelector('.directory-location').textContent.includes('Research / Medical'))throw new Error('HIERARCHY')
  const file=document.querySelector('.directory-file')
  file.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:window.innerWidth-10,clientY:window.innerHeight-10}))
  await wait(()=>document.querySelector('[role="menu"]'))
  const rect=document.querySelector('[role="menu"]').getBoundingClientRect()
  if(rect.right>window.innerWidth||rect.bottom>window.innerHeight)throw new Error('MENU_OVERFLOW')
  btn('查看原件存储位置').click()
  await wait(()=>[...document.querySelectorAll('[role="status"]')].some(n=>n.textContent.includes('documents')))
  const splitter=document.querySelector('[role="separator"][aria-label="调整文献目录宽度"]')
  const before=Number(splitter.getAttribute('aria-valuenow'))
  splitter.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))
  await wait(()=>Number(splitter.getAttribute('aria-valuenow'))>before)
  document.querySelector('[aria-label="返回上一级"]').click()
  await wait(()=>document.querySelector('.directory-folder[title="Medical"]'))
  if(document.querySelector('.directory-file'))throw new Error('FILE_REMAINS_AFTER_UP')
  document.querySelector('[aria-label="返回上一级"]').click()
  await wait(()=>document.querySelector('.directory-folder[title="Research"]'))
 })()`)
 const handle=await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[aria-label="调整文献目录宽度"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+80),width:Number(document.querySelector('[aria-label="调整文献目录宽度"]').getAttribute('aria-valuenow'))}})()`)
 window.webContents.sendInputEvent({type:'mouseMove',x:handle.x,y:handle.y})
 await new Promise(resolve=>setTimeout(resolve,100))
 window.webContents.sendInputEvent({type:'mouseDown',x:handle.x,y:handle.y,button:'left',clickCount:1})
 await new Promise(resolve=>setTimeout(resolve,100))
 window.webContents.sendInputEvent({type:'mouseMove',x:handle.x+60,y:handle.y,modifiers:['leftbuttondown']})
 window.webContents.sendInputEvent({type:'mouseUp',x:handle.x+60,y:handle.y,button:'left',clickCount:1})
 await new Promise(resolve=>setTimeout(resolve,200))
 const dragged=await window.webContents.executeJavaScript(`Number(document.querySelector('[aria-label="调整文献目录宽度"]').getAttribute('aria-valuenow'))`)
 if(dragged<=handle.width)throw new Error('POINTER_RESIZE')
 for(const width of [1280,1024]){
  window.setSize(width,768)
  await new Promise(resolve=>setTimeout(resolve,200))
  await writeFile(join(folder,`library-folders-${width}.png`),(await window.webContents.capturePage()).toPNG())
 }
 await window.webContents.executeJavaScript(`(()=>{const f=document.querySelector('.directory-folder');f.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:290}))})()`)
 await new Promise(resolve=>setTimeout(resolve,150))
 await writeFile(join(folder,'library-context-menu.png'),(await window.webContents.capturePage()).toPNG())
 const after=await backend.request('/v1/documents/'+d.id)
 if(after.sha256!==d.sha256||after.extraction_version!==d.extraction_version)throw new Error('ORIGINAL_CHANGED')
 return {schema:21,rootNavigation:true,directChildren:true,upNavigation:true,menuClamped:true,resizePointer:true,resizeKeyboard:true,singleImport:true,pathByDocumentId:true,originalUnchanged:true}
}
