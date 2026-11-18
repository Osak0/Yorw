import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Requires an owned long PDF with a below-fold quote and a chapter targeting page 9. */
export async function runReaderNavigationSmoke(window:BrowserWindow,backend:Backend,folder:string){
 const prefs=await backend.request('/v1/ai/preferences');await backend.request('/v1/ai/preferences','PUT',{...prefs,semantic_enabled:false})
 const proof=await window.webContents.executeJavaScript(`(async()=>{
  const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
  const viewport=()=>document.querySelector('.pdf-viewport')
  const field=()=>document.querySelector('[aria-label="物理页码"]')
  const ready=n=>document.querySelector('[data-page-number="'+n+'"] canvas')?.width>0
  const setInput=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
  const change=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}
  if(document.querySelector('.note-toggle').getAttribute('aria-expanded')==='true')document.querySelector('[aria-label="关闭文献侧栏"]').click()
  change('缩放','fit');button('检索').click();await wait(()=>document.querySelector('[aria-label="文献内检索"]'),'SEARCH')
  setInput(document.querySelector('[aria-label="文献内检索"]'),'English evidence');button('搜索').click();await wait(()=>document.querySelector('.search-hit'),'RESULT')
  const source=()=>document.querySelector('.search-hit button:last-child')
  source().click()
  await wait(()=>{const hit=document.querySelector('.pdf-evidence-highlight');if(!hit)return false;const a=hit.getBoundingClientRect(),b=viewport().getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom},'QUOTE_IN_VIEW')
  const targetPage=Number(field().value),next=Math.min(12,targetPage+1)
  viewport().dispatchEvent(new WheelEvent('wheel',{deltaY:400,bubbles:true}));viewport().scrollTop=document.querySelector('[data-page-number="'+next+'"]').offsetTop+30
  await wait(()=>field().value===String(next),'SCROLLED_AWAY');const away=viewport().scrollTop
  await new Promise(r=>setTimeout(r,1800))
  if(Math.abs(viewport().scrollTop-away)>3)throw Error('REPEATED_SOURCE_JUMP')
  source().click();await wait(()=>field().value===String(targetPage)&&viewport().scrollTop>document.querySelector('[data-page-number="'+targetPage+'"]').offsetTop+100,'REPEAT_EXPLICIT_JUMP')
  viewport().dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))
  await wait(()=>!document.querySelector('.pdf-evidence-highlight'),'OUTSIDE_CLICK_CLEAR')
  document.querySelector('[aria-label="关闭文献侧栏"]').click()
  change('展示方式','single');await wait(()=>document.querySelectorAll('.pdf-page').length===1&&ready(Number(field().value)),'SINGLE_PAGE')
  document.querySelector('[aria-label="下一页"]').click();await wait(()=>field().value===String(targetPage+1)&&document.querySelectorAll('.pdf-page').length===1&&ready(targetPage+1),'SINGLE_NEXT')
  change('展示方式','continuous');await wait(()=>document.querySelectorAll('.pdf-page').length===12,'CONTINUOUS_MODE')
  button('缩略图').click();await wait(()=>document.querySelector('.pdf-thumbnail canvas'),'THUMBNAIL_IMAGE')
  document.querySelector('[aria-label="跳到第 9 页"]').click();await wait(()=>field().value==='9'&&ready(9),'THUMBNAIL_NAVIGATION')
  button('目录').click();await wait(()=>document.querySelector('.pdf-outline button'),'OUTLINE')
  document.querySelector('[aria-label="上一页"]').click();await wait(()=>field().value==='8','BEFORE_OUTLINE')
  document.querySelector('.pdf-outline button').click();await wait(()=>field().value==='9'&&ready(9),'OUTLINE_DESTINATION')
  button('专注阅读').click();await wait(()=>{const r=document.querySelector('.reader').getBoundingClientRect();return r.width>=innerWidth-1&&r.height>=innerHeight-1},'FOCUS_MODE')
  document.querySelector('.reader').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('.reader-focused'),'FOCUS_ESCAPE')
  return {quoteVisible:true,noRepeatedJump:true,outsideClickClears:true,explicitJumpRepeats:true,singlePage:true,continuousMode:true,thumbnailNavigation:true,outlineNavigation:true,focusAndEscape:true}
 })()`)
 const layouts=[]
 for(const width of [1024,1280,1440]){
  window.setContentSize(width,768);await new Promise(r=>setTimeout(r,800))
  const layout=await window.webContents.executeJavaScript(`(()=>{const host=document.querySelector('.pdf-viewport');return {width:innerWidth,readingHeight:host.clientHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,navigationVisible:!!document.querySelector('.pdf-navigation')}})()`)
  if(layout.horizontalOverflow||layout.readingHeight<300)throw Error('READER_NAV_LAYOUT_'+width)
  layouts.push(layout);await writeFile(join(folder,'reader-navigation-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
 }
 return {...proof,layouts}
}
