import React, { useState } from 'react'
import type { DocumentRecord } from '../shared/status'

const explain = (code: string) => ({
  DOCUMENT_CONFLICT: '文献已更新，请刷新列表后重新编辑；当前草稿保留。',
  INVALID_METADATA: '标签或总结格式无效：标签每行一个，单个最多 40 字，最多 50 个。',
  INVALID_INPUT: '输入无效，请检查后重试。',
  BACKEND_NOT_READY: '本地服务不可用，草稿已保留。'
} as Record<string, string>)[code] ?? '保存失败，草稿已保留。'

const summarySource = (source: string | null) => source === 'manual' ? '人工编辑' : source === 'ai' ? 'AI 生成，已人工确认' : '尚未记录'

/** Manual metadata only; an AI summary entry point is reserved for a later step. */
export function MetadataEditor({ document, onClose, onSaved }: { document: DocumentRecord; onClose(): void; onSaved(): void }) {
  const [title, setTitle] = useState(document.title ?? '')
  const [authors, setAuthors] = useState(document.authors.join('\n'))
  const [year, setYear] = useState(document.year?.toString() ?? '')
  const [tags, setTags] = useState(document.tags.join('\n'))
  const [summary, setSummary] = useState(document.summary_md ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save() {
    if (year && (!/^\d{4}$/.test(year) || +year < 1000)) { setMessage('年份应为四位数字，未知可留空。'); return }
    setBusy(true)
    try {
      const result = await window.yorw.documents.update({
        id: document.id,
        version: document.version,
        title: title.trim() || null,
        authors: authors.split('\n').map(value => value.trim()).filter(Boolean),
        year: year ? +year : null,
        tags: tags.split('\n').map(value => value.trim()).filter(Boolean),
        summary_md: summary.trim()
      })
      if (!result.ok) { setMessage(explain(result.code)); return }
      onSaved()
      onClose()
    } catch { setMessage('保存失败，草稿已保留。') } finally { setBusy(false) }
  }
  return <section className="card" aria-label="编辑文献元数据">
    <h2>编辑元数据</h2>
    <p>未知信息可留空；保存后标记为人工编辑，不补造作者、年份、标签或总结。</p>
    <fieldset disabled={busy}>
      <label>标题<input value={title} maxLength={1000} onChange={event => setTitle(event.target.value)} /></label>
      <label>作者（每行一位）<textarea value={authors} onChange={event => setAuthors(event.target.value)} /></label>
      <label>年份<input value={year} onChange={event => setYear(event.target.value)} inputMode="numeric" /></label>
      <label>关键词 / 标签（每行一个）<textarea aria-label="关键词 / 标签" value={tags} onChange={event => setTags(event.target.value)} placeholder="例如：检索增强生成&#10;因果推断" /></label>
      <label>人工总结<textarea aria-label="人工总结" value={summary} maxLength={20000} onChange={event => setSummary(event.target.value)} placeholder="用自己的话概括这篇文献；不会替代原文证据。" /></label>
      <small>总结来源：{summarySource(document.summary_source)}{document.summary_updated_at ? ` · 更新于 ${document.summary_updated_at}` : ''}</small>
      <div className="actions"><button onClick={() => void save()}>保存</button><button onClick={onClose}>取消编辑</button></div>
    </fieldset>
    <p role="status">{message}</p>
  </section>
}
