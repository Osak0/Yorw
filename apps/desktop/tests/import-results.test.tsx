import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ImportResults } from '../src/renderer/ImportResults'
import type { DocumentRecord, ImportItem } from '../src/shared/status'

const document: DocumentRecord = {
  id: '12345678-1234-1234-1234-123456789abc', original_name: 'paper.pdf', title: 'Paper', authors: [], year: null,
  tags: [], summary_md: null, summary_source: null, summary_updated_at: null, version: 1, page_count: 1,
  last_page: 1, extraction_status: 'pending', warning: null, metadata_source: {}
}
const ready = { ...document, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', original_name: 'ready.pdf', extraction_status: 'ready' as const }
const failed = { ...document, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', original_name: 'failed.pdf', extraction_status: 'failed' as const }
const items: ImportItem[] = [
  { name: 'new.pdf', ok: true, document, deduplicated: false },
  { name: 'duplicate.pdf', ok: true, document, deduplicated: true },
  { name: 'ready.pdf', ok: true, document: ready, deduplicated: false },
  { name: 'failed.pdf', ok: true, document: failed, deduplicated: false },
  { name: 'bad.pdf', ok: false, code: 'NOT_PDF' }
]

test('batch import results report every file and keep organization optional', () => {
  const html = renderToStaticMarkup(<ImportResults items={items} onOrganize={() => {}} onOpen={() => {}} onDismiss={() => {}} />)
  expect(html).toContain('new.pdf')
  expect(html).toContain('duplicate.pdf')
  expect(html).toContain('bad.pdf')
  expect(html).toContain('已存在')
  expect(html).toContain('不是 PDF')
  expect(html).toContain('正在后台抽取文字')
  expect(html).toContain('文字已就绪')
  expect(html).toContain('抽取失败，可打开文献资料重试')
  expect(html).toContain('整理资料')
  expect(html).toContain('打开阅读')
  expect(html).not.toContain('AI 总结')
})
