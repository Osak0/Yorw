import type {BrowserWindow} from 'electron'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
/** UI acceptance uses an isolated smoke profile and makes no model requests. */
export async function runUiSmoke(window:BrowserWindow,folder:string){
 await window.webContents.executeJavaScript(`(async()=>{
  const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,60))}throw new Error('UI_TIMEOUT')}
  const visible=n=>n.getClientRects().length>0
  const click=text=>{const n=[...document.querySelectorAll('button')].find(n=>visible(n)&&n.textContent.trim()===text);if(!n)throw new Error('BUTTON_'+text);n.click()}
  click('House');await wait(()=>[...document.querySelectorAll('.house-entries button')].filter(visible).length===4)
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
 await window.webContents.executeJavaScript(`document.querySelector('nav button').click()`)
 return {emptyTabbarHidden:true,settingsUnique:true,pristineClose:true,dirtyCloseGuard:true,draftAcrossTabs:true,keyNotInLayout:true,zoom125:true,zoom150:true}
}
export async function captureUiContent(window:BrowserWindow,folder:string){
 await window.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.getClientRects().length&&n.textContent==='返回文献库');if(b)b.click()})()`)
 await new Promise(r=>setTimeout(r,150))
 for(const width of [1280,1024]){window.setSize(width,768);await new Promise(r=>setTimeout(r,150));await writeFile(join(folder,`storage-${width}.png`),(await window.webContents.capturePage()).toPNG())}
}
