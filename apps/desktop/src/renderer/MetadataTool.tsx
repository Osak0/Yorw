import React, { useEffect, useState } from 'react'
import type { DocumentRecord, Topic } from '../shared/status'
import { MetadataEditor } from './MetadataEditor'

const errorText = (code: string) => ({
  DOCUMENT_CONFLICT: '文献已更新，请刷新列表后重新编辑；当前草稿保留。',
  INVALID_METADATA: '标签或总结格式无效，请检查后重试。',
  INVALID_INPUT: '输入无效，请检查后重试。',
  BACKEND_NOT_READY: '本地服务不可用，草稿已保留。'
} as Record<string, string>)[code] ?? '文献加载失败，请重试。'

/** Dedicated workspace tab for organizing one document without covering the library. */
export function MetadataTool({ document, onOpenDocument, onClose, onSaved }: {
  document: DocumentRecord
  onOpenDocument(): void
  onClose(): void
  onSaved(warning?: string, saved?: DocumentRecord): void
}) {
  const [current, setCurrent] = useState<DocumentRecord | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setNotice('')
    void Promise.all([window.yorw.documents.list(), window.yorw.garden.list()]).then(([documents, garden]) => {
      if (!active) return
      if (!documents.ok) { setNotice(errorText(documents.code)); return }
      const found = documents.value.items.find(item => item.id === document.id)
      if (!found) { setNotice('这篇文献可能已被移除，请返回文献库刷新。'); return }
      setCurrent(found)
      setTopics(garden.ok ? garden.value.items : [])
      if (!garden.ok) setNotice('专题列表加载失败；仍可整理标题、作者、标签和总结。')
    }).catch(() => { if (active) setNotice('文献加载失败，请重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [document.id, attempt])

  const title = current?.title || current?.original_name || document.title || document.original_name
  return <div className="document-tool-view metadata-tool-view" aria-label={`整理文献 · ${title}`}>
    <div className="document-tool-header">
      <div className="document-tool-identity"><strong>{title}</strong><span>整理文献</span></div>
      <div className="document-tool-actions"><button onClick={onOpenDocument}>打开阅读</button><button onClick={onClose}>关闭整理</button></div>
    </div>
    <div className="document-tool-body metadata-tool">
      {notice && <p role="status">{notice}{!current && !loading && <button onClick={() => setAttempt(value => value + 1)}>重试加载</button>}</p>}
      {loading ? <p className="metadata-tool-loading">正在读取文献与专题…</p> : current
        ? <MetadataEditor document={current} topicOptions={topics.length ? topics : undefined} onClose={onClose} onSaved={onSaved} />
        : <p className="metadata-tool-loading">文献暂不可用，请返回文献库。</p>}
    </div>
  </div>
}
