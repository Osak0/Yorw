import React, { useEffect, useState } from 'react'
import type { DocumentBlock, DocumentRecord } from '../shared/status'
import './reader.css'

interface StructuredJump { block_id: string; sequence: number }

const errorMessage = (code: string) => ({
  DOCUMENT_NOT_FOUND: '文献已被移除，请返回文献库。',
  TEXT_NOT_READY: '当前文献尚无可用内容块，请重新解析。',
  OPERATION_FAILED: '内容块加载失败，请重试。',
} as Record<string, string>)[code] ?? '内容块加载失败，请重试。'

export function StructuredReader({ document: record, onClose, onNotes, notesOpen, onSearch, searchOpen, onChat, chatOpen, onResource, jump, onJumpApplied }: {
  document: DocumentRecord
  onClose(): void
  onNotes(): void
  notesOpen: boolean
  onSearch(): void
  searchOpen: boolean
  onChat(): void
  chatOpen: boolean
  onResource(): void
  jump?: StructuredJump
  onJumpApplied?(sequence: number): void
}) {
  const [blocks, setBlocks] = useState<DocumentBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [highlight, setHighlight] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void window.yorw.documents.blocks(record.id).then(result => {
      if (!active) return
      if (result.ok) setBlocks(result.value.items)
      else setError(errorMessage(result.code))
      setLoading(false)
    }).catch(() => { if (active) { setError('内容块加载失败，请重试。'); setLoading(false) } })
    return () => { active = false }
  }, [record.id, retry])
  function scrollToBlock(identity: string) {
    const element = window.document.getElementById(`block-${identity}`)
    if (!element) return false
    element.scrollIntoView({ block: 'start' })
    setHighlight(identity)
    window.setTimeout(() => setHighlight(current => current === identity ? '' : current), 1800)
    return true
  }
  useEffect(() => {
    if (!jump || loading) return
    if (!scrollToBlock(jump.block_id)) setError('来源内容块不可用，可能已被重新解析。')
    onJumpApplied?.(jump.sequence)
  }, [jump, loading, blocks, onJumpApplied])
  const headings = blocks.filter(block => block.block_type === 'heading')
  function renderBlock(block: DocumentBlock) {
    const identity = `block-${block.id}`
    const className = `structured-block structured-${block.block_type}${highlight === block.id ? ' structured-highlight' : ''}`
    if (block.block_type === 'heading') {
      if ((block.heading_level ?? 1) <= 1) return <h2 key={block.id} id={identity} className={`${className} structured-heading`}>{block.text}</h2>
      if ((block.heading_level ?? 2) === 2) return <h3 key={block.id} id={identity} className={`${className} structured-heading`}>{block.text}</h3>
      return <h4 key={block.id} id={identity} className={`${className} structured-heading`}>{block.text}</h4>
    }
    if (block.block_type === 'table') return <pre key={block.id} id={identity} className={`${className} structured-table`}>{block.text}</pre>
    if (block.block_type === 'code') return <pre key={block.id} id={identity} className={`${className} structured-code`}><code>{block.text}</code></pre>
    if (block.block_type === 'quote') return <blockquote key={block.id} id={identity} className={className}>{block.text}</blockquote>
    if (block.block_type === 'list_item') return <p key={block.id} id={identity} className={`${className} structured-list-item`}>{block.text}</p>
    return <p key={block.id} id={identity} className={className}>{block.text}</p>
  }
  return <div className="reader structured-reader" aria-label="结构化阅读器">
    <div className="reader-toolbar"><button onClick={onClose}>返回文献库</button><button className="note-toggle" aria-expanded={notesOpen} onClick={onNotes}>笔记</button><button className="search-toggle" aria-expanded={searchOpen} onClick={onSearch}>检索</button><button className="chat-toggle" aria-expanded={chatOpen} onClick={onChat}>问答</button><button className="resource-toggle" onClick={onResource}>资料</button><span className="reader-title" title={record.title || record.original_name}>{record.title || record.original_name}</span><span className="structured-meta">{(record.format ?? 'txt').toUpperCase()} · {blocks.length} 个内容块</span></div>
    {record.extraction_status !== 'ready' && <p className="reader-warning">{record.extraction_status === 'partial' ? '仅部分内容已解析。' : '该文献尚无完整可检索内容。'}当前结构化视图只显示已解析内容块。</p>}
    <div className="reader-feedback" role="status">{loading ? '正在加载内容块…' : error}{!loading && error && <button onClick={() => setRetry(value => value + 1)}>重试加载</button>}</div>
    <div className="structured-body">
      <nav className="structured-toc" aria-label="章节导航"><strong>章节</strong>{headings.length ? headings.map(block => <button key={block.id} type="button" onClick={() => scrollToBlock(block.id)} style={{ paddingLeft: 6 + Math.max(0, (block.heading_level ?? 1) - 1) * 12 }}>{block.text}</button>) : <span>没有标题层级</span>}</nav>
      <article className="structured-content">{blocks.map(renderBlock)}</article>
    </div>
  </div>
}
