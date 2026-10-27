import React, { useEffect, useState } from 'react'
import type { DocumentInput, DocumentRecord, Topic } from '../shared/status'

const explain = (code: string) => ({
  DOCUMENT_CONFLICT: '文献已更新，请刷新列表后重新编辑；当前草稿保留。',
  INVALID_METADATA: '标签或总结格式无效：标签每行一个，单个最多 40 字，最多 50 个。',
  INVALID_INPUT: '输入无效，请检查后重试。',
  BACKEND_NOT_READY: '本地服务不可用，草稿已保留。'
} as Record<string, string>)[code] ?? '保存失败，草稿已保留。'

const summarySource = (source: string | null) => source === 'manual' ? '人工编辑' : source === 'ai' ? 'AI 生成，已人工确认' : '尚未记录'

type MetadataValues = { title: string; authors: string; year: string; tags: string; summary: string }
const metadataDrafts = new Map<string, MetadataValues>()
export function clearMetadataDraft(documentId: string) { metadataDrafts.delete(documentId) }

/** Build a partial update so untouched PDF-extracted fields keep their value and provenance. */
export function metadataUpdatePayload(document: DocumentRecord, values: MetadataValues): DocumentInput {
  const payload: DocumentInput = { id: document.id, version: document.version }
  const title = values.title.trim()
  if (title !== (document.title ?? '')) payload.title = title || null
  const authors = values.authors.split('\n').map(value => value.trim()).filter(Boolean)
  if (JSON.stringify(authors) !== JSON.stringify(document.authors)) payload.authors = authors
  const year = values.year ? +values.year : null
  if (year !== (document.year ?? null)) payload.year = year
  const tags = values.tags.split('\n').map(value => value.trim()).filter(Boolean)
  if (JSON.stringify(tags) !== JSON.stringify(document.tags)) payload.tags = tags
  const summary = values.summary.trim()
  if (summary !== (document.summary_md ?? '')) payload.summary_md = summary || null
  return payload
}

/** Manual metadata only; an AI summary entry point is reserved for a later step. */
export function MetadataEditor({ document, topicOptions, onClose, onSaved }: { document: DocumentRecord; topicOptions?: Topic[]; onClose(): void; onSaved(warning?: string, saved?: DocumentRecord): void }) {
  const initial = metadataDrafts.get(document.id) ?? {
    title: document.title ?? '', authors: document.authors.join('\n'), year: document.year?.toString() ?? '',
    tags: document.tags.join('\n'), summary: document.summary_md ?? ''
  }
  const [title, setTitle] = useState(initial.title)
  const [authors, setAuthors] = useState(initial.authors)
  const [year, setYear] = useState(initial.year)
  const [tags, setTags] = useState(initial.tags)
  const [summary, setSummary] = useState(initial.summary)
  const [topicId, setTopicId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const values = { title, authors, year, tags, summary }
    if (Object.keys(metadataUpdatePayload(document, values)).length > 2) metadataDrafts.set(document.id, values)
    else metadataDrafts.delete(document.id)
  }, [document, title, authors, year, tags, summary])
  function cancel() {
    clearMetadataDraft(document.id)
    onClose()
  }
  async function save() {
    if (year && (!/^\d{4}$/.test(year) || +year < 1000)) { setMessage('年份应为四位数字，未知可留空。'); return }
    setBusy(true)
    try {
      const result = await window.yorw.documents.update(metadataUpdatePayload(document, { title, authors, year, tags, summary }))
      if (!result.ok) { setMessage(explain(result.code)); return }
      clearMetadataDraft(document.id)
      let warning = ''
      if (topicOptions && topicId) {
        try {
          const linked = await window.yorw.resources.addDocumentTopic({ document_id: document.id, topic_id: topicId })
          if (!linked.ok) warning = `元数据已保存；专题关联失败（${linked.code}），可在文献资料中重试。`
        } catch {
          warning = '元数据已保存；专题关联请求失败，可在文献资料中重试。'
        }
      }
      onSaved(warning, result.value)
      onClose()
    } catch { setMessage('保存失败，草稿已保留。') } finally { setBusy(false) }
  }
  return <section className="card" aria-label="编辑文献元数据">
    <h2>编辑元数据</h2>
    <p>未知信息可留空；只有实际修改的字段标记为人工编辑，未修改的抽取信息保留原来源。</p>
    <fieldset disabled={busy}>
      <label>标题<input aria-label="文献标题" value={title} maxLength={1000} onChange={event => setTitle(event.target.value)} /></label>
      <label>作者（每行一位）<textarea aria-label="文献作者" value={authors} onChange={event => setAuthors(event.target.value)} /></label>
      <label>年份<input aria-label="文献年份" value={year} onChange={event => setYear(event.target.value)} inputMode="numeric" /></label>
      <label>关键词 / 标签（每行一个）<textarea aria-label="关键词 / 标签" value={tags} onChange={event => setTags(event.target.value)} placeholder="例如：检索增强生成&#10;因果推断" /></label>
      <label>人工总结<textarea aria-label="人工总结" value={summary} maxLength={20000} onChange={event => setSummary(event.target.value)} placeholder="用自己的话概括这篇文献；不会替代原文证据。" /></label>
      {topicOptions && <label>关联专题（可选）<select aria-label="导入关联专题" value={topicId} onChange={event => setTopicId(event.target.value)}><option value="">暂不关联</option>{topicOptions.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
      <small>总结来源：{summarySource(document.summary_source)}{document.summary_updated_at ? ` · 更新于 ${document.summary_updated_at}` : ''}</small>
      <div className="actions"><button onClick={() => void save()}>保存</button><button onClick={cancel}>取消编辑</button></div>
    </fieldset>
    <p role="status">{message}</p>
  </section>
}
