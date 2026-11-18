import type {BrowserWindow} from 'electron'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
/** UI acceptance uses an isolated smoke profile and makes no model requests. */
export async function runUiSmoke(window:BrowserWindow,folder:string){
 await window.webContents.executeJavaScript(`(async()=>{
  const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,60))}throw new Error('UI_TIMEOUT')}
  const visible=n=>n.getClientRects().length>0
  const click=text=>{const n=[...document.querySelectorAll('button')].find(n=>visible(n)&&n.textContent.trim()===text);if(!n)throw new Error('BUTTON_'+text);n.click()}
  click('House');await wait(()=>[...document.querySelectorAll('.house-entries button')].filter(visible).length===5)
  if(document.querySelector('.workspace-tabbar'))throw new Error('EMPTY_TABBAR')
  const card=()=>[...document.querySelectorAll('.house-entries button')].find(n=>visible(n)&&n.textContent.startsWith('聊天模型'))
  card().click();await wait(()=>document.querySelector('.house-settings-page input[type=password]'))
  if(document.querySelectorAll('[data-tab-key="settings:chat"]').length!==1)throw new Error('SETTING_TAB')
  const close=()=>document.querySelector('[data-tab-key="settings:chat"]').closest('.workspace-tab-item').querySelector('.workspace-tab-close').click()
  close();await wait(()=>!document.querySelector('[data-tab-key="settings:chat"]'))
  if(document.querySelector('.close-dialog'))throw new Error('PRISTINE_FORM_DIRTY')
  click('House');await wait(()=>!!card());card().click();await wait(()=>document.querySelector('[data-tab-key="settings:chat"]'))
  const field=[...document.querySelectorAll('.house-settings-page label')].find(n=>visible(n)&&n.textContent.startsWith('模型名')).querySelector('input')
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
  setter.call(field,'local-ui-draft');field.dispatchEvent(new Event('input',{bubbles:true}))
  const key=[...document.querySelectorAll('.house-settings-page input[type=password]')].find(visible)
  setter.call(key,'fixture-private-key');key.dispatchEvent(new Event('input',{bubbles:true}))
  await new Promise(r=>setTimeout(r,100));click('Storage');click('House');await wait(()=>!!card());card().click()
  await wait(()=>field.value==='local-ui-draft')
  if(document.querySelectorAll('[data-tab-key="settings:chat"]').length!==1)throw new Error('DUPLICATE_SETTINGS')
  const layout=await window.yorw.layout.load()
  if(JSON.stringify(layout).includes('fixture-private-key'))throw new Error('SECRET_IN_LAYOUT')
  close();await wait(()=>document.querySelector('.close-dialog'))
  click('取消');await wait(()=>!document.querySelector('.close-dialog'))
  close();await wait(()=>document.querySelector('.close-dialog'));click('放弃并关闭')
  await wait(()=>!document.querySelector('[data-tab-key="settings:chat"]'))
  click('House')
 })()`)
 for(const [width,zoom] of [[1280,1],[1024,1],[1280,1.25],[1280,1.5]]){
  window.setSize(width,768);window.webContents.setZoomFactor(zoom)
  await new Promise(r=>setTimeout(r,180))
  const overflow=await window.webContents.executeJavaScript(`document.documentElement.scrollWidth>window.innerWidth+1`)
  if(overflow)throw new Error('HOUSE_OVERFLOW_'+width+'_'+zoom)
  await writeFile(join(folder,`house-${width}-${zoom}.png`),(await window.webContents.capturePage()).toPNG())
 }
 window.webContents.setZoomFactor(1);window.setSize(1280,768)
 await window.webContents.executeJavaScript(`(async()=>{
  const card=[...document.querySelectorAll('.house-entries button')].find(n=>n.textContent.startsWith('文献解析与预览'));card.click()
  const end=Date.now()+15000;while(Date.now()<end){if(document.querySelector('[aria-label="自动整理新文献"]'))return;await new Promise(r=>setTimeout(r,80))}throw new Error('PARSER_SETTINGS_TIMEOUT')
 })()`)
 await writeFile(join(folder,'parser-settings.png'),(await window.webContents.capturePage()).toPNG())
 await window.webContents.executeJavaScript(`(async()=>{
  const visible=n=>n.getClientRects().length>0
  const click=text=>{const node=[...document.querySelectorAll('button')].find(n=>visible(n)&&n.textContent.trim()===text);if(!node)throw new Error('R5_BUTTON_'+text);node.click()}
  click('Garden');await new Promise(r=>setTimeout(r,300))
  const menu=document.querySelector('.garden-home-toolbar .workspace-more');if(!menu)throw new Error('R5_MORE_MISSING')
  menu.querySelector('summary').click();if(!menu.open)throw new Error('R5_MORE_OPEN')
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));if(menu.open)throw new Error('R5_MORE_ESCAPE')
  const root=crypto.randomUUID(),child=crypto.randomUUID()
  for(const [id,title,parent_id] of [[root,'自编写界面验收专题',null],[child,'自编写子专题',root]]){const result=await window.yorw.garden.create({id,title,parent_id});if(!result.ok)throw new Error('R5_TOPIC_CREATE')}
  menu.querySelector('summary').click();click('刷新目录');await new Promise(r=>setTimeout(r,200))
  const toggle=document.querySelector('.garden-tree-toggle');if(!toggle||!['展开','收起'].includes(toggle.textContent.trim()))throw new Error('R5_TREE_TEXT')
  const topicButton=document.querySelector('[data-topic-id="'+root+'"]'),wasOpen=toggle.getAttribute('aria-expanded')
  topicButton.click();await new Promise(r=>setTimeout(r,100))
  if(document.querySelector('.topic-overview')||toggle.getAttribute('aria-expanded')===wasOpen)throw new Error('TOPIC_SINGLE_CLICK')
  topicButton.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await new Promise(r=>setTimeout(r,250))
  const overview=document.querySelector('.topic-overview');if(!overview)throw new Error('R5_OVERVIEW')
  if([...overview.querySelectorAll('summary')].some(n=>n.textContent.includes('共享笔记')))throw new Error('R5_EMPTY_SHARED')
  for(const text of ['新建笔记','管理材料','管理关联专题'])if(![...overview.querySelectorAll('button')].some(n=>visible(n)&&n.textContent===text))throw new Error('R5_ENTRY_'+text)
  click('Garden');await new Promise(r=>setTimeout(r,200))
  click('历史会话');await new Promise(r=>setTimeout(r,300))
  const workspace=document.querySelector('.research-workspace');if(!workspace)throw new Error('R5_RESEARCH_MISSING')
  const fresh=[...workspace.querySelectorAll('button')].filter(n=>visible(n)&&n.textContent.trim()==='新会话');if(fresh.length!==1)throw new Error('R5_NEW_SESSION_DUPLICATE')
 })()`)
 const before=await window.webContents.executeJavaScript(`(()=>{const s=document.querySelector('[aria-label="调整历史会话宽度"]'),r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+80,width:document.querySelector('.research-history').getBoundingClientRect().width}})()`)
 window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(before.x),y:Math.round(before.y)})
 await new Promise(r=>setTimeout(r,100))
 window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(before.x),y:Math.round(before.y)})
 await new Promise(r=>setTimeout(r,100))
 window.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftbuttondown'],x:Math.round(before.x+60),y:Math.round(before.y)})
 await new Promise(r=>setTimeout(r,100))
 window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(before.x+60),y:Math.round(before.y)})
 await new Promise(r=>setTimeout(r,180))
 if(!await window.webContents.executeJavaScript(`document.querySelector('.research-history').getBoundingClientRect().width>${before.width}+20`))throw new Error('HISTORY_DRAG')
 for(const [width,zoom] of [[1024,1],[1280,1],[1440,1],[1280,1.25]]){
  window.setSize(width,800);window.webContents.setZoomFactor(zoom);await new Promise(r=>setTimeout(r,180))
  if(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth>innerWidth+1`))throw new Error('R5_RESEARCH_OVERFLOW')
  if(!await window.webContents.executeJavaScript(`(()=>{const row=document.querySelector('.research-workspace .composer-toolbar');const nodes=[...row.querySelectorAll('button,select')].filter(n=>n.getClientRects().length);return nodes.every(n=>Math.abs(n.getBoundingClientRect().height-36)<1)})()`))throw new Error('COMPOSER_ALIGNMENT')
  await writeFile(join(folder,`research-r5-${width}-${zoom}.png`),(await window.webContents.capturePage()).toPNG())
 }
 window.webContents.setZoomFactor(1)
 await window.webContents.executeJavaScript(`document.querySelector('nav button').click()`)
 return {emptyTabbarHidden:true,settingsUnique:true,pristineClose:true,dirtyCloseGuard:true,draftAcrossTabs:true,keyNotInLayout:true,zoom125:true,zoom150:true,secondaryMenuEscape:true,singleNewSession:true,topicEntryMapping:true,emptySharedHidden:true,textTreeToggle:true,topicSingleToggleDoubleOpen:true,historyPointerDrag:true,composerControlsAligned:true,researchWidths:[1024,1280,1440],researchZoom125:true}
}
export async function captureUiContent(window:BrowserWindow,folder:string){
 await window.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.getClientRects().length&&n.textContent==='返回文献库');if(b)b.click()})()`)
 await new Promise(r=>setTimeout(r,150))
 for(const width of [1280,1024]){window.setSize(width,768);await new Promise(r=>setTimeout(r,150));await writeFile(join(folder,`storage-${width}.png`),(await window.webContents.capturePage()).toPNG())}
}
