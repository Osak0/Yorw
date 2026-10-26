import { expect, test } from 'vitest'
import { addWorkspaceTab, documentTab, moduleForTab, tabKindLabel, topicTab } from '../src/renderer/workspace-tabs'

const id = '12345678-1234-1234-1234-123456789abc'

test('document and topic tabs are keyed by page type and entity', () => {
  const document = documentTab(id, 'Paper')
  const topic = topicTab(id, 'Topic')
  expect(document.key).not.toBe(topic.key)
  expect(moduleForTab(document)).toBe('Storage')
  expect(moduleForTab(topic)).toBe('Garden')
  expect(tabKindLabel(document)).toBe('文献')
  expect(tabKindLabel(topic)).toBe('专题')
})

test('opening the same page again keeps one tab and preserves the existing position', () => {
  const first = documentTab(id, 'Paper')
  const second = documentTab(id, 'Renamed paper')
  const tabs = addWorkspaceTab(addWorkspaceTab([], first), second)
  expect(tabs).toEqual([first])
})
