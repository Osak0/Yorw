import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentRecord, DocumentResource, DocumentSummary, Topic } from '../shared/status'
import './resources.css'

const explain = (code: string) => ({
  RELATION_SELF: '不能把文献关联到自身。',
  TOPIC_NOT_FOUND: '专题不存在，请刷新目录后重试。',
  SEARCH_HISTORY_NOT_FOUND: '这条检索历史已不存在。',
  DOCUMENT_NOT_FOUND: '文献不存在或已被移除。',
  TASK_RUNNING: '当前文献已有检索任务在进行，请稍后再试。',
  INVALID_INPUT: '输入无效，请检查后重试。',
  BACKEND_NOT_READY: '本地服务不可用，请重新打开知栖。'
} as Record<string, string>)[code] ?? `操作失败（${code}），请重试。`

const historyStatus = (status: string) => ({
  queued: '等待执行', running: '正在执行', succeeded: '已完成', failed: '失败',
  interrupted: '已中断', cancelled: '已取消'
} as Record<string, string>)[status] ?? status

type Candidate = DocumentSummary & { shared_tags: string[] }

export function DocumentResourceSections({ resource, topics, notice, busy, candidates, candidateQuery, candidateDescription,
  onEditMetadata, onAddTopic, onRemoveTopic, onSearchCandidates, onAddRelation, onRemoveRelation, onOpenNotes,
  onOpenSearch, onOpenChat, onNavigate, onDeleteHistory, onClearHistory, onRunSearch, onCandidateQuery, onCandidateDescription }: {
  resource: DocumentResource
  topics: Topic[]
  notice: string
  busy: boolean
  candidates: Candidate[]
  candidateQuery: string
  candidateDescription: string
  onEditMetadata(): void
  onAddTopic(topicId: string): void
  onRemoveTopic(topicId: string): void
  onSearchCandidates(): void
  onAddRelation(documentId: string, description: string): void
  onRemoveRelation(documentId: string): void
  onOpenNotes(): void
  onOpenSearch(): void
  onOpenChat(): void
  onNavigate(page: number): void
  onDeleteHistory(historyId: string): void
  onClearHistory(): void
  onRunSearch(query: string): void
  onCandidateQuery(value: string): void
  onCandidateDescription(value: string): void
}) {
  const [topicChoice, setTopicChoice] = useState('')
  const document = resource.document
  const linked = new Set(resource.topics.map(item => item.topic.id))
  const availableTopics = topics.filter(topic => !linked.has(topic.id))
  return <div className="document-resource-view" aria-label="文献资料">
    <header className="resource-header">
      <div><h2>{document.title || document.original_name}</h2><p className="resource-file">{document.original_name}</p>
        <p>{document.authors.length ? document.authors.join('、') : '作者未知'} · {document.year ?? '年份未知'} · {document.page_count ?? '—'} 页</p></div>
      <button disabled={busy} onClick={onEditMetadata}>编辑元数据</button>
    </header>
    {notice && <p role="status" className="resource-notice">{notice}</p>}
    <section className="resource-section" aria-label="人工总结">
      <h3>人工总结 <small>{document.summary_source === 'manual' ? '人工编辑' : document.summary_source === 'ai' ? 'AI 生成，已人工确认' : '尚未记录'}{document.summary_updated_at ? ` · ${document.summary_updated_at}` : ''}</small></h3>
      {document.summary_md ? <p className="resource-summary">{document.summary_md}</p> : <p className="resource-empty">尚未填写人工总结。总结不会替代原文证据。</p>}
    </section>
    <section className="resource-section" aria-label="关键词标签">
      <h3>关键词 / 标签</h3>
      {document.tags.length ? <div className="resource-tags">{document.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : <p className="resource-empty">尚未添加标签。</p>}
    </section>
    <section className="resource-section" aria-label="所属专题">
      <h3>所属专题</h3>
      {resource.topics.length ? <ul className="resource-list">{resource.topics.map(item => <li key={item.topic.id}>
        <span>{item.path.join(' / ')}</span><button disabled={busy} onClick={() => onRemoveTopic(item.topic.id)}>解除关联</button>
      </li>)}</ul> : <p className="resource-empty">尚未关联专题。</p>}
      <div className="resource-inline"><select aria-label="关联专题" value={topicChoice} disabled={busy || !availableTopics.length} onChange={event => setTopicChoice(event.target.value)}>
        <option value="">选择专题</option>{availableTopics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
      </select><button disabled={busy || !topicChoice} onClick={() => { onAddTopic(topicChoice); setTopicChoice('') }}>关联专题</button></div>
    </section>
    <section className="resource-section" aria-label="相关文献">
      <h3>相关文献</h3>
      <p className="resource-hint">相关文献由你手动建立，双向显示，不等同学术引用，也不会自动扩大 AI 材料范围。</p>
      {resource.related.length ? <ul className="resource-list">{resource.related.map(item => <li key={item.document.id}>
        <div><strong>{item.document.title || item.document.original_name}</strong>{!item.document_available && <em>（文献已移除）</em>}
          {item.description && <p>{item.description}</p>}</div>
        <button disabled={busy} onClick={() => onRemoveRelation(item.document.id)}>解除关联</button>
      </li>)}</ul> : <p className="resource-empty">尚未关联其他文献。</p>}
      <div className="resource-inline"><input aria-label="查找可关联文献" placeholder="按标题、作者、年份或标签查找" value={candidateQuery} disabled={busy}
        onChange={event => onCandidateQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSearchCandidates() } }} />
        <button disabled={busy} onClick={onSearchCandidates}>查找文献</button></div>
      {!!candidates.length && <div className="resource-candidates"><label>关联说明（可选）<input aria-label="关联说明" maxLength={500} value={candidateDescription} disabled={busy} onChange={event => onCandidateDescription(event.target.value)} /></label>
        <ul className="resource-list">{candidates.map(item => <li key={item.id}><div><strong>{item.title || item.original_name}</strong>{!!item.shared_tags.length && <small>共同标签：{item.shared_tags.join('、')}</small>}</div>
          <button disabled={busy} onClick={() => onAddRelation(item.id, candidateDescription)}>关联</button></li>)}</ul></div>}
    </section>
    <section className="resource-section" aria-label="相同标签">
      <h3>相同标签</h3>
      <p className="resource-hint">相同标签只辅助查找；是否建立关联由你决定。</p>
      {resource.tag_matches.length ? <ul className="resource-list">{resource.tag_matches.map(item => <li key={item.document.id}>
        <div><strong>{item.document.title || item.document.original_name}</strong><small>{item.shared_tags.join('、')}</small></div>
        <button disabled={busy} onClick={() => onAddRelation(item.document.id, '')}>关联</button>
      </li>)}</ul> : <p className="resource-empty">没有使用相同标签的其他文献。</p>}
    </section>
    <section className="resource-section" aria-label="笔记">
      <h3>笔记 <button className="resource-link-button" onClick={onOpenNotes}>打开笔记</button></h3>
      {resource.notes.length ? <ul className="resource-list">{resource.notes.map(note => <li key={note.id}><div><p>{note.excerpt}</p><small>v{note.version} · {note.updated_at}</small></div></li>)}</ul> : <p className="resource-empty">还没有笔记。</p>}
    </section>
    <section className="resource-section" aria-label="检索历史">
      <h3>检索历史 <button className="resource-link-button" onClick={onOpenSearch}>打开检索</button>{!!resource.search_history.length && <button className="resource-link-button" disabled={busy} onClick={onClearHistory}>清空历史</button>}</h3>
      <p className="resource-hint">查看历史不会调用模型；重新检索才会创建新任务。来源变化后会标记失效。</p>
      {resource.search_history.length ? <ul className="resource-history">{resource.search_history.map(entry => <li key={entry.id}>
        <div className="resource-history-head"><strong>{entry.query}</strong><small>{entry.created_at} · {historyStatus(entry.status)}{entry.error_code ? ` · ${entry.error_code}` : ''}</small>
          <button disabled={busy} onClick={() => onDeleteHistory(entry.id)}>删除</button><button disabled={busy} onClick={() => onRunSearch(entry.query)}>重新检索</button></div>
        {!!entry.items.length && <ul>{entry.items.map(item => <li key={item.id}><p>{item.snippet}</p><small>{item.physical_page ? `第 ${item.physical_page} 页` : '无页码'}{!item.available && ' · 来源已失效'}</small>
          <button disabled={!item.available || !item.physical_page} onClick={() => item.physical_page && onNavigate(item.physical_page)}>查看原文</button></li>)}</ul>}
      </li>)}</ul> : <p className="resource-empty">还没有检索历史。</p>}
    </section>
    <section className="resource-section" aria-label="问答历史">
      <h3>问答历史 <button className="resource-link-button" onClick={onOpenChat}>打开问答</button></h3>
      {resource.chat.length ? <ul className="resource-list">{resource.chat.map(message => <li key={message.id}><div><strong>{message.question}</strong><p>{message.body_excerpt}</p>
        <small>{historyStatus(message.status)}{message.error_code ? ` · ${message.error_code}` : ''} · {message.sources_count} 条来源 · {message.citations} 条引用</small></div></li>)}</ul> : <p className="resource-empty">还没有问答记录。</p>}
    </section>
  </div>
}

export function DocumentResourceView({ document, onEditMetadata, onOpenNotes, onOpenSearch, onOpenChat, onOpenTopic, onNavigate }: {
  document: DocumentRecord
  onEditMetadata(): void
  onOpenNotes(): void
  onOpenSearch(): void
  onOpenChat(): void
  onOpenTopic(topic: Topic): void
  onNavigate(page: number): void
}) {
  const [resource, setResource] = useState<DocumentResource | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [candidateDescription, setCandidateDescription] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const [loaded, directory] = await Promise.all([
        window.yorw.resources.resource(document.id),
        window.yorw.garden.list()
      ])
      if (sequence !== loadSequence.current) return
      if (loaded.ok) setResource(loaded.value)
      else setNotice(explain(loaded.code))
      if (directory.ok) setTopics(directory.value.items)
    } catch {
      if (sequence === loadSequence.current) setNotice('文献资料加载失败，请重试。')
    }
  }, [document.id])
  useEffect(() => { void load() }, [load])
  async function action(run: () => Promise<{ ok: boolean; code?: string }>, success: string) {
    setBusy(true); setNotice('')
    try {
      const result = await run()
      if (!result.ok) { setNotice(explain(result.code ?? 'OPERATION_FAILED')); return }
      await load(); setNotice(success)
    } catch { setNotice('操作失败，请重试。') } finally { setBusy(false) }
  }
  async function searchCandidates() {
    setBusy(true); setNotice('')
    try {
      const result = await window.yorw.resources.candidates({ id: document.id, query: candidateQuery })
      if (result.ok) { setCandidates(result.value.items); if (!result.value.items.length) setNotice('没有找到可关联的文献。') }
      else setNotice(explain(result.code))
    } catch { setNotice('查找失败，请重试。') } finally { setBusy(false) }
  }
  async function runSearch(query: string) {
    setBusy(true); setNotice('')
    try {
      const result = await window.yorw.ai.run({ kind: 'search', target_id: document.id, text: query, request_id: crypto.randomUUID() })
      if (!result.ok) { setNotice(explain(result.code)); return }
      onOpenSearch()
    } catch { setNotice('重新检索失败，请重试。') } finally { setBusy(false) }
  }
  if (!resource) return <div className="document-resource-view" aria-label="文献资料"><p role="status">正在加载文献资料…</p><p role="status">{notice}</p></div>
  return <>
    <DocumentResourceSections resource={resource} topics={topics} notice={notice} busy={busy} candidates={candidates}
      candidateQuery={candidateQuery} candidateDescription={candidateDescription}
      onEditMetadata={onEditMetadata}
      onAddTopic={topicId => void action(() => window.yorw.resources.addDocumentTopic({ document_id: document.id, topic_id: topicId }), '已关联专题。')}
      onRemoveTopic={topicId => void action(() => window.yorw.resources.removeDocumentTopic({ document_id: document.id, topic_id: topicId }), '已解除专题关联；笔记和正文保持不变。')}
      onSearchCandidates={() => void searchCandidates()}
      onAddRelation={(relatedId, description) => void action(() => window.yorw.resources.addRelation({ id: document.id, related_id: relatedId, description }), '已建立双向关联。')}
      onRemoveRelation={relatedId => void action(() => window.yorw.resources.removeRelation({ id: document.id, related_id: relatedId }), '已解除关联；资料保持不变。')}
      onOpenNotes={onOpenNotes} onOpenSearch={onOpenSearch} onOpenChat={onOpenChat} onNavigate={onNavigate}
      onDeleteHistory={historyId => void action(() => window.yorw.resources.deleteSearchHistory({ document_id: document.id, history_id: historyId }), '已删除这条检索历史。')}
      onClearHistory={() => void action(() => window.yorw.resources.clearSearchHistory(document.id), '已清空检索历史；笔记和对话保持不变。')}
      onRunSearch={query => void runSearch(query)}
      onCandidateQuery={setCandidateQuery} onCandidateDescription={setCandidateDescription} />
    <div className="resource-topic-links" aria-label="打开所属专题">{resource.topics.map(item => <button key={item.topic.id} onClick={() => onOpenTopic(item.topic)}>打开专题：{item.topic.title}</button>)}</div>
  </>
}
