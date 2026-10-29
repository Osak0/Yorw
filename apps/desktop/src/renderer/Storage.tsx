import {DirectorySplitter,useDirectoryWidth} from './DirectorySplitter'
import {LibraryDirectory,directDocuments,folderPath,type Folder} from './LibraryDirectory'
import React, { useEffect, useState } from 'react'
import { ReadingWorkspace } from './ReadingWorkspace'
import { documentHasUnsavedNotes } from './notebook'
import type { DocumentRecord, ImportItem, ReaderTarget, Topic } from '../shared/status'
import { DocumentTool } from './DocumentTool'
import { MetadataTool } from './MetadataTool'
import { ImportResults } from './ImportResults'
import type { StorageTool } from './workspace-tabs'
const labels: Record<string, string> = { CANCELLED: '抽取已取消，可以重新抽取。', pending: '等待抽取', running: '正在抽取', ready: '文字已就绪', partial: '部分文字可用', failed: '抽取失败', unsupported: '暂不支持文字抽取', ENCRYPTED_PDF: '文件已加密，本版不解密；请导入可读取的副本。', NO_TEXT_NO_OCR: '没有可提取文字；可在 House 配置 Docling OCR 后用增强解析重试。', PDF_PARSE_FAILED: 'PDF 损坏或解析失败。', PARTIAL_TEXT: '部分页面没有文字、抽取失败或超过文字上限，后续 AI 仅使用已抽出的片段。', EXTRACTION_FAILED: '页面文字抽取失败。', PAGE_LIMIT: '超过 2000 页的本步处理上限。', INTERRUPTED: '上次抽取被中断，可以重试。', DOCUMENT_CONFLICT: '文献已更新，请刷新列表后重新编辑；当前草稿保留。', INVALID_METADATA: '标签或总结格式无效：标签每行一个，单个最多 40 字，最多 50 个。', PDF_TOO_LARGE: '文件超过 50 MiB，无法导入。', NOT_PDF: '文件内容不是 PDF。', FILE_CLEANUP_PENDING: '原副本仍在清理中，请重启知栖后重试。', COMPONENT_MISSING: '此操作需要可选组件：增强解析/OCR 使用 Docling，旧 DOC 处理使用 LibreOffice。PDF、DOCX、MD、TXT 可选择内置解析。', DECODE_FAILED: '文本编码无法可靠识别。', INVALID_FILE: '文件格式无效或已损坏。', FILE_TOO_LARGE: '文件超过大小上限。', OUTPUT_TOO_LARGE: '解析输出超过限制。', OUTPUT_MISSING: '解析器没有生成结果。', PARSER_FAILED: '解析器执行失败。', TIMEOUT: '解析超时。', PARSER_CONTRACT_VIOLATION: '解析器返回了不兼容的结果。', ENHANCED_UNAVAILABLE: '增强解析不可用，请检查 House 配置。', UNSUPPORTED_FORMAT: '不支持的文件格式；请使用 PDF、DOCX、DOC、MD 或 TXT。' }
const parseLabels: Record<string, string> = { pending: '等待解析', running: '正在解析', ready: '解析成功', partial: '部分解析', unsupported: '解析不支持', failed: '解析失败', cancelled: '解析已取消' }
const explain = (code: string) => labels[code] ?? '操作失败，请重试。'

/** Filename-oriented local library filter; no model or backend request is made. */
export function filterDocuments(documents: DocumentRecord[], query: string): DocumentRecord[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return documents
  return documents.filter(document => [
    document.title ?? '',
    document.original_name,
    document.authors.join(' '),
    document.year?.toString() ?? '',
    document.tags.join(' '),
    document.summary_md ?? ''
  ].some(value => value.toLocaleLowerCase().includes(needle)))
}

export function Storage({ activeDocumentId, activeTool, storageDirectoryCollapsed, onToggleStorageDirectory, onOpenDocument, onOpenTool, onCollapseTool, onCloseMetadata, onNavigate, onShowNotes, onOpenTopic, pendingJump, onJumpApplied, onShowLibrary, onTitles }: {
  activeDocumentId: string | null
  activeTool: 'document' | StorageTool | null
  storageDirectoryCollapsed: boolean
  onToggleStorageDirectory(): void
  onOpenDocument(document: DocumentRecord): void
  onOpenTool(tool: StorageTool, document: DocumentRecord): void
  onCollapseTool(tool: StorageTool, document: DocumentRecord): void
  onCloseMetadata(document: DocumentRecord): void
  onNavigate(document: DocumentRecord, target: ReaderTarget): void
  onShowNotes(document: DocumentRecord): void
  onOpenTopic(topic: Topic): void
  pendingJump: (ReaderTarget & { documentId: string; sequence: number }) | null
  onJumpApplied(sequence: number): void
  onShowLibrary(): void
  onTitles(documents: DocumentRecord[]): void
}) {
  const directoryWidth=useDirectoryWidth()
  const [folders,setFolders]=useState<Folder[]>([])
  const [selectedFolder,setSelectedFolder]=useState(()=>{try{const id=localStorage.getItem('yorw-selected-folder');return !id||['all','none'].includes(id)?'root':id}catch{return 'root'}})
  const [folderRevision,setFolderRevision]=useState(0)
  useEffect(()=>{void window.yorw.documents.library({action:'list'}).then(r=>{if(r.ok){setFolders(r.value.items);if(selectedFolder!=='root'&&!r.value.items.some((f:Folder)=>f.id===selectedFolder))setSelectedFolder('root')}})},[folderRevision])
  useEffect(()=>{try{localStorage.setItem('yorw-selected-folder',selectedFolder)}catch{}},[selectedFolder])
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('正在加载文献…')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [imports, setImports] = useState<ImportItem[]>([])
  const [reparseChoice, setReparseChoice] = useState<Record<string, 'builtin' | 'enhanced'>>({})
  useEffect(() => {
    let active = true
    async function load() {
      void window.yorw.documents.library({action:'list'}).then(r=>{if(active&&r.ok)setFolders(r.value.items)}).catch(()=>{})
      try { const result = await window.yorw.documents.list(); if (active && result.ok) { const items = result.value.items; setDocuments(items); onTitles(items); setImports(previous => previous.map(item => { const current = item.document && items.find(document => document.id === item.document?.id); return current ? { ...item, document: current } : item })); setLoaded(true); setMessage(previous => previous === '正在加载文献…' ? '' : previous) } else if (active && !result.ok) setMessage(explain(result.code)) }
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
  async function importPdfs() {
    setBusy(true); setMessage('请选择文献，正在导入…')
    try {
      const result = await window.yorw.documents.importPdfs()
      if (!result.ok) { setMessage(explain(result.code)); return }
      if (result.value.cancelled) { setMessage('已取消选择'); return }
      const items = result.value.items
      let assignmentWarning=''
      if(selectedFolder!=='root'){const fresh=items.filter(i=>i.ok&&!i.deduplicated&&i.document);if(fresh.length){const assigned=await window.yorw.documents.library({action:'assign',value:{folder_id:selectedFolder,documents:Object.fromEntries(fresh.map(i=>[i.document!.id,i.document!.version]))}});if(!assigned.ok)assignmentWarning='导入成功，但归类失败，请手动移动。'}}
      setImports(items)
      const succeeded = items.filter(item => item.ok).length
      const duplicates = items.filter(item => item.ok && item.deduplicated).length
      const failed = items.length - succeeded
      setMessage(`导入完成：${succeeded} 篇成功${duplicates ? `（${duplicates} 篇已存在）` : ''}${failed ? `，${failed} 篇失败` : ''}。${assignmentWarning}`)
      const documentsResult = await window.yorw.documents.list()
      if (documentsResult.ok) { setDocuments(documentsResult.value.items); onTitles(documentsResult.value.items) }
    } catch { setMessage('导入失败，请重试。') } finally { setBusy(false) }
  }
  async function organize(document: DocumentRecord) {
    onOpenTool('metadata', document)
  }
  function metadataSaved(warning?: string, saved?: DocumentRecord) {
    setMessage(warning || '元数据已保存。')
    if (saved) {
      setDocuments(items => items.map(item => item.id === saved.id ? saved : item))
      setImports(items => items.map(item => item.document?.id === saved.id ? { ...item, document: saved } : item))
    }
    void window.yorw.documents.list().then(result => { if (result.ok) { setDocuments(result.value.items); onTitles(result.value.items) } })
  }
  async function remove(document: DocumentRecord) {
    if (documentHasUnsavedNotes(document.id)) { setMessage('这篇文献仍有未保存笔记，请打开阅读器保存或放弃更改后再移除。'); return }
    if (!window.confirm(`移除“${document.title || document.original_name}”？将删除受管原文与可检索内容块；历史笔记和 Wiki 的来源快照将保留并标记失效。`)) return
    setBusy(true)
    try { const result = await window.yorw.documents.remove({ id: document.id, version: document.version }); setMessage(result.ok ? result.value.cleanup_pending ? '记录已移除，文件清理待重试，请关闭重开知栖。' : '文献已移除。' : explain(result.code)); if (result.ok) setDocuments(items => items.filter(item => item.id !== document.id)) }
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
    try { const result = await window.yorw.documents.reparse({id:document.id,processor:'builtin'}); setMessage(result.ok ? '已创建内置解析重试任务。' : explain(result.code)) }
    catch { setMessage('重试失败。') } finally { setBusy(false) }
  }
  async function reparse(document: DocumentRecord, processor: 'builtin' | 'enhanced') {
    setBusy(true)
    try {
      const result = await window.yorw.documents.reparse({ id: document.id, processor })
      setMessage(result.ok ? `已创建${processor === 'enhanced' ? '增强' : '内置'}解析任务。` : result.code==='COMPONENT_MISSING' ? processor==='enhanced'?'增强解析是可选功能，需要先在 House 配置 Docling；未配置时请选择内置解析，已有内容仍可使用。':'旧 DOC 解析需要可选 LibreOffice；可将文件另存为 DOCX 后使用内置解析。' : explain(result.code))
    } catch { setMessage('重新解析失败，请重试。') } finally { setBusy(false) }
  }
  if (activeDocumentId) {
    if (!loaded) return <p role="status" className="library-view">正在加载文献…</p>
    if (!reading) return <section className="library-missing card" aria-label="文献不可用"><h2>文献不可用</h2><p>这篇文献可能已被移除，请从文献库重新选择。</p><button onClick={onShowLibrary}>返回文献库</button></section>
    if (activeTool === 'metadata') return <MetadataTool key={`metadata:${reading.id}`} document={reading} onOpenDocument={() => onOpenDocument(reading)} onClose={() => onCloseMetadata(reading)} onSaved={metadataSaved} />
    if (activeTool && activeTool !== 'document') return <DocumentTool key={`${activeTool}:${reading.id}`} document={reading} tool={activeTool} onOpenDocument={() => onOpenDocument(reading)} onCollapse={() => activeTool !== 'resource' && onCollapseTool(activeTool, reading)} onEditMetadata={() => onOpenTool('metadata', reading)} onNavigate={target => onNavigate(reading, target)} onShowNotes={() => onShowNotes(reading)} onOpenSearch={() => onOpenTool('search', reading)} onOpenChat={() => onOpenTool('chat', reading)} onOpenTopic={onOpenTopic} />
    return <ReadingWorkspace key={reading.id} document={reading} onClose={closeReading} onExpand={tool => onOpenTool(tool, reading)} onResource={() => onOpenTool('resource', reading)} jump={pendingJump?.documentId === reading.id ? pendingJump : undefined} onJumpApplied={onJumpApplied} />
  }
  const visible = filterDocuments(directDocuments(documents,selectedFolder), query)
  return <div className={`storage-workspace${storageDirectoryCollapsed ? ' collapsed' : ''}`} style={{'--directory-width':`${directoryWidth.width}px`} as React.CSSProperties}>
    {!storageDirectoryCollapsed && <aside className="storage-directory" aria-label="文献目录">
      <div className="storage-directory-header"><h2>文献目录</h2><span>{directDocuments(documents,selectedFolder).length} 篇</span></div>
      <LibraryDirectory documents={directDocuments(documents,selectedFolder)} folders={folders} busy={busy} selected={selectedFolder} onSelect={setSelectedFolder} onChange={()=>{setFolderRevision(v=>v+1);void window.yorw.documents.list().then(r=>{if(r.ok)setDocuments(r.value.items)})}} onOpen={onOpenDocument} onMetadata={d=>onOpenTool('resource',d)} onEdit={d=>onOpenTool('metadata',d)} onRemove={d=>void remove(d)} onImport={()=>void importPdfs()}/>

    </aside>}
    {!storageDirectoryCollapsed&&<DirectorySplitter width={directoryWidth.width} onResize={directoryWidth.update}/>}
    <div className="storage-content">
      <div className="storage-content-bar"><span>文献列表</span><button onClick={onToggleStorageDirectory}>{storageDirectoryCollapsed ? '展开目录' : '收起目录'}</button></div>
      <div className="library-view">
        <p className="library-current-path">{['根目录',...folderPath(folders,selectedFolder).map(f=>f.name)].join(' / ')}</p>
      <div className="library-toolbar">
          <label className="library-search"><span>搜索文献</span><input aria-label="搜索文献" type="search" placeholder="搜索标题、文件名、作者、标签…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <span>{visible.length} 篇文献</span>
        </div>
        <p role="status">{message}</p>
        {imports.length > 0 && <ImportResults items={imports} onOrganize={organize} onOpen={onOpenDocument} onDismiss={() => setImports([])} />}
        {loaded && !documents.length && <section className="library-empty card"><h2>从一篇论文开始</h2><p>导入 PDF、DOCX、DOC、Markdown 或纯文本，保存自己的研究材料。PDF 使用原文阅读器，其他格式使用原件预览。</p></section>}
        {documents.length > 0 && !visible.length && <section className="library-empty card"><h2>{query.trim()?'没有匹配的文献':'当前目录暂无文献'}</h2>{query.trim()&&<><p>尝试其他文件名、标题、作者或标签。</p><button onClick={() => setQuery('')}>清除搜索</button></>}</section>}
        <div className="document-list">{visible.map(document => {
          const parseStatus = document.parse_status
          const parsing = ['pending', 'running'].includes(document.extraction_status) || ['pending', 'running'].includes(parseStatus ?? '') || document.task?.status === 'running'
          const processor = reparseChoice[document.id] ?? 'builtin'
          return <section key={document.id} className="document-row"><h2>{document.title || document.original_name}</h2><p className="file-name">{document.original_name} · {(document.format ?? 'pdf').toUpperCase()}</p><p>{document.authors.length ? document.authors.join('、') : '作者未知'} · {document.year ?? '年份未知'} · {document.format && document.format !== 'pdf' ? '结构化内容' : document.page_count === null ? '页数待解析' : `${document.page_count} 页`}</p><p><strong>{labels[document.extraction_status] ?? document.extraction_status}</strong>{document.task?.status === 'running' && document.task.progress !== null ? ` · ${Math.round(document.task.progress * 100)}%` : ''}</p>
            {parseStatus && parseStatus !== document.extraction_status && <p className="file-name">{parseStatus === 'running' ? '正在重新解析' : `上次解析：${parseLabels[parseStatus] ?? parseStatus}`}{parseStatus !== 'running' && document.parse_warning ? ` · ${explain(document.parse_warning)}` : ''}{parseStatus !== 'running' && ['ready', 'partial'].includes(document.extraction_status) ? '（继续使用上一可用版本）' : ''}</p>}
            {document.warning && <p className="warning">{explain(document.warning)}</p>}
            {document.parse_warnings?.length ? <p className="file-name">解析提示：{document.parse_warnings.slice(0, 2).map(item => explain(item.code)).join('；')}</p> : null}
            <div className="actions"><button disabled={busy} onClick={() => onOpenDocument(document)}>打开阅读</button><button disabled={busy} onClick={() => onOpenTool('resource', document)}>文献资料</button><button disabled={busy} onClick={() => onOpenTool('metadata', document)}>编辑元数据</button>{parsing ? <button disabled={busy} onClick={() => void cancel(document)}>停止解析</button> : <><select aria-label={`重新解析处理器 ${document.title || document.original_name}`} value={processor} disabled={busy} onChange={event => setReparseChoice(previous => ({ ...previous, [document.id]: event.target.value as 'builtin' | 'enhanced' }))}><option value="builtin">内置解析</option><option value="enhanced">增强解析（可选 Docling）</option></select><button disabled={busy} onClick={() => void reparse(document, processor)}>重新解析</button></>}{['failed', 'partial'].includes(document.extraction_status) && !parsing && <button disabled={busy} onClick={() => void retry(document)}>内置解析重试</button>}<button disabled={busy} onClick={() => void remove(document)}>移除文献</button></div></section>
        })}</div>
      </div>
    </div>
  </div>
}
