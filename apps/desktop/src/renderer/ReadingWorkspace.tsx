import React, { useEffect, useRef, useState } from 'react'
import type { DocumentRecord } from '../shared/status'
import { PdfReader } from './PdfReader'
import { NotesPanel } from './NotesPanel'
import './notes.css'

export function ReadingWorkspace({ document, onClose }: {document: DocumentRecord; onClose(): void}) {
  const [narrow, setNarrow] = useState(window.innerWidth <= 1100)
  const [open, setOpen] = useState(window.innerWidth > 1100)
  const [width, setWidth] = useState(380)
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
    setOpen(false)
    requestAnimationFrame(() => window.document.querySelector<HTMLButtonElement>('.note-toggle')?.focus())
  }
  const contents = <><div className="notes-heading"><h2>笔记</h2><button aria-label="关闭笔记侧栏" onClick={closeNotes}>关闭</button></div><NotesPanel documentId={document.id} /></>
  return <div className="reading-workspace"><div className="reading-primary"><PdfReader document={document} onClose={onClose} onNotes={() => setOpen(value => !value)} notesOpen={open} /></div>
    {open && (narrow ? <dialog className="notes-overlay" aria-label="文献笔记" ref={modal} onCancel={event => { event.preventDefault(); closeNotes() }}>{contents}</dialog> : <>
      <div className="notes-resizer" role="separator" tabIndex={0} aria-label="调整笔记侧栏宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={480} aria-valuenow={width}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(320, Math.min(480, window.innerWidth - 24 - event.clientX))) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setWidth(value => event.key === 'Home' ? 320 : event.key === 'End' ? 480 : Math.max(320, Math.min(480, value + (event.key === 'ArrowLeft' ? 20 : -20)))) } }} />
      <aside className="notes-sidebar" aria-label="文献笔记" style={{ width }}>{contents}</aside></>)}
  </div>
}
