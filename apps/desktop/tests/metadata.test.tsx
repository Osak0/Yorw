import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { MetadataEditor, metadataUpdatePayload } from '../src/renderer/MetadataEditor'
import type { DocumentRecord } from '../src/shared/status'

const other = '87654321-4321-4321-4321-cba987654321'
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

test('metadata editor exposes tags and canonical summary without an AI generate button', () => {
  const html = renderToStaticMarkup(<MetadataEditor document={document} onClose={() => {}} onSaved={() => {}} />)
  expect(html).toContain('关键词 / 标签')
  expect(html).toContain('总结')
  expect(html).toContain('检索增强')
  expect(html).toContain('这篇论文讨论检索增强生成。')
  expect(html).toContain('人工编辑')
  expect(html).not.toContain('AI 总结')
  expect(html).not.toContain('生成总结')
})

test('import organizer can attach an optional topic and never exposes an AI summary action', () => {
  const topic = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', parent_id: null, title: 'Import topic', current_revision_id: other, version: 1, created_at: 'time', updated_at: 'time' }
  const html = renderToStaticMarkup(<MetadataEditor document={document} topicOptions={[topic]} onClose={() => {}} onSaved={() => {}} />)
  expect(html).toContain('关联专题（可选）')
  expect(html).toContain('Import topic')
  expect(html).not.toContain('AI 总结')
})

test('metadata payload writes only fields the user changed', () => {
  const tagged = metadataUpdatePayload(document, {
    title: 'Paper', authors: 'Author', year: '2026', tags: '检索增强\nRAG\n导入整理', summary: '这篇论文讨论检索增强生成。'
  })
  expect(tagged).toEqual({ id: document.id, version: 2, tags: ['检索增强', 'RAG', '导入整理'] })

  const untouched = metadataUpdatePayload(document, {
    title: 'Paper', authors: 'Author', year: '2026', tags: '检索增强\nRAG', summary: '这篇论文讨论检索增强生成。'
  })
  expect(untouched).toEqual({ id: document.id, version: 2 })

  const cleared = metadataUpdatePayload(document, {
    title: '', authors: '', year: '', tags: '', summary: ''
  })
  expect(cleared).toEqual({
    id: document.id, version: 2, title: null, authors: [], year: null, tags: [], summary_md: ''
  })
})
