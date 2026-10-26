import { expect, test } from 'vitest'
import { addWorkspaceTab, documentTab, gardenToolTab, moduleForTab, nextActiveKeyAfterClose, restoreTabs, tabKindLabel, toolTab, topicTab } from '../src/renderer/workspace-tabs'

const id = '12345678-1234-1234-1234-123456789abc'

test('document and topic tabs are keyed by page type and entity', () => {
  const document = documentTab(id, 'Paper')
  const topic = topicTab(id, 'Topic')
  expect(document.key).not.toBe(topic.key)
  expect(moduleForTab(document)).toBe('Storage')
  expect(moduleForTab(topic)).toBe('Garden')
  expect(tabKindLabel(document)).toBe('文献')
  expect(tabKindLabel(topic)).toBe('专题')
  for (const tool of ['notes', 'search', 'chat'] as const) {
    const tab = toolTab(tool, id, 'Paper')
    expect(tab.key).toBe(`${tool}:${id}`)
    expect(moduleForTab(tab)).toBe('Storage')
    expect(tabKindLabel(tab)).toBe({ notes: '笔记', search: '检索', chat: '问答' }[tool])
  }
  for (const tool of ['ai', 'history'] as const) {
    const tab = gardenToolTab(tool, id, 'Topic')
    expect(tab.key).toBe(`${tool}:${id}`)
    expect(moduleForTab(tab)).toBe('Garden')
    expect(tabKindLabel(tab)).toBe({ ai: 'AI 优化', history: '修订历史' }[tool])
  }
})

test('opening the same page again keeps one tab and preserves the existing position', () => {
  const first = documentTab(id, 'Paper')
  const second = documentTab(id, 'Renamed paper')
  const tabs = addWorkspaceTab(addWorkspaceTab([], first), second)
  expect(tabs).toEqual([first])
})

test('restoring skips pages that no longer exist and reports the count', () => {
  const missing = '99999999-9999-4999-8999-999999999999'
  const documents = new Map([[id, 'Paper']])
  const topics = new Map([[id, 'Topic']])
  const restored = restoreTabs([
    { kind: 'document', id },
    { kind: 'notes', id },
    { kind: 'search', id },
    { kind: 'topic', id },
    { kind: 'ai', id },
    { kind: 'history', id },
    { kind: 'document', id: missing },
    { kind: 'topic', id: missing }
  ], documents, topics)
  expect(restored.tabs.map(tab => `${tab.kind}:${tab.title}`)).toEqual(['document:Paper', 'notes:Paper', 'search:Paper', 'topic:Topic', 'ai:Topic', 'history:Topic'])
  expect(restored.skipped).toBe(2)
})

test('closing the active tab selects the next tab, then the previous, then home', () => {
  const first = documentTab(id, 'First')
  const second = topicTab(id, 'Second')
  const third = documentTab('33333333-3333-4333-8333-333333333333', 'Third')
  const tabs = [first, second, third]
  expect(nextActiveKeyAfterClose(tabs, second.key, second.key)).toBe(third.key)
  expect(nextActiveKeyAfterClose(tabs, third.key, third.key)).toBe(second.key)
  expect(nextActiveKeyAfterClose(tabs, first.key, second.key)).toBe(second.key)
  expect(nextActiveKeyAfterClose([first], first.key, first.key)).toBeNull()
  expect(nextActiveKeyAfterClose(tabs, 'missing', 'missing')).toBe('missing')
})
