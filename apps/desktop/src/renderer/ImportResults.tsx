import React from 'react'
import type { ImportItem } from '../shared/status'

const errorText = (code?: string) => ({
  PDF_TOO_LARGE: '超过 50 MiB，未导入。',
  FILE_TOO_LARGE: '超过 50 MiB，未导入。',
  NOT_PDF: '内容不是 PDF，未导入。',
  UNSUPPORTED_FORMAT: '不支持的文件格式；请使用 PDF、DOCX、DOC、MD 或 TXT。',
  FILE_CLEANUP_PENDING: '旧副本仍在清理，请重启知栖后重试。',
  COMPONENT_MISSING: '缺少解析组件；文件已保存，可在 House 配置后重新解析。',
  INVALID_FILE: '文件损坏或格式无效。',
  DECODE_FAILED: '文本编码无法可靠识别。',
  IMPORT_FAILED: '导入失败。'
} as Record<string, string>)[code ?? ''] ?? `导入失败（${code ?? 'UNKNOWN'}）。`

const parseStatus = (document: NonNullable<ImportItem['document']>) => {
  const status = document.parse_status ?? document.extraction_status
  return status === 'ready' ? '解析成功'
    : status === 'partial' ? '部分解析，仅使用已提取内容'
    : ['pending', 'running'].includes(status) ? '正在后台解析'
    : status === 'failed' ? '解析失败，可重新解析'
    : status === 'unsupported' ? '暂不支持解析该内容'
    : status === 'cancelled' ? '解析已取消'
    : '等待解析'
}

const importStatus = (item: ImportItem) => {
  if (!item.document) return '已导入，等待读取文献记录'
  const extension = (item.document.format ?? item.name.split('.').pop() ?? '').toUpperCase()
  return `${item.deduplicated ? '已存在，复用现有记录' : '已导入'} · ${extension} · ${parseStatus(item.document)}`
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
