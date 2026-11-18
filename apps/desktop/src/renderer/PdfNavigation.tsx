import React,{useEffect,useRef,useState} from 'react'
import type {PDFDocumentProxy} from 'pdfjs-dist'

type OutlineEntry={title:string;dest:string|unknown[]|null;items:OutlineEntry[]}
function Thumbnail({pdf,number,root,selected,onGo,ratio}:{pdf:PDFDocumentProxy;number:number;root:React.RefObject<HTMLDivElement|null>;selected:boolean;onGo(number:number):void;ratio:number}){
 const button=useRef<HTMLButtonElement>(null),host=useRef<HTMLDivElement>(null)
 const [near,setNear]=useState(false)
 useEffect(()=>{const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root:root.current,rootMargin:'240px'});observer.observe(button.current!);return()=>observer.disconnect()},[root])
 useEffect(()=>{
  if(!near)return
  let active=true,render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined
  void(async()=>{
   try{const source=await pdf.getPage(number);if(!active)return
    const size=source.getViewport({scale:1}),view=source.getViewport({scale:120/size.width})
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);canvas.setAttribute('aria-label',`第 ${number} 页缩略图`);host.current?.replaceChildren(canvas)
    render=source.render({canvas,viewport:view});await render.promise
   }catch{/* The labelled page button remains usable even if its preview fails. */}
  })()
  return()=>{active=false;render?.cancel();host.current?.replaceChildren()}
 },[pdf,number,near])
 return <button ref={button} className="pdf-thumbnail" aria-label={`跳到第 ${number} 页`} aria-current={selected?'page':undefined} onClick={()=>onGo(number)}><div ref={host} style={{minHeight:120*ratio}}/><span>第 {number} 页</span></button>
}

export function PdfNavigation({pdf,mode,page,initialSize,onGo,onClose}:{pdf:PDFDocumentProxy;mode:'thumbnails'|'outline';page:number;initialSize:{width:number;height:number};onGo(number:number):void;onClose():void}){
 const root=useRef<HTMLDivElement>(null)
 const [outline,setOutline]=useState<OutlineEntry[]|null>(null),[notice,setNotice]=useState('')
 useEffect(()=>{
  if(mode!=='outline')return
  let active=true
  setOutline(null);setNotice('')
  void pdf.getOutline().then(items=>{if(active)setOutline((items??[]) as OutlineEntry[])}).catch(()=>{if(active){setOutline([]);setNotice('目录读取失败，可使用缩略图或页码。')}})
  return()=>{active=false}
 },[pdf,mode])
 useEffect(()=>{
  if(mode!=='thumbnails'||!root.current)return
  const target=root.current.querySelector<HTMLElement>('[aria-current="page"]')
  if(!target)return
  const host=root.current,view=host.getBoundingClientRect(),hit=target.getBoundingClientRect()
  if(hit.top<view.top||hit.bottom>view.bottom)host.scrollTo({top:host.scrollTop+hit.top-view.top-8})
 },[page,mode])
 async function follow(entry:OutlineEntry){
  try{
   const destination=typeof entry.dest==='string'?await pdf.getDestination(entry.dest):entry.dest
   if(!destination?.length){setNotice('该目录项没有可定位的页面。');return}
   const ref=destination[0]
   const index=typeof ref==='number'?ref:await pdf.getPageIndex(ref as {num:number;gen:number})
   if(!Number.isInteger(index)||index<0||index>=pdf.numPages)throw Error('INVALID_DESTINATION')
   onGo(index+1)
  }catch{setNotice('无法定位此目录项，可使用缩略图或页码。')}
 }
 let count=0
 function entries(items:OutlineEntry[],depth=0):React.ReactNode{
  if(depth>12)return null
  return items.slice(0,500).map((entry,index)=>{
   if(++count>1000)return null
   return <li key={index}><button disabled={!entry.dest} onClick={()=>void follow(entry)}>{entry.title||'未命名章节'}</button>{entry.items?.length>0&&<ul>{entries(entry.items,depth+1)}</ul>}</li>
  })
 }
 return <aside className="pdf-navigation" aria-label="文献导航"><div className="pdf-navigation-heading"><strong>{mode==='thumbnails'?'缩略图':'目录'}</strong><button aria-label="关闭文献导航" onClick={onClose}>关闭</button></div><div ref={root} className="pdf-navigation-body">
 {mode==='thumbnails'?Array.from({length:pdf.numPages},(_,index)=><Thumbnail key={index} pdf={pdf} number={index+1} root={root} selected={page===index+1} onGo={onGo} ratio={initialSize.height/initialSize.width}/>):outline===null?<p>正在读取目录…</p>:outline.length?<ul className="pdf-outline">{entries(outline)}</ul>:<p>此 PDF 没有内置目录，可使用缩略图或页码导航。</p>}
 {notice&&<p role="status">{notice}</p>}
 </div></aside>
}
