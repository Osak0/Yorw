import React, { useEffect, useRef, useState } from 'react'
import type { DocumentRecord, ReaderTarget } from '../shared/status'
import { PdfReader } from './PdfReader'
import { OriginalReader } from './OriginalReader'
import { NotesPanel } from './NotesPanel'
import { notebookFor } from './notebook'
import { ChatPanel } from './ChatPanel'
import { SearchPanel } from './SearchPanel'
import { sessionStore, useDocumentSession, type SidebarMode } from './session-state'
import './notes.css'

interface ReaderJump extends ReaderTarget { sequence: number }

export function ReadingWorkspace({ document, onClose, onExpand, onResource, jump: externalJump, onJumpApplied }: {
  document: DocumentRecord
  onClose(): void
  onExpand(tool: SidebarMode): void
  onResource(): void
  jump?: ReaderJump
  onJumpApplied?(sequence: number): void
}) {
  const [narrow, setNarrow] = useState(window.innerWidth <= 1100)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [localJump, setLocalJump] = useState<ReaderJump>()
  const session = useDocumentSession(document.id)
  const open = session.sidebarOpen ?? !narrow
  const width = dragWidth ?? session.sidebarWidth
  const mode = session.sidebarMode
  const jump = externalJump ?? localJump
  const opener = useRef<SidebarMode>('notes')
  function openPanel(next: SidebarMode) {
    opener.current = next
    sessionStore().updateDocument(document.id, { sidebarMode: next, sidebarOpen: true })
  }
  const modal = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)')
    const resize = () => setNarrow(media.matches)
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (open && narrow && modal.current && !modal.current.open) modal.current.showModal()
  }, [open, narrow])
  function closeNotes() {
    sessionStore().updateDocument(document.id, { sidebarOpen: false })
    requestAnimationFrame(() => window.document.querySelector<HTMLButtonElement>(opener.current === 'chat' ? '.chat-toggle' : opener.current === 'search' ? '.search-toggle' : '.note-toggle')?.focus())
  }
  function setMode(next: SidebarMode) {
    sessionStore().updateDocument(document.id, { sidebarMode: next })
  }
  const contents = <>
    <div className="notes-heading">
      <div className="workspace-panel-tabs" role="group" aria-label="文献侧栏"><button aria-pressed={mode === 'notes'} onClick={() => setMode('notes')}>笔记</button><button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>检索</button><button aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>问答</button></div>
      <div className="notes-heading-actions"><button title="展开为标签" onClick={() => onExpand(mode)}>展开为标签</button><button aria-label="关闭文献侧栏" onClick={closeNotes}>关闭</button></div>
    </div>
    {mode === 'notes' && <div className="workspace-panel-body notes-body"><NotesPanel documentId={document.id} /></div>}
    {mode === 'search' && <div className="workspace-panel-body search-body"><SearchPanel documentId={document.id} onNavigate={target => { setLocalJump({ ...target, sequence: Date.now() }); if (narrow) closeNotes() }} /></div>}
    {mode === 'chat' && <div className="workspace-panel-body chat-body"><ChatPanel documentId={document.id} onNavigate={target => { setLocalJump({ ...target, sequence: Date.now() }); if (narrow) closeNotes() }} onNote={id => { void notebookFor(document.id).importSaved(id).then(() => setMode('notes')).catch(() => window.alert('笔记已保存，加载失败；请重新打开文献。')) }} /></div>}
  </>
  const pdf = (document.format ?? 'pdf') === 'pdf'
  return <div className="reading-workspace"><div className="reading-primary">{pdf
    ? <PdfReader document={document} onClose={onClose} onNotes={() => openPanel('notes')} notesOpen={open && mode === 'notes'} onSearch={() => openPanel('search')} searchOpen={open && mode === 'search'} onChat={() => openPanel('chat')} chatOpen={open && mode === 'chat'} onResource={onResource} jump={jump?.page ? { page: jump.page, sequence: jump.sequence } : undefined} onJumpApplied={externalJump ? onJumpApplied : undefined} />
    : <OriginalReader document={document} onClose={onClose} onNotes={() => openPanel('notes')} notesOpen={open && mode === 'notes'} onSearch={() => openPanel('search')} searchOpen={open && mode === 'search'} onChat={() => openPanel('chat')} chatOpen={open && mode === 'chat'} onResource={onResource} jump={jump} onJumpApplied={externalJump ? onJumpApplied : undefined} />}</div>
    {open && (narrow ? <dialog className="notes-overlay" aria-label="文献笔记与检索" ref={modal} onCancel={event => { event.preventDefault(); closeNotes() }}>{contents}</dialog> : <>
      <div className="notes-resizer" role="separator" tabIndex={0} aria-label="调整笔记侧栏宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={480} aria-valuenow={width}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setDragWidth(Math.max(320, Math.min(480, window.innerWidth - 24 - event.clientX))) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId); const next = Math.max(320, Math.min(480, window.innerWidth - 24 - event.clientX)); setDragWidth(null); sessionStore().updateDocument(document.id, { sidebarWidth: next }) } }}
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 320 : event.key === 'End' ? 480 : Math.max(320, Math.min(480, width + (event.key === 'ArrowLeft' ? 20 : -20))); sessionStore().updateDocument(document.id, { sidebarWidth: next }) } }} />
      <aside className="notes-sidebar" aria-label="文献笔记与检索" style={{ width }}>{contents}</aside></>)}
  </div>
}
