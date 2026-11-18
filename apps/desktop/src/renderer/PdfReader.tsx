import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import type {DocumentRecord} from '../shared/status'
import {sessionStore,useDocumentSession} from './session-state'
import {PdfPage} from './PdfPage'
import {PdfNavigation} from './PdfNavigation'
import './reader.css'

GlobalWorkerOptions.workerSrc=workerUrl
const asset=(directory:string)=>new URL(`./pdf-assets/${directory}/`,window.location.href).href
const errorMessage=(code:string)=>({DOCUMENT_FILE_MISSING:'受管 PDF 副本不存在，请返回文献库重新导入。',DOCUMENT_NOT_FOUND:'文献已被移除，请返回文献库。',PAGE_COUNT_UNAVAILABLE:'当前文献尚无有效页数，阅读位置暂时无法保存。',INVALID_PAGE:'页码超出有效范围。'}[code]??'操作失败，请检查本地服务后重试。')

export function PdfReader({ previewId, highlight, document: record, onClose, onNotes, notesOpen, onSearch, searchOpen, onChat, chatOpen, onResource, jump, onJumpApplied }: {previewId?:string;highlight?:string;document: DocumentRecord; onClose(): void; onNotes(): void; notesOpen: boolean; onSearch(): void; searchOpen: boolean; onChat(): void; chatOpen:boolean; onResource(): void; jump?:{page:number;sequence:number;evidence?:string}; onJumpApplied?(sequence:number):void}) {
  const session=useDocumentSession(record.id)
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(session.page??1),[input,setInput]=useState(String(session.page??1))
  const [zoom,setZoom]=useState<number|'fit'>(session.zoom),[width,setWidth]=useState(800),[initialSize,setInitialSize]=useState({width:612,height:792})
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saveStatus,setSaveStatus]=useState(''),[retry,setRetry]=useState(0),[painted,setPainted]=useState(0),[saveRetry,setSaveRetry]=useState(0)
  const [displayMode,setDisplayMode]=useState<'single'|'continuous'>(session.pdfDisplayMode??'continuous')
  const [navigation,setNavigation]=useState<'thumbnails'|'outline'|null>(session.pdfNavigation??null),[focused,setFocused]=useState(false)
  const [previewHighlightDismissed,setPreviewHighlightDismissed]=useState(false)
  const [activeHighlight,setActiveHighlight]=useState<{page:number;evidence:string;sequence:number}>()
  const viewport=useRef<HTMLDivElement>(null),pages=useRef<HTMLDivElement>(null),reader=useRef<HTMLDivElement>(null)
  const readyPages=useRef(new Set<number>()),currentPage=useRef(page),scrollFrame=useRef(0),scrollFraction=useRef(0)
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve()),saveSequence=useRef(0)
  const consumedJump=useRef<number|null>(null),pendingLocate=useRef<{page:number;sequence:number}|null>(null)
  const jumpCallback=useRef(onJumpApplied)
  jumpCallback.current=onJumpApplied
  const finishLocate=useCallback(()=>{
    const pending=pendingLocate.current
    pendingLocate.current=null
    if(pending)jumpCallback.current?.(pending.sequence)
  },[])
  const clearEvidence=useCallback(()=>{finishLocate();setActiveHighlight(undefined);setPreviewHighlightDismissed(true)},[finishLocate])
  const onReady=useCallback((number:number,ready:boolean,failed=false)=>{
    if(ready)readyPages.current.add(number);else readyPages.current.delete(number)
    if(number===currentPage.current){if(ready||failed)setLoading(false);if(ready)setPainted(number)}
  },[])
  const scrollToPage=useCallback((number:number,fraction=0)=>{
    const target=pages.current?.querySelector<HTMLElement>(`[data-page-number="${number}"]`)
    if(target&&viewport.current)viewport.current.scrollTo({top:target.offsetTop+target.offsetHeight*fraction,left:0})
  },[])
  const onHighlight=useCallback((number:number,target:HTMLElement|null)=>{
    const pending=pendingLocate.current,host=viewport.current
    if(!pending||pending.page!==number||!host)return
    // Consume before scrolling: viewport/session updates must never reapply this request.
    finishLocate()
    if(target){
      const hit=target.getBoundingClientRect(),view=host.getBoundingClientRect()
      host.scrollTo({top:host.scrollTop+hit.top-view.top-Math.min(100,host.clientHeight*.22),left:Math.max(0,host.scrollLeft+hit.left-view.left-24)})
    }
  },[finishLocate])
  function trackPage(){
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current=requestAnimationFrame(()=>{
      if(!viewport.current||!pages.current)return
      const host=viewport.current,point=host.scrollTop+Math.min(200,host.clientHeight*.25)
      const children=[...pages.current.children] as HTMLElement[]
      const target=children.find(child=>child.offsetTop+child.offsetHeight>point)??children.at(-1)
      const number=Number(target?.dataset.pageNumber)
      if(number&&target){scrollFraction.current=Math.max(0,(host.scrollTop-target.offsetTop)/Math.max(1,target.offsetHeight));currentPage.current=number;setPage(number);setInput(String(number))}
    })
  }
  useEffect(()=>()=>cancelAnimationFrame(scrollFrame.current),[])
  useEffect(()=>{currentPage.current=page;if(readyPages.current.has(page)){setLoading(false);setPainted(page)}},[page])
  useLayoutEffect(()=>{if(pdf)scrollToPage(currentPage.current,scrollFraction.current)},[pdf,zoom,zoom==='fit'?width:0,displayMode,scrollToPage])
  useLayoutEffect(()=>{if(displayMode==='single')scrollToPage(page)},[displayMode,page,scrollToPage])
  useEffect(()=>{if(pdf)sessionStore().updateDocument(record.id,{page})},[pdf,page,record.id])
  useEffect(()=>{sessionStore().updateDocument(record.id,{zoom,pdfDisplayMode:displayMode,pdfNavigation:navigation})},[zoom,displayMode,navigation,record.id])
  useEffect(()=>{
    if(!jump||!pdf||consumedJump.current===jump.sequence)return
    consumedJump.current=jump.sequence
    if(jump.page<1||jump.page>pdf.numPages){jumpCallback.current?.(jump.sequence);return}
    pendingLocate.current={page:jump.page,sequence:jump.sequence}
    const evidence=jump.evidence??highlight
    setPreviewHighlightDismissed(false)
    setActiveHighlight(evidence?{page:jump.page,evidence,sequence:jump.sequence}:undefined)
    go(jump.page,false)
    if(!(jump.evidence??highlight))finishLocate()
  },[jump?.sequence,pdf,finishLocate])
  useEffect(()=>{
    if(!activeHighlight&&(!highlight||previewHighlightDismissed))return
    const dismiss=(event:PointerEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.pdf-evidence-highlight'))clearEvidence()}
    window.document.addEventListener('pointerdown',dismiss,true)
    return()=>window.document.removeEventListener('pointerdown',dismiss,true)
  },[activeHighlight,highlight,previewHighlightDismissed,clearEvidence])
  useEffect(()=>{
    const host=viewport.current!
    const stop=()=>finishLocate()
    host.addEventListener('wheel',stop,{passive:true});host.addEventListener('touchstart',stop,{passive:true})
    const measure=()=>{const style=getComputedStyle(host),available=Math.floor(host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));if(available>0)setWidth(previous=>previous===available?previous:available)}
    const observer=new ResizeObserver(measure);measure();observer.observe(host)
    return()=>{observer.disconnect();host.removeEventListener('wheel',stop);host.removeEventListener('touchstart',stop)}
  },[finishLocate])
  useEffect(() => {
    let active = true
    let task: ReturnType<typeof getDocument> | undefined
    setError(''); setLoading(true); setPdf(null); setPainted(0); setSaveStatus(''); readyPages.current.clear()
    async function load() {
      try {
        const result = await (previewId ? window.yorw.documents.preview({id:record.id,action:'read',preview:previewId}) : window.yorw.documents.readPdf(record.id))
        if (!active) return
        if (!result.ok) { setError(errorMessage(result.code)); setLoading(false); return }
        task = getDocument({ data: new Uint8Array(result.value), cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm'), iccUrl: asset('iccs'), enableXfa: false })
        task.onPassword = () => { if (active) { setError('此 PDF 需要密码，本步不提供解密。请返回并导入可读取的副本。'); setLoading(false) }; void task?.destroy() }
        const loaded = await task.promise
        if (!active) return
        const initial = Math.max(1, Math.min(session.page ?? record.last_page ?? 1, loaded.numPages))
        const first=await loaded.getPage(1)
        if(!active)return
        const size=first.getViewport({scale:1})
        setInitialSize({width:size.width,height:size.height})
        currentPage.current=initial;setPage(initial); setInput(String(initial)); setPdf(loaded)
      } catch (error) {
        if (active) { setError(error instanceof Error && !['InvalidPDFException', 'MissingPDFException', 'UnknownErrorException'].includes(error.name) && error.message.startsWith('受管') ? error.message : 'PDF 无法打开，可能已损坏、加密或缺少受管副本。可重试或返回文献库。'); setLoading(false) }
      }
    }
    void load()
    return () => { active = false; void task?.destroy() }
  }, [record.id, retry, previewId])
  useEffect(() => {
    if (!painted || previewId) return
    let active = true
    const sequence = ++saveSequence.current
    setSaveStatus('正在保存阅读位置…')
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const result = await window.yorw.documents.savePosition({ id: record.id, page: painted })
      if (active && sequence === saveSequence.current) setSaveStatus(result.ok ? `已保存到第 ${painted} 页` : errorMessage(result.code))
    }).catch(() => { if (active) setSaveStatus('阅读位置保存失败，当前页面仍可阅读。') })
    return () => { active = false }
  }, [painted, record.id, saveRetry])
  function go(number:number,dismiss=true){
    if(!pdf||!Number.isInteger(number)||number<1||number>pdf.numPages){setInput(String(page));return}
    if(dismiss)clearEvidence()
    scrollFraction.current=0;currentPage.current=number;setPage(number);setInput(String(number));scrollToPage(number)
  }
  function keyDown(event:React.KeyboardEvent){
    if(event.key==='Escape'){clearEvidence();setFocused(false)}
    if(focused&&event.key==='Tab'){
      const controls=[...(reader.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,a[href],[tabindex="0"]')??[])].filter(element=>element.getClientRects().length)
      const first=controls[0],last=controls.at(-1)
      if(event.shiftKey&&window.document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&window.document.activeElement===last){event.preventDefault();first?.focus()}
    }
    if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)&&event.target===viewport.current)finishLocate()
  }
  const numbers=pdf?(displayMode==='single'?[page]:Array.from({length:pdf.numPages},(_,index)=>index+1)):[]
  return <div ref={reader} className={`reader${focused?' reader-focused':''}`} aria-label="PDF 阅读器" onKeyDown={keyDown}>
    <div className="reader-toolbar">
      <button onClick={()=>{void saveQueue.current.finally(onClose)}}>返回文献库</button>
      <button className="note-toggle" aria-expanded={notesOpen} onClick={()=>{setFocused(false);onNotes()}}>笔记</button>
      <button className="search-toggle" aria-expanded={searchOpen} onClick={()=>{setFocused(false);onSearch()}}>检索</button>
      <button className="chat-toggle" aria-expanded={chatOpen} onClick={()=>{setFocused(false);onChat()}}>问答</button>
      <button className="resource-toggle" onClick={()=>{setFocused(false);onResource()}}>编辑元数据</button>
      <div className="reader-navigation-actions">{(['thumbnails','outline'] as const).map(kind=><button key={kind} aria-pressed={navigation===kind} onClick={()=>setNavigation(value=>value===kind?null:kind)}>{kind==='thumbnails'?'缩略图':'目录'}</button>)}</div>
      <div className="reader-controls">
        <button aria-label="上一页" disabled={!pdf||page<=1} onClick={()=>go(page-1)}>上一页</button>
        <form onSubmit={event=>{event.preventDefault();go(Number(input))}}><input aria-label="物理页码" inputMode="numeric" value={input} disabled={!pdf} onChange={event=>setInput(event.target.value)} onBlur={()=>{if(Number(input)!==page)go(Number(input))}}/><span>/ {pdf?.numPages??'—'}</span></form>
        <button aria-label="下一页" disabled={!pdf||page>=pdf.numPages} onClick={()=>go(page+1)}>下一页</button>
        <select aria-label="展示方式" value={displayMode} onChange={event=>{clearEvidence();setDisplayMode(event.target.value as 'single'|'continuous')}}><option value="single">单页展示</option><option value="continuous">连续展示</option></select>
        <select aria-label="缩放" value={zoom} onChange={event=>setZoom(event.target.value==='fit'?'fit':+event.target.value)}><option value="fit">适合宽度</option>{[.5,.75,1,1.25,1.5,2].map(value=><option key={value} value={value}>{value*100}%</option>)}</select>
        <button aria-pressed={focused} onClick={()=>setFocused(value=>!value)}>{focused?'退出专注':'专注阅读'}</button>
      </div>
    </div>
    <div className="reader-feedback reader-feedback-compact" role="status" aria-live="polite">{loading?'正在加载页面…':error||saveStatus}{!loading&&error&&<button onClick={()=>setRetry(value=>value+1)}>重试打开</button>}{!loading&&!error&&saveStatus&&!saveStatus.startsWith('已保存')&&!saveStatus.startsWith('正在')&&<button onClick={()=>setSaveRetry(value=>value+1)}>重试保存位置</button>}</div>
    <div className="pdf-workspace">
      {pdf&&navigation&&<PdfNavigation pdf={pdf} mode={navigation} page={page} initialSize={initialSize} onGo={go} onClose={()=>setNavigation(null)}/>}
      <div ref={viewport} className="pdf-viewport" onScroll={trackPage} tabIndex={0} aria-label="PDF 页面滚动区域">
        <div ref={pages} className="pdf-pages">{pdf&&numbers.map(number=><PdfPage key={`${retry}:${previewId??'original'}:${number}`} pdf={pdf} number={number} width={width} zoom={zoom} initialSize={initialSize} root={viewport} highlight={activeHighlight?.page===number?activeHighlight.evidence:!activeHighlight&&!previewHighlightDismissed&&highlight&&number===page?highlight:undefined} highlightKey={activeHighlight?.sequence} onHighlight={onHighlight} onReady={onReady}/>)}</div>
      </div>
    </div>
  </div>
}
