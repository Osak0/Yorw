import React from 'react'
import type { ImportItem } from '../shared/status'

const errorText = (code?: string) => ({
  PDF_TOO_LARGE: '超过 50 MiB，未导入。',
  NOT_PDF: '内容不是 PDF，未导入。',
  FILE_CLEANUP_PENDING: '旧副本仍在清理，请重启知栖后重试。',
  IMPORT_FAILED: '导入失败。'
} as Record<string, string>)[code ?? ''] ?? `导入失败（${code ?? 'UNKNOWN'}）。`

const importStatus = (item: ImportItem) => {
  if (!item.document) return '已导入，等待读取文献记录'
  const extraction = item.document.extraction_status === 'ready' ? '文字已就绪'
    : item.document.extraction_status === 'partial' ? '部分文字可用'
    : ['pending', 'running'].includes(item.document.extraction_status) ? '正在后台抽取文字'
    : item.document.extraction_status === 'failed' ? '抽取失败，可打开文献资料重试'
    : item.document.extraction_status === 'unsupported' ? '暂不支持文字抽取'
    : '等待抽取'
  return `${item.deduplicated ? '已存在，复用现有记录' : '已导入'} · ${extraction}`
}

export function ImportResults({ items, onOrganize, onOpen, onDismiss }: {
  items: ImportItem[]
  onOrganize(document: NonNullable<ImportItem['document']>): void
  onOpen(document: NonNullable<ImportItem['document']>): void
  onDismiss(): void
}) {
  if (!items.length) return null
  return <section className="import-results card" aria-label="导入结果">
    <div className="import-results-head"><h2>导入结果</h2><button onClick={onDismiss}>关闭结果</button></div>
    <p className="resource-hint">可跳过整理直接阅读；整理资料只保存你实际修改的标题、作者、年份、标签、总结和可选专题，不发送自动总结请求。</p>
    <ul className="resource-list">{items.map((item, index) => <li key={`${item.name}:${index}`}>
      <div><strong>{item.name}</strong><small>{item.ok ? importStatus(item) : errorText(item.code)}</small></div>
      {item.ok && item.document && <div className="actions"><button onClick={() => item.document && onOrganize(item.document)}>整理资料</button><button onClick={() => item.document && onOpen(item.document)}>打开阅读</button></div>}
    </li>)}</ul>
  </section>
}
