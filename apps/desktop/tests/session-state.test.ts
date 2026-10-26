import { expect, test } from 'vitest'
import { sessionStore } from '../src/renderer/session-state'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'

test('document inputs, position and zoom stay isolated per document', () => {
  const store = sessionStore()
  store.updateDocument(a, { page: 3, zoom: 1.5, searchQuery: 'alpha', chatQuestion: 'question A' })
  store.updateDocument(b, { page: 7, searchQuery: 'beta' })
  expect(store.document(a)).toMatchObject({ page: 3, zoom: 1.5, searchQuery: 'alpha', chatQuestion: 'question A' })
  expect(store.document(b)).toMatchObject({ page: 7, zoom: 'fit', searchQuery: 'beta', chatQuestion: '' })
})

test('topic AI instructions stay isolated per topic', () => {
  const store = sessionStore()
  store.updateTopic(a, { aiInstruction: 'summarize evidence' })
  store.updateTopic(b, { aiInstruction: 'compare limitations' })
  expect(store.topic(a).aiInstruction).toBe('summarize evidence')
  expect(store.topic(b).aiInstruction).toBe('compare limitations')
})

test('sidebar preference applies to new sessions without changing existing ones', () => {
  const store = sessionStore()
  const existing = '33333333-3333-4333-8333-333333333333'
  const fresh = '44444444-4444-4444-8444-444444444444'
  store.updateDocument(existing, { sidebarMode: 'notes', sidebarWidth: 380 })
  store.applySidebarPreference({ mode: 'chat', width: 420 })
  expect(store.document(fresh).sidebarMode).toBe('chat')
  expect(store.document(fresh).sidebarWidth).toBe(420)
  expect(store.document(existing).sidebarMode).toBe('notes')
  expect(store.sidebarPreferenceFor(existing)).toEqual({ mode: 'notes', width: 380 })
})
