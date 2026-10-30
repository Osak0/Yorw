import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { DocumentResourceSections } from '../src/renderer/DocumentResource'
import { TopicMaterialsSections } from '../src/renderer/TopicMaterials'
import type { DocumentResource, TopicMaterials } from '../src/shared/status'

const id = '12345678-1234-1234-1234-123456789abc'
const other = '87654321-4321-4321-4321-cba987654321'
const topic = { id, parent_id: null, title: '检索增强', current_revision_id: other, version: 1, created_at: 'time', updated_at: 'time' }
const summary = { id: other, original_name: 'other.pdf', title: 'Other paper', authors: ['Author'], year: 2025, tags: ['RAG'], document_available: true }
const resource: DocumentResource = {
  document: { id, original_name: 'paper.pdf', title: 'Paper', authors: ['Author'], year: 2026, tags: ['RAG', '检索增强'],
    summary_md: '人工总结内容。', summary_source: 'manual', summary_updated_at: '2026-10-27T00:00:00+00:00', version: 2,
    page_count: 10, last_page: 1, extraction_status: 'ready', warning: null, metadata_source: {} },
  topics: [{ topic, path: ['Parent', '检索增强'] }],
  related: [{ document: summary, document_available: true, description: '共同主题', created_at: 'time', updated_at: 'time' }],
  tag_matches: [{ document: { ...summary, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, shared_tags: ['RAG'] }],
  notes: [{ id: other, document_id: id, excerpt: '我的笔记摘要', version: 1, created_at: 'time', updated_at: 'time', sources_count: 0 }],
  chat: [{ id: other, question: '研究问题', body_excerpt: '回答摘要', status: 'completed', error_code: null, created_at: 'time', sources_count: 1, citations: 1 }],
  search_history: [{ id: other, document_id: id, request_id: other, task_id: other, query: '检索增强', status: 'succeeded', error_code: null,
    reason: null, created_at: 'time', updated_at: 'time', result_count: 1,
    items: [{ id: 'segment', kind: 'document', object_id: id, title: 'Paper', snippet: '历史摘录', snippet_start: 0, snippet_end: 4,
      document_id: id, physical_page: 3, available: false, evidence: [{ document_id: id, chunk_id: other, physical_page: 3, extraction_version: 1, quote: '历史摘录', available: false }] }] }]
}

const materials: TopicMaterials = {
  topic,
  direct: [{ document: summary, linked_at: 'time' }],
  inherited: [{ document: { ...summary, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Child paper' }, topics: [{ id: other, title: 'Child topic' }] }],
  notes: [{ id: other, document_id: other, document_title: 'Other paper', document_available: true, direct: true, topics: ['检索增强'],
    excerpt: '关联笔记正文', version: 1, sources_count: 0, created_at: 'time', updated_at: 'time' }]
}

test('resource activity and editable metadata relations have independent responsibilities', () => {
  const render = (mode:'activity'|'metadata')=>renderToStaticMarkup(<DocumentResourceSections mode={mode} resource={resource} topics={[topic]} notice="" busy={false}
    onEditMetadata={() => {}} onAddTopic={() => {}} onRemoveTopic={() => {}} onSearchCandidates={() => {}} onAddRelation={() => {}}
    onRemoveRelation={() => {}} onOpenNotes={() => {}} onOpenSearch={() => {}} onOpenChat={() => {}} onNavigate={() => {}}
    onDeleteHistory={() => {}} onClearHistory={() => {}} onRunSearch={() => {}} candidates={[]} candidateQuery="" candidateDescription=""
    onCandidateQuery={() => {}} onCandidateDescription={() => {}} />)
  const html=render('activity'), relations=render('metadata')
  for (const text of ['我的笔记摘要','研究问题','历史摘录','第 3 页','来源已失效','打开笔记','打开问答','检索历史']) expect(html).toContain(text)
  for (const text of ['人工总结内容。','Parent / 检索增强','共同主题','相同标签']) expect(html).not.toContain(text)
  for (const text of ['Parent / 检索增强','共同主题','相关文献','相同标签']) expect(relations).toContain(text)
  for (const text of ['我的笔记摘要','问答历史','检索历史','人工总结内容。']) expect(relations).not.toContain(text)
  expect(html).not.toContain('自动建立关联')
})

test('topic materials separate direct links from descendant aggregation and show notes once', () => {
  const html = renderToStaticMarkup(<TopicMaterialsSections materials={materials} query="" onQuery={() => {}} onAdd={() => {}}
    onRemove={() => {}} onRefresh={() => {}} onSearch={() => {}} results={[]} notice="" busy={false} />)
  for (const text of ['直接关联', '子专题汇集', 'Child topic', '关联笔记正文', 'Other paper', '解除关联']) expect(html).toContain(text)
  expect(html).not.toContain('复制')
})
