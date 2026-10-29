import React, { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { DocumentRecord } from '../shared/status'
import { sessionStore, useDocumentSession } from './session-state'
import './reader.css'

GlobalWorkerOptions.workerSrc = workerUrl
const asset = (directory: string) => new URL(`./pdf-assets/${directory}/`, window.location.href).href
const errorMessage = (code: string) => ({ DOCUMENT_FILE_MISSING: '受管 PDF 副本不存在，请返回文献库重新导入。', DOCUMENT_NOT_FOUND: '文献已被移除，请返回文献库。', PAGE_COUNT_UNAVAILABLE: '当前后端尚无有效页数，阅读位置暂时无法保存。', INVALID_PAGE: '页码超出有效范围。' }[code] ?? '操作失败，请检查本地服务后重试。')

export function PdfReader({ previewId, highlight, document: record, onClose, onNotes, notesOpen, onSearch, searchOpen, onChat, chatOpen, onResource, jump, onJumpApplied }: {previewId?:string;highlight?:string;document: DocumentRecord; onClose(): void; onNotes(): void; notesOpen: boolean; onSearch(): void; searchOpen: boolean; onChat(): void; chatOpen:boolean; onResource(): void; jump?:{page:number;sequence:number}; onJumpApplied?(sequence:number):void}) {
  const session = useDocumentSession(record.id)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(session.page ?? 1)
  const [input, setInput] = useState(String(session.page ?? 1))
  const [zoom, setZoom] = useState<number | 'fit'>(session.zoom)
  const [width, setWidth] = useState(800)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const [retry, setRetry] = useState(0)
  const [painted, setPainted] = useState(0)
  const [saveRetry, setSaveRetry] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textContainer = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const pageElement = useRef<HTMLDivElement>(null)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const saveSequence = useRef(0)
  useEffect(() => { if (pdf) sessionStore().updateDocument(record.id, { page }) }, [pdf, page, record.id])
  useEffect(() => { sessionStore().updateDocument(record.id, { zoom }) }, [zoom, record.id])
  useEffect(() => {
    if (!jump || !pdf) return
    go(jump.page)
    onJumpApplied?.(jump.sequence)
  }, [jump, pdf, onJumpApplied])
  useEffect(() => {
    const element = viewport.current!
    const observer = new ResizeObserver(entries => { if (entries[0].contentRect.width > 0) setWidth(entries[0].contentRect.width) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    let task: ReturnType<typeof getDocument> | undefined
    setError(''); setLoading(true); setPdf(null); setPainted(0); setSaveStatus('')
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
        setPage(initial); setInput(String(initial)); setPdf(loaded)
      } catch (error) {
        if (active) { setError(error instanceof Error && !['InvalidPDFException', 'MissingPDFException', 'UnknownErrorException'].includes(error.name) && error.message.startsWith('受管') ? error.message : 'PDF 无法打开，可能已损坏、加密或缺少受管副本。可重试或返回文献库。'); setLoading(false) }
      }
    }
    void load()
    return () => { active = false; void task?.destroy() }
  }, [record.id, retry, previewId])
  useEffect(() => {
    if (!pdf) return
    let active = true
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let layer: TextLayer | undefined
    setLoading(true); setError(''); setPainted(0); setSaveStatus('')
    async function paint() {
      try {
        const source = await pdf!.getPage(page)
        if (!active) return
        const original = source.getViewport({ scale: 1 })
        const scale = zoom === 'fit' ? Math.max(.1, Math.min(3, (width - 48) / original.width)) : zoom
        const view = source.getViewport({ scale })
        if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0 || view.width > 20000 || view.height > 20000) throw new Error('PAGE_TOO_LARGE')
        const density = Math.max(.1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (view.width * view.height))))
        const target = canvas.current!
        target.width = Math.max(1, Math.floor(view.width * density)); target.height = Math.max(1, Math.floor(view.height * density))
        target.style.width = `${view.width}px`; target.style.height = `${view.height}px`
        pageElement.current!.style.width = `${view.width}px`; pageElement.current!.style.height = `${view.height}px`
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
        if (highlight) {
          const needle = highlight.replace(/\s/g, '')
          const spans = [...container.querySelectorAll('span')]
          const joined = spans.map(span => (span.textContent ?? '').replace(/\s/g, '')).join('')
          const index = joined.indexOf(needle)
          if (index >= 0 && joined.indexOf(needle, index + 1) < 0) {
            let offset = 0
            for (const span of spans) {
              const length = (span.textContent ?? '').replace(/\s/g, '').length
              if (offset < index + needle.length && offset + length > index) span.style.backgroundColor = 'rgba(255,220,80,.55)'
              offset += length
            }
          }
        }
        if (!active) return
        setLoading(false); setPainted(page)
      } catch (error) {
        if (active && (error as Error).name !== 'RenderingCancelledException') { setLoading(false); setError('页面渲染失败，请重试或返回文献库。') }
      }
    }
    void paint()
    return () => { active = false; render?.cancel(); layer?.cancel() }
  }, [pdf, page, zoom, width, highlight])
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
  function go(number: number) {
    if (!pdf || !Number.isInteger(number) || number < 1 || number > pdf.numPages) { setInput(String(page)); return }
    setPage(number); setInput(String(number)); viewport.current?.scrollTo({ top: 0, left: 0 })
  }
  return <div className="reader" aria-label="PDF 阅读器"><div className="reader-toolbar"><button onClick={() => { void saveQueue.current.finally(onClose) }}>返回文献库</button><button className="note-toggle" aria-expanded={notesOpen} onClick={onNotes}>笔记</button><button className="search-toggle" aria-expanded={searchOpen} onClick={onSearch}>检索</button><button className="chat-toggle" aria-expanded={chatOpen} onClick={onChat}>问答</button><button className="resource-toggle" onClick={onResource}>资料</button><span className="reader-title" title={record.title || record.original_name}>{record.title || record.original_name}</span><div className="reader-controls"><button aria-label="上一页" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}>上一页</button><form onSubmit={event => { event.preventDefault(); go(Number(input)) }}><input aria-label="物理页码" inputMode="numeric" value={input} disabled={!pdf} onChange={event => setInput(event.target.value)} onBlur={() => go(Number(input))} /><span>/ {pdf?.numPages ?? '—'}</span></form><button aria-label="下一页" disabled={!pdf || page >= pdf.numPages} onClick={() => go(page + 1)}>下一页</button><label>缩放<select aria-label="缩放" value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : +event.target.value)}><option value="fit">适合宽度</option>{[.5,.75,1,1.25,1.5,2].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label></div></div>{record.extraction_status !== 'ready' && <p className="reader-warning">{record.extraction_status === 'partial' ? '仅部分文字已抽取。' : '该文献尚无完整的可检索文字。'}阅读原文不代表抽取完整；后续 AI 仅能使用实际抽取片段。</p>}<div className="reader-feedback" role="status">{loading ? '正在加载页面…' : error || saveStatus}{!loading && error && <button onClick={() => setRetry(value => value + 1)}>重试打开</button>}{!loading && !error && saveStatus && !saveStatus.startsWith('已保存') && !saveStatus.startsWith('正在') && <button onClick={() => setSaveRetry(value => value + 1)}>重试保存位置</button>}</div><div ref={viewport} className="pdf-viewport" tabIndex={0} aria-label="PDF 页面滚动区域"><div ref={pageElement} className="pdf-page" aria-busy={loading}><canvas ref={canvas} aria-label={`第 ${page} 页图像`} /><div ref={textContainer} className="pdf-text-host" /></div></div></div>
}
