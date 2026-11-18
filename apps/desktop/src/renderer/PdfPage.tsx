import React,{useEffect,useRef,useState} from 'react'
import {TextLayer,type PDFDocumentProxy} from 'pdfjs-dist'
import {highlightPdfQuote} from './pdf-highlight'

/** Keep layout placeholders for the whole document, but rasterize only nearby pages. */
export function PdfPage({pdf,number,width,zoom,initialSize,root,highlight,highlightKey,onHighlight,onReady}:{pdf:PDFDocumentProxy;number:number;width:number;zoom:number|'fit';initialSize:{width:number;height:number};root:React.RefObject<HTMLDivElement|null>;highlight?:string;highlightKey?:number;onHighlight(number:number,target:HTMLElement|null):void;onReady(number:number,ready:boolean,failed?:boolean):void}) {
  const element=useRef<HTMLDivElement>(null),canvasHost=useRef<HTMLDivElement>(null),textContainer=useRef<HTMLDivElement>(null)
  const [near,setNear]=useState(false),[textVersion,setTextVersion]=useState(0),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  const [size,setSize]=useState(initialSize)
  const scale=zoom==='fit'?Math.max(.1,Math.min(3,width/size.width)):zoom
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root:root.current,rootMargin:'800px 0px'})
    observer.observe(element.current!)
    return()=>observer.disconnect()
  },[root])
  useEffect(() => {
    if (!near) return
    let active = true
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let layer: TextLayer | undefined
    setError(''); onReady(number, false)
    async function paint() {
      try {
        const source = await pdf.getPage(number)
        if (!active) return
        const original = source.getViewport({ scale: 1 })
        setSize({width:original.width,height:original.height})
        const scale = zoom === 'fit' ? Math.max(.1, Math.min(3, width / original.width)) : zoom
        const view = source.getViewport({ scale })
        if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0 || view.width > 20000 || view.height > 20000) throw new Error('PAGE_TOO_LARGE')
        const density = Math.max(.1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (view.width * view.height))))
        const target = window.document.createElement('canvas')
        target.setAttribute('aria-label', `第 ${number} 页图像`)
        canvasHost.current!.replaceChildren(target)
        target.width = Math.max(1, Math.floor(view.width * density)); target.height = Math.max(1, Math.floor(view.height * density))
        target.style.width = `${view.width}px`; target.style.height = `${view.height}px`
        element.current!.style.width = `${view.width}px`; element.current!.style.height = `${view.height}px`
        const container = window.document.createElement('div')
        container.className = 'textLayer'
        textContainer.current!.replaceChildren(container); container.style.setProperty('--scale-factor', String(scale)); container.style.setProperty('--total-scale-factor', String(scale))
        render = source.render({ canvas: target, viewport: view, transform: [density, 0, 0, density, 0, 0] })
        await render.promise
        if (!active) return
        const content = await source.getTextContent()
        if (!active) return
        layer = new TextLayer({ textContentSource: content, container, viewport: view })
        await layer.render()
        setTextVersion(value=>value+1)
        if (!active) return
        onReady(number, true)
      } catch (error) {
        if (active && (error as Error).name !== 'RenderingCancelledException') { setError('页面渲染失败'); onReady(number, false, true) }
      }
    }
    void paint()
    return () => { active = false; render?.cancel(); layer?.cancel(); onReady(number, false); canvasHost.current?.replaceChildren(); textContainer.current?.replaceChildren() }
  }, [pdf, number, near, zoom, zoom === 'fit' ? width : 0, onReady, attempt])

  useEffect(()=>{
    const container=textContainer.current
    if(!container)return
    container.querySelectorAll<HTMLElement>('.pdf-evidence-highlight').forEach(span=>{span.classList.remove('pdf-evidence-highlight');span.style.backgroundColor=''})
    if(!highlight||!container.querySelector('.textLayer span'))return
    const matched=highlightPdfQuote(container,highlight)
    onHighlight(number,matched?container.querySelector<HTMLElement>('.pdf-evidence-highlight'):null)
  },[highlight,highlightKey,textVersion,number,onHighlight])
  return <div ref={element} className="pdf-page" data-page-number={number} style={{width:size.width*scale,height:size.height*scale}} aria-label={`第 ${number} 页`}>
    <div ref={canvasHost}/><div ref={textContainer} className="pdf-text-host"/>
    {error&&<div className="pdf-page-status" role="alert">{error}<button onClick={()=>setAttempt(value=>value+1)}>重试此页</button></div>}
  </div>
}

