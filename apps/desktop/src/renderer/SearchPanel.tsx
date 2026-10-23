import React, { useEffect, useRef, useState } from 'react'
import type { IndexStatus, SearchResult } from '../shared/status'
import './search.css'

const explanations: Record<string,string> = {
  CONFIG_MISSING:'尚未配置 embedding，当前仅使用本地关键词。', CONFIG_CHANGED:'embedding 配置已变化，请重新构建语义索引。', KEY_MISSING:'embedding 密钥未就绪，请在 House 保存并测试。', INDEX_NOT_READY:'当前配置尚无可用语义索引，请先构建。', DIMENSION_CHANGED:'服务向量维度发生变化，未混用旧向量；请检查模型并重建。',
  TEXT_NOT_READY:'尚无可检索文字，请等待抽取或检查文献状态。', INDEX_SOURCE_CHANGED:'文献抽取或索引已变化，请重新检索。', INDEX_TOO_LARGE:'超过本步单篇 5000 个语义分块的上限；关键词检索仍可用。', AUTH_FAILED:'embedding 鉴权失败，请检查 House 中的密钥。', RATE_LIMITED:'embedding 服务限流，请稍后重试。', TIMEOUT:'embedding 请求超时，已保留关键词检索。', NETWORK_ERROR:'embedding 服务连接失败，已保留关键词检索。', INVALID_RESPONSE:'embedding 响应无效，未使用该向量。', INDEX_FAILED:'语义索引构建失败；旧有效索引不会被半成品替换。', CANCELLED:'已停止索引任务，已发出的请求可能仍会计费。', INTERRUPTED:'上次索引被中断，请手动重新构建。', CONFIG_CONFLICT:'配置已变化，请刷新状态。', BACKEND_NOT_READY:'本地服务不可用，请检查应用状态。', TASK_RUNNING:'该文献已有索引任务，请等待或取消。'
}
const explain = (code: string) => explanations[code] ?? `操作未完成（${code}），请重试。`

export function SearchPanel({ documentId }: {documentId: string}) {
  const [query, setQuery] = useState('')
  const [semantic, setSemantic] = useState(false)
  const [minimum, setMinimum] = useState('0.5')
  const minimumValue = Number(minimum)
  const validMinimum = minimum.trim() !== '' && Number.isFinite(minimumValue) && minimumValue >= 0 && minimumValue <= 1
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    async function load() {
      try { const response = await window.yorw.search.status(documentId); if (active.current && response.ok) setStatus(response.value); else if (active.current && !response.ok) { setNotice(explain(response.code)); setResult(null) } }
      catch { if (active.current) setNotice('检索状态加载失败，请重试。') }
    }
    void load(); const timer = setInterval(load,1500)
    return () => { active.current = false; clearInterval(timer) }
  }, [documentId])
  useEffect(() => { setConsent(false); setSemantic(false) }, [status?.config?.version])
  useEffect(() => {
    if (result && status && (result.items.some(item => item.extraction_version !== status.extraction_version || item.chunk_version !== status.chunk_version) || (result.mode === 'hybrid' && !status.semantic_ready))) {
      setResult(null); setNotice('原文或语义索引已变化，请重新检索。')
    }
  }, [status, result])
  async function runSearch() {
    if (!query.trim() || (semantic && !validMinimum)) return
    setBusy(true); setNotice('正在检索…'); setResult(null)
    try {
      const response = await window.yorw.search.query({ id: documentId, query, semantic, min_similarity: semantic ? minimumValue : 0.5, config_version: status?.config?.version ?? 0 })
      if (!active.current) return
      if (response.ok) {
        const fresh = await window.yorw.search.status(documentId)
        if (!active.current) return
        if (fresh.ok) setStatus(fresh.value)
        setResult(response.value); setNotice(response.value.reason ? explain(response.value.reason) : '')
      } else setNotice(explain(response.code))
    } catch { if (active.current) setNotice('检索失败，请重试。') } finally { if (active.current) setBusy(false) }
  }
  async function build(useSemantic: boolean) {
    setBusy(true); setResult(null); setNotice('正在提交索引任务…')
    try {
      const response = await window.yorw.search.index({id: documentId,semantic:useSemantic,config_version:status?.config?.version ?? 0})
      if (!active.current) return
      setNotice(response.ok ? useSemantic ? '语义索引任务已提交；完成前不会使用半成品。' : '本地关键词索引已重建。' : explain(response.code))
      if (response.ok) { const fresh = await window.yorw.search.status(documentId); if (active.current && fresh.ok) setStatus(fresh.value) }
    } catch { if (active.current) setNotice('提交失败，请重试；未显示构建成功。') } finally { if (active.current) setBusy(false) }
  }
  const running = !!status?.task && ['queued','running'].includes(status.task.status)
  return <div className="search-panel"><p className="search-intro">仅检索当前文献的已抽取文字，结果是待核查原文片段，不是 AI 回答。</p>
    <form onSubmit={event => { event.preventDefault(); void runSearch() }}><label>查找原文<input aria-label="文献内检索" value={query} maxLength={1000} onChange={event => setQuery(event.target.value)} placeholder="输入关键词或研究问题" /></label>
      <label className="check"><input type="checkbox" checked={semantic} onChange={event => setSemantic(event.target.checked)} />启用语义检索（向所配置服务发送本次查询）</label><p className="search-intro">{semantic && (status?.config ? `语义服务：${status.config.model} · ${status.config.base_url}` : '尚无 embedding 配置，将明确降级为关键词。')}</p>{semantic && <label>最低语义相似度<input aria-label="最低语义相似度" type="number" min="0" max="1" step="any" inputMode="decimal" required value={minimum} aria-invalid={!validMinimum} aria-describedby="similarity-help similarity-error" onChange={event => setMinimum(event.target.value)} /><small id="similarity-help">可自定义 0–1 之间的任意小数，例如 0.20、0.255；0 查看全部正相似度候选。修改后点击“检索原文”生效。关键词命中直接保留；阈值只筛选语义候选。关键词命中或语义达到阈值，满足任一条件即展示。初始值未经当前模型校准；提高可减少弱候选，降低可能增加召回。相似度不是相关概率或事实可信度。</small>{!validMinimum && <small id="similarity-error" role="alert">请输入 0–1 之间的有效数字，不能为空。</small>}</label>}<button className="search-submit" disabled={busy || !query.trim() || (semantic && !validMinimum)}>检索原文</button></form>
    <p className="search-feedback" role="status">{notice}</p>
    {result && <div className="search-results"><p>查询：{result.query}</p><p className="search-mode">{result.mode === 'hybrid' ? '关键词 + 语义候选' : '仅关键词检索'} · {result.items.length} 条片段{result.extraction_status === 'partial' && ' · 原文仅部分抽取'}。排序分数不代表事实可信度。</p>{result.mode === 'hybrid' && <p className="search-mode">本次最低余弦值 {String(result.min_similarity)} · 文献最高余弦值 {result.best_similarity?.toFixed(3) ?? '无'}。语义候选按阈值过滤，关键词命中独立保留。</p>}{!result.items.length && <p>{result.mode === 'hybrid' ? '关键词无命中，且没有达到阈值的语义片段。可调整阈值再查；空结果不能证明原文没有相关内容。' : '未找到匹配片段；关键词检索不能可靠地用中文召回英文原文。'}</p>}{result.items.map(item => <article key={item.segment_id}><h3>物理页 {item.physical_page} · {item.methods.map(method => method === 'keyword' ? '关键词' : '语义').join(' + ')}</h3><p className="evidence-text">{item.text}</p>{item.similarity != null && <p className="search-mode">余弦相似度 {item.similarity.toFixed(3)}</p>}{result.mode === 'hybrid' && item.methods.includes('keyword') && item.similarity != null && item.similarity < result.min_similarity && <p className="search-mode">关键词命中，已保留；语义相似度低于阈值。</p>}<details><summary>来源标识</summary><p>文献 {item.document_id}<br />片段 {item.chunk_id}<br />分块 {item.segment_id}<br />抽取 v{item.extraction_version} · {item.chunk_version}</p></details></article>)}</div>}
    <details className="search-index"><summary>索引状态与重建</summary><p>{status?.keyword_ready ? `关键词就绪 · ${status.segments} 个分块` : '关键词索引将在首次检索时在本地准备。'}<br />{status?.semantic_ready ? `语义就绪 · ${status.dimension} 维` : '当前配置无有效语义索引'}</p><p>{status?.config ? `${status.config.model} · ${status.config.base_url}` : '请先在 House 配置独立 embedding 服务。'}</p>
      {status?.task && <p role="status">最近索引任务：{running ? `进行中 ${Math.round((status.task.progress ?? 0)*100)}%` : status.task.status === 'succeeded' ? '已完成' : explain(status.task.stage)}</p>}
      <button disabled={busy || running} onClick={() => void build(false)}>重建本地关键词索引</button><p>重建本地索引会清除当前文献的派生向量索引，不修改 PDF 或笔记。</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />我确认：语义建索引将发送当前文献全部已抽取文字分块到上述服务，可能产生费用。</label>
      <button disabled={busy || running || !consent} onClick={() => void build(true)}>构建 / 重建语义索引</button>{running && <button onClick={() => { void window.yorw.search.cancel(status!.task!.id).then(response => { if (active.current) setNotice(response.ok ? '已停止接收索引结果；在途请求可能仍会计费。' : explain(response.code)) }).catch(() => { if (active.current) setNotice('取消失败，请重试。') }) }}>停止索引</button>}
    </details>
  </div>
}
