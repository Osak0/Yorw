import React from 'react'
import type { DocumentRecord } from '../shared/status'
import { NotesPanel } from './NotesPanel'
import { SearchPanel } from './SearchPanel'
import { ChatPanel } from './ChatPanel'
import { notebookFor } from './notebook'
import type { StorageTool } from './workspace-tabs'

export function DocumentTool({ document, tool, onOpenDocument, onCollapse, onNavigate, onShowNotes }: {
  document: DocumentRecord
  tool: StorageTool
  onOpenDocument(): void
  onCollapse(): void
  onNavigate(page: number): void
  onShowNotes(): void
}) {
  const label = { notes: '笔记', search: '检索', chat: '问答' }[tool]
  const title = document.title || document.original_name
  return <div className="document-tool-view" aria-label={`${label} · ${title}`}>
    <div className="document-tool-header">
      <div className="document-tool-identity"><strong>{title}</strong><span>{label}</span></div>
      <div className="document-tool-actions"><button onClick={onOpenDocument}>打开阅读</button><button onClick={onCollapse}>返回阅读侧栏</button></div>
    </div>
    <div className={`document-tool-body ${tool}-tool`}>
      {tool === 'notes' && <NotesPanel documentId={document.id} />}
      {tool === 'search' && <SearchPanel documentId={document.id} onPage={onNavigate} />}
      {tool === 'chat' && <ChatPanel documentId={document.id} onPage={onNavigate} onNote={id => { void notebookFor(document.id).importSaved(id).then(onShowNotes).catch(() => window.alert('笔记已保存，加载失败；请重新打开文献。')) }} />}
    </div>
  </div>
}
