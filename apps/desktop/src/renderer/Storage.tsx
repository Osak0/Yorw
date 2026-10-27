import React, { useEffect, useState } from 'react'
import { ReadingWorkspace } from './ReadingWorkspace'
import { documentHasUnsavedNotes } from './notebook'
import type { DocumentRecord, Topic } from '../shared/status'
import { DocumentTool } from './DocumentTool'
import { MetadataEditor } from './MetadataEditor'
import type { StorageTool } from './workspace-tabs'
const labels: Record<string, string> = { CANCELLED: '抽取已取消，可以重新抽取。', pending: '等待抽取', running: '正在抽取', ready: '文字已就绪', partial: '部分文字可用', failed: '抽取失败', unsupported: '暂不支持文字抽取', ENCRYPTED_PDF: '文件已加密，本版不解密；请导入可读取的副本。', NO_TEXT_NO_OCR: '没有可提取文字，本版不包含 OCR。', PDF_PARSE_FAILED: 'PDF 损坏或解析失败。', PARTIAL_TEXT: '部分页面没有文字、抽取失败或超过文字上限，后续 AI 仅使用已抽出的片段。', EXTRACTION_FAILED: '页面文字抽取失败。', PAGE_LIMIT: '超过 2000 页的本步处理上限。', INTERRUPTED: '上次抽取被中断，可以重试。', DOCUMENT_CONFLICT: '文献已更新，请刷新列表后重新编辑；当前草稿保留。', INVALID_METADATA: '标签或总结格式无效：标签每行一个，单个最多 40 字，最多 50 个。', PDF_TOO_LARGE: '文件超过 50 MiB，无法导入。', NOT_PDF: '文件内容不是 PDF。', FILE_CLEANUP_PENDING: '原副本仍在清理中，请重启知栖后重试。' }
const explain = (code: string) => labels[code] ?? '操作失败，请重试。'
export function Storage({ activeDocumentId, activeTool, onOpenDocument, onOpenTool, onCollapseTool, onNavigate, onShowNotes, onOpenTopic, pendingJump, onJumpApplied, onShowLibrary, onTitles }: {
  activeDocumentId: string | null
  activeTool: 'document' | StorageTool | null
  onOpenDocument(document: DocumentRecord): void
  onOpenTool(tool: StorageTool, document: DocumentRecord): void
  onCollapseTool(tool: StorageTool, document: DocumentRecord): void
  onNavigate(document: DocumentRecord, page: number): void
  onShowNotes(document: DocumentRecord): void
  onOpenTopic(topic: Topic): void
  pendingJump: { documentId: string; page: number; sequence: number } | null
  onJumpApplied(sequence: number): void
  onShowLibrary(): void
  onTitles(documents: DocumentRecord[]): void
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('正在加载文献…')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<DocumentRecord | null>(null)
  useEffect(() => {
    let active = true
    async function load() {
      try { const result = await window.yorw.documents.list(); if (active && result.ok) { setDocuments(result.value.items); onTitles(result.value.items); setLoaded(true); setMessage(previous => previous === '正在加载文献…' ? '' : previous) } else if (active && !result.ok) setMessage(explain(result.code)) }
      catch { if (active) setMessage('文献列表加载失败，请重试。') }
    }
    void load(); const timer = setInterval(load, 1200)
    return () => { active = false; clearInterval(timer) }
  }, [onTitles])
  const reading = activeDocumentId ? documents.find(document => document.id === activeDocumentId) ?? null : null
  function closeReading() {
    void window.yorw.documents.list().then(result => { if (result.ok) setDocuments(result.value.items) })
    onShowLibrary()
  }
  async function importPdf() {
    setBusy(true); setMessage('请选择 PDF，正在导入…')
    try { const result = await window.yorw.documents.importPdf(); if (!result.ok) setMessage(explain(result.code)); else setMessage(result.value.cancelled ? '已取消选择' : result.value.deduplicated ? '该 PDF 已在文献库中，已复用现有记录。' : '副本已保存，正在后台抽取文字。') }
    catch { setMessage('导入失败，请重试。') } finally { setBusy(false) }
  }
  async function remove(document: DocumentRecord) {
    if (documentHasUnsavedNotes(document.id)) { setMessage('这篇文献仍有未保存笔记，请打开阅读器保存或放弃更改后再移除。'); return }
    if (!window.confirm(`移除“${document.title || document.original_name}”？将删除受管 PDF 与可检索片段；历史笔记和 Wiki 的来源快照将保留并标记失效。`)) return
    setBusy(true)
    try { const result = await window.yorw.documents.remove({ id: document.id, version: document.version }); setMessage(result.ok ? result.value.cleanup_pending ? '记录已移除，文件清理待重试，请关闭重开知栖。' : '文献已移除。' : explain(result.code)); if (result.ok) { setDocuments(items => items.filter(item => item.id !== document.id)); if (editing?.id === document.id) setEditing(null) } }
    catch { setMessage('移除失败，请重试。') } finally { setBusy(false) }
  }
  async function cancel(document: DocumentRecord) {
    if (!document.task) return
    setBusy(true)
    try { const result = await window.yorw.tasks.cancel(document.task.id); setMessage(result.ok ? '已停止接收抽取结果，可重新抽取。' : explain(result.code)) }
    catch { setMessage('停止失败，请重试。') } finally { setBusy(false) }
  }
  async function retry(document: DocumentRecord) {
    if (!document.task) return
    setBusy(true)
    try { const result = await window.yorw.tasks.retry(document.task.id); setMessage(result.ok ? '已创建新的抽取任务。' : explain(result.code)) }
    catch { setMessage('重试失败。') } finally { setBusy(false) }
  }
  if (activeDocumentId) {
    if (!loaded) return <p role="status" className="library-view">正在加载文献…</p>
    if (!reading) return <section className="library-missing card" aria-label="文献不可用"><h2>文献不可用</h2><p>这篇文献可能已被移除，请从文献库重新选择。</p><button onClick={onShowLibrary}>返回文献库</button></section>
    if (activeTool && activeTool !== 'document') return <DocumentTool key={`${activeTool}:${reading.id}`} document={reading} tool={activeTool} onOpenDocument={() => onOpenDocument(reading)} onCollapse={() => activeTool !== 'resource' && onCollapseTool(activeTool, reading)} onNavigate={page => onNavigate(reading, page)} onShowNotes={() => onShowNotes(reading)} onOpenSearch={() => onOpenTool('search', reading)} onOpenChat={() => onOpenTool('chat', reading)} onOpenTopic={onOpenTopic} />
    return <ReadingWorkspace key={reading.id} document={reading} onClose={closeReading} onExpand={tool => onOpenTool(tool, reading)} onResource={() => onOpenTool('resource', reading)} jump={pendingJump?.documentId === reading.id ? pendingJump : undefined} onJumpApplied={onJumpApplied} />
  }
  return <div className="library-view"><div className="library-toolbar"><button className="import-button" disabled={busy} onClick={() => void importPdf()}>导入 PDF</button><span>{documents.length} 篇文献 · 单文件上限 50 MiB</span></div><p role="status">{message}</p>{editing && <MetadataEditor key={editing.id + ':' + editing.version} document={editing} onClose={() => setEditing(null)} onSaved={() => setMessage('元数据已保存。')} />}{loaded && !documents.length && <section className="library-empty card"><h2>从一篇论文开始</h2><p>导入 PDF，保存自己的研究材料。导入后可打开阅读器，翻页并保存阅读位置。</p></section>}<div className="document-list">{documents.map(document => <section key={document.id} className="document-row"><h2>{document.title || document.original_name}</h2><p className="file-name">{document.original_name}</p><p>{document.authors.length ? document.authors.join('、') : '作者未知'} · {document.year ?? '年份未知'} · {document.page_count === null ? '页数待解析' : `${document.page_count} 页`}</p><p><strong>{labels[document.extraction_status] ?? document.extraction_status}</strong>{document.task?.status === 'running' && document.task.progress !== null ? ` · ${Math.round(document.task.progress * 100)}%` : ''}</p>{document.warning && <p className="warning">{explain(document.warning)}</p>}<div className="actions"><button disabled={busy} onClick={() => onOpenDocument(document)}>打开阅读</button><button disabled={busy} onClick={() => onOpenTool('resource', document)}>文献资料</button><button disabled={busy} onClick={() => setEditing(document)}>编辑元数据</button>{['pending','running'].includes(document.extraction_status) && <button disabled={busy} onClick={() => void cancel(document)}>停止抽取</button>}{['failed', 'partial'].includes(document.extraction_status) && <button disabled={busy} onClick={() => void retry(document)}>重新抽取</button>}<button disabled={busy} onClick={() => void remove(document)}>移除文献</button></div></section>)}</div></div>
}
