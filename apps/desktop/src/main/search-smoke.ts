import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

/** Keyword-only native UI test. It never configures a provider or sends a model request. */
export async function runSearchSmoke(window: BrowserWindow, reportDir: string) {
  const proof = await window.webContents.executeJavaScript(`(async () => {
    const wait = async predicate => {const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,100))}throw new Error('SEARCH_TIMEOUT')}
    const button = text => [...document.querySelectorAll('button')].find(x=>x.textContent===text)
    document.querySelector('[aria-label="关闭文献侧栏"]')?.click()
    await wait(()=>!document.querySelector('.workspace-panel-tabs'))
    document.querySelector('.search-toggle').click()
    await wait(()=>document.querySelector('.workspace-panel-tabs'))
    await wait(()=>!document.querySelector('.search-panel').parentElement.hidden)
    const input=document.querySelector('input[aria-label="文献内检索"]')
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
    setValue.call(input,'fixed English fixture');input.dispatchEvent(new Event('input',{bubbles:true}))
    await wait(()=>!button('检索原文').disabled)
    button('检索原文').click()
    await wait(()=>document.querySelector('.search-results article'))
    if(!document.querySelector('.evidence-text').textContent.includes('Yorw fixed English fixture evidence.'))throw new Error('WRONG_EVIDENCE')
    const checkbox=[...document.querySelectorAll('.search-panel input[type=checkbox]')][0]
    checkbox.click();await new Promise(r=>setTimeout(r,100))
    const minimum=document.querySelector('input[aria-label="最低语义相似度"]')
    setValue.call(minimum,'');minimum.dispatchEvent(new Event('input',{bubbles:true}))
    await wait(()=>button('检索原文').disabled && minimum.getAttribute('aria-invalid')==='true')
    const invalidThresholdBlocked=button('检索原文').disabled
    setValue.call(minimum,'0.255');minimum.dispatchEvent(new Event('input',{bubbles:true}))
    await wait(()=>!button('检索原文').disabled && minimum.getAttribute('aria-invalid')==='false')
    button('检索原文').click()
    await wait(()=>document.querySelector('.search-feedback').textContent.includes('尚未配置'))
    return {customThreshold:minimum.value,invalidThresholdBlocked,keywordEvidence:document.querySelector('.evidence-text').textContent,mode:document.querySelector('.search-mode').textContent,missingEmbedding:document.querySelector('.search-feedback').textContent}
  })()`)
  const layouts=[]
  for(const [width,height] of [[1440,1024],[1024,768]]) {
    window.setContentSize(width,height)
    await new Promise(resolve=>setTimeout(resolve,1500))
    const layout=await window.webContents.executeJavaScript(`({width:innerWidth,modal:!!document.querySelector('dialog[open]'),inputFits:(()=>{const r=document.querySelector('input[aria-label="文献内检索"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()})`)
    layouts.push(layout)
    await writeFile(join(reportDir,`search-${width}.png`),(await window.webContents.capturePage()).toPNG())
  }
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  await new Promise(resolve=>setTimeout(resolve,200))
  const focusRestored=await window.webContents.executeJavaScript(`!document.querySelector('dialog[open]') && document.activeElement === document.querySelector('.search-toggle')`)
  if(!focusRestored)throw new Error('SEARCH_FOCUS_NOT_RESTORED')
  await window.webContents.executeJavaScript(`document.querySelector('.search-toggle').click()`)
  if(layouts.some(item=>!item.inputFits))throw new Error('SEARCH_OVERFLOW')
  return {...proof,layouts,directEntry:true,focusRestored}
}
