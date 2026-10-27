import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSummary, Topic, TopicMaterials } from '../shared/status'
import './resources.css'

const explain = (code: string) => ({
  TOPIC_NOT_FOUND: '专题不存在，请刷新目录后重试。',
  DOCUMENT_NOT_FOUND: '文献不存在或已被移除。',
  INVALID_INPUT: '输入无效，请检查后重试。',
  BACKEND_NOT_READY: '本地服务不可用，请重新打开知栖。'
} as Record<string, string>)[code] ?? `操作失败（${code}），请重试。`

export function TopicMaterialsSections({ materials, query, results, notice, busy, onQuery, onSearch, onAdd, onRemove, onRefresh }: {
  materials: TopicMaterials
  query: string
  results: DocumentSummary[]
  notice: string
  busy: boolean
  onQuery(value: string): void
  onSearch(): void
  onAdd(documentId: string): void
  onRemove(documentId: string): void
  onRefresh(): void
}) {
  const direct = new Set(materials.direct.map(item => item.document.id))
  return <div className="topic-materials-view" aria-label="关联材料">
    <header className="resource-header"><div><h2>{materials.topic.title}</h2><p className="resource-file">专题材料</p></div><button disabled={busy} onClick={onRefresh}>刷新材料</button></header>
    {notice && <p role="status" className="resource-notice">{notice}</p>}
    <section className="resource-section" aria-label="添加文献">
      <h3>添加文献</h3>
      <p className="resource-hint">从已保存文献中手动选择；关联只记录归属，不改变 PDF、笔记或问答内容。</p>
      <div className="resource-inline"><input aria-label="查找可关联文献" placeholder="按标题、作者、年份或标签查找" value={query} disabled={busy}
        onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSearch() } }} />
        <button disabled={busy} onClick={onSearch}>查找文献</button></div>
      {!!results.length && <ul className="resource-list">{results.map(item => <li key={item.id}><div><strong>{item.title || item.original_name}</strong>
        {!!item.tags.length && <small>{item.tags.join('、')}</small>}</div>
        <button disabled={busy || direct.has(item.id)} onClick={() => onAdd(item.id)}>{direct.has(item.id) ? '已直接关联' : '关联到本专题'}</button></li>)}</ul>}
    </section>
    <section className="resource-section" aria-label="直接关联">
      <h3>直接关联 <small>{materials.direct.length} 篇</small></h3>
      {materials.direct.length ? <ul className="resource-list">{materials.direct.map(item => <li key={item.document.id}>
        <div><strong>{item.document.title || item.document.original_name}</strong>{!item.document.document_available && <em>（文献已移除）</em>}
          {!!item.document.tags.length && <small>{item.document.tags.join('、')}</small>}</div>
        <button disabled={busy} onClick={() => onRemove(item.document.id)}>解除关联</button>
      </li>)}</ul> : <p className="resource-empty">尚未直接关联文献。</p>}
    </section>
    <section className="resource-section" aria-label="子专题汇集">
      <h3>子专题汇集 <small>{materials.inherited.length} 篇</small></h3>
      {materials.inherited.length ? <ul className="resource-list">{materials.inherited.map(item => <li key={item.document.id}>
        <div><strong>{item.document.title || item.document.original_name}</strong>{!item.document.document_available && <em>（文献已移除）</em>}
          <small>来自子专题：{(item.topics ?? []).map(topic => topic.title).join('、')}；请在对应专题解除关联</small></div>
      </li>)}</ul> : <p className="resource-empty">没有从子专题汇集的文献。</p>}
    </section>
    <section className="resource-section" aria-label="关联笔记">
      <h3>笔记 <small>{materials.notes.length} 条，按 ID 去重</small></h3>
      {materials.notes.length ? <ul className="resource-list">{materials.notes.map(note => <li key={note.id}>
        <div><strong>{note.document_title}</strong><p>{note.excerpt}</p>
          <small>{note.direct ? '直接关联文献' : `子专题汇集 · ${note.topics.join('、')}`}{!note.document_available ? ' · 文献已移除' : ''} · v{note.version}</small></div>
      </li>)}</ul> : <p className="resource-empty">关联文献还没有笔记。</p>}
      <p className="resource-hint">笔记仍归所属文献所有；同一专题内按 ID 去重，正文只有一份。</p>
    </section>
  </div>
}

export function TopicMaterialsView({ topic, onBack }: { topic: Topic; onBack(): void }) {
  const [materials, setMaterials] = useState<TopicMaterials | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocumentSummary[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const loadSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const result = await window.yorw.resources.topicMaterials(topic.id)
      if (sequence !== loadSequence.current) return
      if (result.ok) setMaterials(result.value)
      else setNotice(explain(result.code))
    } catch {
      if (sequence === loadSequence.current) setNotice('关联材料加载失败，请重试。')
    }
  }, [topic.id])
  useEffect(() => { void load() }, [load])
  async function action(run: () => Promise<{ ok: boolean; code?: string }>, success: string) {
    setBusy(true); setNotice('')
    try {
      const result = await run()
      if (!result.ok) { setNotice(explain(result.code ?? 'OPERATION_FAILED')); return }
      await load(); setNotice(success)
    } catch { setNotice('操作失败，请重试。') } finally { setBusy(false) }
  }
  async function search() {
    setBusy(true); setNotice('')
    try {
      const result = await window.yorw.resources.searchDocuments(query)
      if (result.ok) { setResults(result.value.items); if (!result.value.items.length) setNotice('没有找到可关联的文献。') }
      else setNotice(explain(result.code))
    } catch { setNotice('查找失败，请重试。') } finally { setBusy(false) }
  }
  return <div className="topic-tool-view" aria-label="关联材料"><div className="topic-tool-header"><div className="topic-title-row"><h2>{topic.title}</h2><span className="topic-kind-chip">关联材料</span></div><button onClick={onBack}>返回正文</button></div>
    <div className="topic-tool-body">{materials ? <TopicMaterialsSections materials={materials} query={query} results={results} notice={notice} busy={busy}
      onQuery={setQuery} onSearch={() => void search()}
      onAdd={documentId => void action(() => window.yorw.resources.addTopicDocument({ topic_id: topic.id, document_id: documentId }), '已关联文献。')}
      onRemove={documentId => void action(() => window.yorw.resources.removeTopicDocument({ topic_id: topic.id, document_id: documentId }), '已解除关联；笔记和正文保持不变。')}
      onRefresh={() => void load()} /> : <p role="status">正在加载关联材料…</p>}
      {!materials && notice && <p role="status">{notice}</p>}
    </div>
  </div>
}
