import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { Layout } from '../src/main/layout'
import type { WorkspaceLayout } from '../src/shared/status'

const documentId = '11111111-1111-4111-8111-111111111111'
const topicId = '22222222-2222-4222-8222-222222222222'
const layout: WorkspaceLayout = {
  version: 1,
  module: 'Storage',
  tabs: [
    { kind: 'document', id: documentId, title: 'Paper' },
    { kind: 'topic', id: topicId, title: 'Topic' }
  ],
  activeKey: `document:${documentId}`,
  storageKey: `document:${documentId}`,
  gardenKey: `topic:${topicId}`,
  sidebar: { mode: 'search', width: 400 },
  directoryCollapsed: false
}

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'yorw-layout-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('layout round-trips through an atomic file and drops unknown fields', async () => {
  await withDirectory(async directory => {
    const store = new Layout(directory)
    await expect(store.load()).resolves.toEqual({ layout: null })
    await store.save({ ...layout, body_md: 'private body', secret: 'key' })
    await expect(store.load()).resolves.toEqual({ layout })
    const raw = await readFile(join(directory, 'workspace-layout.json'), 'utf8')
    expect(raw).not.toContain('private body')
    expect(raw).not.toContain('secret')
  })
})

test('tool tabs are valid Storage pages and persist as the active page', async () => {
  await withDirectory(async directory => {
    const store = new Layout(directory)
    const toolLayout: WorkspaceLayout = {
      version: 1,
      module: 'Storage',
      tabs: [
        { kind: 'document', id: documentId, title: 'Paper' },
        { kind: 'notes', id: documentId, title: 'Paper' },
        { kind: 'chat', id: documentId, title: 'Paper' },
        { kind: 'resource', id: documentId, title: 'Paper' }
      ],
      activeKey: `notes:${documentId}`,
      storageKey: `notes:${documentId}`,
      gardenKey: null
    }
    await store.save(toolLayout)
    await expect(store.load()).resolves.toEqual({ layout: toolLayout })
    await expect(store.save({ ...toolLayout, module: 'Garden' })).rejects.toThrow('INVALID_LAYOUT')
    await expect(store.save({ ...toolLayout, tabs: [{ kind: 'other', id: documentId }] })).rejects.toThrow('INVALID_LAYOUT')
  })
})

test('Garden AI and history tabs persist as Garden pages', async () => {
  await withDirectory(async directory => {
    const store = new Layout(directory)
    const gardenLayout: WorkspaceLayout = {
      version: 1,
      module: 'Garden',
      tabs: [
        { kind: 'topic', id: topicId, title: 'Topic' },
        { kind: 'ai', id: topicId, title: 'Topic' },
        { kind: 'history', id: topicId, title: 'Topic' },
        { kind: 'materials', id: topicId, title: 'Topic' }
      ],
      activeKey: `ai:${topicId}`,
      storageKey: null,
      gardenKey: `history:${topicId}`,
      directoryCollapsed: true
    }
    await store.save(gardenLayout)
    await expect(store.load()).resolves.toEqual({ layout: gardenLayout })
    await expect(store.save({ ...gardenLayout, module: 'Storage' })).rejects.toThrow('INVALID_LAYOUT')
  })
})

test('corrupt or structurally invalid layouts report invalid instead of loading', async () => {
  await withDirectory(async directory => {
    const store = new Layout(directory)
    await writeFile(join(directory, 'workspace-layout.json'), '{not json')
    await expect(store.load()).resolves.toEqual({ layout: null, invalid: true })
    await writeFile(join(directory, 'workspace-layout.json'), JSON.stringify({ ...layout, activeKey: 'topic:missing' }))
    await expect(store.load()).resolves.toEqual({ layout: null, invalid: true })
    await writeFile(join(directory, 'workspace-layout.json'), JSON.stringify({ ...layout, module: 'Garden' }))
    await expect(store.load()).resolves.toEqual({ layout: null, invalid: true })
  })
})

test('save rejects malformed layouts and out-of-range sidebar widths', async () => {
  await withDirectory(async directory => {
    const store = new Layout(directory)
    await expect(store.save({ ...layout, version: 2 })).rejects.toThrow('INVALID_LAYOUT')
    await expect(store.save({ ...layout, tabs: [layout.tabs[0], layout.tabs[0]] })).rejects.toThrow('INVALID_LAYOUT')
    await expect(store.save({ ...layout, sidebar: { mode: 'notes', width: 900 } })).rejects.toThrow('INVALID_LAYOUT')
    await expect(store.save({ ...layout, tabs: [{ kind: 'document', id: '../outside' }] })).rejects.toThrow('INVALID_LAYOUT')
  })
})
