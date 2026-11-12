import React,{useState} from 'react'
import { EnrichmentPanel } from './EnrichmentPanel'
import type { DocumentRecord, ReaderTarget, Topic } from '../shared/status'
import { NotesPanel } from './NotesPanel'
import { SearchPanel } from './SearchPanel'
import { ChatPanel } from './ChatPanel'
import { DocumentResourceView } from './DocumentResource'
import { notebookFor } from './notebook'
import type { StorageTool } from './workspace-tabs'

export function DocumentTool({ document, tool, onOpenDocument, onCollapse, onEditMetadata, onNavigate, onShowNotes, onOpenSearch, onOpenChat, onOpenTopic }: {
  document: DocumentRecord
  tool: StorageTool
  onOpenDocument(): void
  onCollapse(): void
  onEditMetadata(): void
  onNavigate(target: ReaderTarget): void
  onShowNotes(): void
  onOpenSearch(): void
  onOpenChat(): void
  onOpenTopic(topic: Topic): void
}) {
  const [chatSearchHost,setChatSearchHost]=useState<HTMLDivElement|null>(null)
  const label = { notes: '笔记', search: '检索', chat: '问答', resource: '编辑元数据', metadata: '编辑元数据', enrichment: 'AI 辅助文献整理' }[tool]
  const title = document.title || document.original_name
  return <div className="document-tool-view" aria-label={`${label} · ${title}`}>
    <div className="document-tool-header">
      <div className="document-tool-identity"><strong>{title}</strong><span>{label}</span></div>
      <div className="document-tool-actions">{tool==='chat'&&<div className="chat-header-search" ref={setChatSearchHost}/>}<button onClick={onOpenDocument}>打开阅读</button>{tool !== 'resource' && tool !== 'enrichment' && <button onClick={onCollapse}>返回阅读侧栏</button>}</div>
    </div>
    <div className={`document-tool-body ${tool}-tool`}>
      {tool === 'enrichment' && <EnrichmentPanel id={document.id} onNavigate={onNavigate} onChanged={()=>{}} />}
      {tool === 'notes' && <NotesPanel documentId={document.id} />}
      {tool === 'search' && <SearchPanel showHistory documentId={document.id} onNavigate={onNavigate} />}
      {tool === 'chat' && <ChatPanel searchHost={chatSearchHost} documentId={document.id} onNavigate={onNavigate} onNote={id => { void notebookFor(document.id).importSaved(id).then(onShowNotes).catch(() => window.alert('笔记已保存，加载失败；请重新打开文献。')) }} />}
      {tool === 'resource' && <DocumentResourceView key={document.id} document={document} onEditMetadata={onEditMetadata} onOpenNotes={onShowNotes} onOpenSearch={onOpenSearch} onOpenChat={onOpenChat} onOpenTopic={onOpenTopic} onNavigate={onNavigate} />}
    </div>
  </div>
}
