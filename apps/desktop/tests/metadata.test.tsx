import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { MetadataEditor } from '../src/renderer/MetadataEditor'
import type { DocumentRecord } from '../src/shared/status'

const document: DocumentRecord = {
  id: '12345678-1234-1234-1234-123456789abc',
  original_name: 'paper.pdf',
  title: 'Paper',
  authors: ['Author'],
  year: 2026,
  tags: ['检索增强', 'RAG'],
  summary_md: '这篇论文讨论检索增强生成。',
  summary_source: 'manual',
  summary_updated_at: '2026-10-27T00:00:00+00:00',
  version: 2,
  page_count: 10,
  last_page: 1,
  extraction_status: 'ready',
  warning: null,
  metadata_source: { title: 'user', authors: 'user', year: 'user', tags: 'user', summary: 'user' }
}

test('metadata editor exposes tags and manual summary without an AI generate button', () => {
  const html = renderToStaticMarkup(<MetadataEditor document={document} onClose={() => {}} onSaved={() => {}} />)
  expect(html).toContain('关键词 / 标签')
  expect(html).toContain('人工总结')
  expect(html).toContain('检索增强')
  expect(html).toContain('这篇论文讨论检索增强生成。')
  expect(html).toContain('人工编辑')
  expect(html).not.toContain('AI 总结')
  expect(html).not.toContain('生成总结')
})
