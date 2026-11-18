import type {BrowserWindow} from 'electron'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Self-authored PDF only; exercise actual scrolling, rendering and navigation. */
export async function runContinuousReadingSmoke(window:BrowserWindow,folder:string){
 const proof=await window.webContents.executeJavaScript(`(async()=>{
  const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
  const viewport=()=>document.querySelector('.pdf-viewport')
  const page=n=>document.querySelector('[data-page-number="'+n+'"]')
  const input=()=>document.querySelector('[aria-label="物理页码"]')
  const ready=n=>page(n)?.querySelector('canvas')?.width>0&&page(n)?.querySelector('.textLayer')?.textContent
  if(document.querySelector('.note-toggle').getAttribute('aria-expanded')==='true')document.querySelector('[aria-label="关闭文献侧栏"]').click()
  const zoom=document.querySelector('select[aria-label="缩放"]');zoom.value='fit';zoom.dispatchEvent(new Event('change',{bubbles:true}))
  await wait(()=>ready(2),'INITIAL_PAGE')
  const count=document.querySelectorAll('.pdf-page').length
  if(count<10)throw Error('LONG_FIXTURE_REQUIRED')
  if(document.querySelector('.reader-warning'))throw Error('WARNING_REMAINS')
  viewport().scrollTop=page(3).offsetTop
  await wait(()=>input().value==='3'&&ready(3),'SCROLL_TO_THREE')
  viewport().scrollTop=page(4).offsetTop-viewport().clientHeight/2
  await wait(()=>ready(4),'ADJACENT_PAGE')
  const a=page(3).getBoundingClientRect(),b=page(4).getBoundingClientRect(),v=viewport().getBoundingClientRect()
  if(a.bottom<=v.top||b.top>=v.bottom)throw Error('NO_CONTINUOUS_BOUNDARY')
  viewport().scrollTop=page(count).offsetTop
  await wait(()=>input().value===String(count)&&ready(count),'SCROLL_TO_LAST')
  await wait(()=>!page(1).querySelector('canvas'),'OFFSCREEN_CANVAS_NOT_RELEASED')
  await wait(()=>document.querySelector('.reader-feedback').textContent.includes('已保存到第 '+count+' 页'),'POSITION_SAVE')
  document.querySelector('[aria-label="上一页"]').click()
  await wait(()=>input().value===String(count-1)&&ready(count-1),'PREVIOUS_PAGE')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input(),'2');input().dispatchEvent(new Event('input',{bubbles:true}))
  await new Promise(r=>setTimeout(r,100));input().form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  await wait(()=>input().value==='2'&&ready(2),'DIRECT_JUMP')
  document.querySelector('.note-toggle').click()
  await wait(()=>document.querySelector('.note-toggle').getAttribute('aria-expanded')==='true'&&ready(2),'SIDEBAR_FIT')
  if(document.documentElement.scrollWidth>innerWidth)throw Error('READING_OVERFLOW')
  document.querySelector('[aria-label="关闭文献侧栏"]').click()
  await wait(()=>document.querySelector('.note-toggle').getAttribute('aria-expanded')==='false'&&ready(2),'SIDEBAR_CLOSE')
  return {continuousBoundary:true,scrollUpdatesPage:true,previousAndDirectJump:true,positionSaved:true,lazyCanvasReleased:true,warningRemoved:true,pageCount:count}
 })()`)
 const layouts=[]
 for(const width of [1024,1280,1440]){
  window.setContentSize(width,768)
  await new Promise(r=>setTimeout(r,1000))
  const layout=await window.webContents.executeJavaScript(`(()=>{const v=document.querySelector('.pdf-viewport'),r=document.querySelector('.reader');return {width:innerWidth,readingHeight:v.clientHeight,readerHeight:r.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
  if(layout.overflow||layout.readingHeight<layout.readerHeight-120)throw Error('CONTINUOUS_LAYOUT_'+width)
  layouts.push(layout)
  await writeFile(join(folder,'continuous-reading-'+width+'.png'),(await window.webContents.capturePage()).toPNG())
 }
 return {...proof,layouts}
}
