import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Storage, filterDocuments } from '../src/renderer/Storage'
import type { DocumentRecord } from '../src/shared/status'

const document: DocumentRecord = {
  id: '12345678-1234-1234-1234-123456789abc', original_name: 'attention-paper.pdf', title: 'Attention and Memory',
  authors: ['Ada Lovelace'], year: 2025, tags: ['检索增强'], summary_md: '研究视觉证据。', summary_source: 'manual',
  summary_updated_at: '2026-10-27T00:00:00+00:00', version: 1, page_count: 8, last_page: 1, extraction_status: 'ready',
  warning: null, metadata_source: {}
}

test('library search matches filename, title, author, year and tags without a model request', () => {
  expect(filterDocuments([document], 'attention-paper')).toEqual([document])
  expect(filterDocuments([document], 'MEMORY')).toEqual([document])
  expect(filterDocuments([document], 'lovelace')).toEqual([document])
  expect(filterDocuments([document], '2025')).toEqual([document])
  expect(filterDocuments([document], '检索增强')).toEqual([document])
  expect(filterDocuments([document], 'missing')).toEqual([])
  expect(filterDocuments([document], '  ')).toEqual([document])
})

test('Storage home keeps the document directory and search, and can collapse the directory', () => {
  const props = {
    activeDocumentId: null, activeTool: null as null, onToggleStorageDirectory() {}, onOpenDocument() {}, onOpenTool() {},
    onCollapseTool() {}, onCloseMetadata() {}, onNavigate() {}, onShowNotes() {}, onOpenTopic() {},
    pendingJump: null, onJumpApplied() {}, onShowLibrary() {}, onTitles() {}
  }
  const expanded = renderToStaticMarkup(<Storage {...props} storageDirectoryCollapsed={false} />)
  expect(expanded).toContain('文献目录')
  expect(expanded).toContain('搜索文献')
  expect(expanded).toContain('收起目录')
  expect(expanded).toContain('导入 PDF')
  const collapsed = renderToStaticMarkup(<Storage {...props} storageDirectoryCollapsed />)
  expect(collapsed).not.toContain('文献目录')
  expect(collapsed).toContain('展开目录')
})
