import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkspaceLayout, WorkspaceLayoutModule, WorkspaceLayoutSidebarMode, WorkspaceLayoutTab } from '../shared/status'

const MODULES = new Set<WorkspaceLayoutModule>(['Storage', 'Garden', 'House'])
const SIDEBAR_MODES = new Set<WorkspaceLayoutSidebarMode>(['notes', 'search', 'chat'])
const TAB_KINDS = new Set(['document', 'topic', 'notes', 'search', 'chat', 'ai', 'history'])
const STORAGE_TAB_KINDS = new Set(['document', 'notes', 'search', 'chat'])
const GARDEN_TAB_KINDS = new Set(['topic', 'ai', 'history'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TABS = 50
const MAX_TITLE = 500
const MAX_BYTES = 64 * 1024

const tabKey = (tab: Pick<WorkspaceLayoutTab, 'kind' | 'id'>) => `${tab.kind}:${tab.id}`

function validate(value: unknown): WorkspaceLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.version !== 1) return null
  if (typeof input.module !== 'string' || !MODULES.has(input.module as WorkspaceLayoutModule)) return null
  if (!Array.isArray(input.tabs) || input.tabs.length > MAX_TABS) return null
  const tabs: WorkspaceLayoutTab[] = []
  const keys = new Set<string>()
  for (const item of input.tabs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const tab = item as Record<string, unknown>
    if (typeof tab.kind !== 'string' || !TAB_KINDS.has(tab.kind)) return null
    if (typeof tab.id !== 'string' || !UUID.test(tab.id)) return null
    if (tab.title !== undefined && (typeof tab.title !== 'string' || tab.title.length > MAX_TITLE)) return null
    const kind = tab.kind as WorkspaceLayoutTab['kind']
    const key = tabKey({ kind, id: tab.id })
    if (keys.has(key)) return null
    keys.add(key)
    tabs.push({ kind, id: tab.id, ...(tab.title === undefined ? {} : { title: tab.title }) })
  }
  if (input.activeKey !== null && typeof input.activeKey !== 'string') return null
  const activeKey = input.activeKey as string | null
  if (activeKey !== null && !keys.has(activeKey)) return null
  if (activeKey !== null && (GARDEN_TAB_KINDS.has(activeKey.split(':')[0]) ? 'Garden' : 'Storage') !== input.module) return null
  if (input.storageKey !== null && typeof input.storageKey !== 'string') return null
  if (input.gardenKey !== null && typeof input.gardenKey !== 'string') return null
  const storageKey = input.storageKey as string | null
  const gardenKey = input.gardenKey as string | null
  if (storageKey !== null && !tabs.some(tab => tabKey(tab) === storageKey && STORAGE_TAB_KINDS.has(tab.kind))) return null
  if (gardenKey !== null && !tabs.some(tab => tabKey(tab) === gardenKey && GARDEN_TAB_KINDS.has(tab.kind))) return null
  let sidebar: WorkspaceLayout['sidebar']
  if (input.sidebar !== undefined) {
    if (!input.sidebar || typeof input.sidebar !== 'object' || Array.isArray(input.sidebar)) return null
    const raw = input.sidebar as Record<string, unknown>
    if (typeof raw.mode !== 'string' || !SIDEBAR_MODES.has(raw.mode as WorkspaceLayoutSidebarMode)) return null
    if (typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width < 320 || raw.width > 480) return null
    sidebar = { mode: raw.mode as WorkspaceLayoutSidebarMode, width: raw.width }
  }
  let directoryCollapsed: boolean | undefined
  if (input.directoryCollapsed !== undefined) {
    if (typeof input.directoryCollapsed !== 'boolean') return null
    directoryCollapsed = input.directoryCollapsed
  }
  return {
    version: 1,
    module: input.module as WorkspaceLayoutModule,
    tabs,
    activeKey,
    storageKey,
    gardenKey,
    ...(sidebar ? { sidebar } : {}),
    ...(directoryCollapsed === undefined ? {} : { directoryCollapsed })
  }
}

export class Layout {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private directory: string) {}

  private path() { return join(this.directory, 'workspace-layout.json') }

  async load(): Promise<{ layout: WorkspaceLayout | null; invalid?: boolean }> {
    try {
      const raw = await readFile(this.path(), 'utf8')
      if (Buffer.byteLength(raw) > MAX_BYTES) return { layout: null, invalid: true }
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return { layout: null, invalid: true } }
      const layout = validate(parsed)
      return layout ? { layout } : { layout: null, invalid: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { layout: null }
      return { layout: null, invalid: true }
    }
  }

  save(value: unknown): Promise<{ saved: true }> {
    const job = this.queue.catch(() => {}).then(() => this.saveOne(value))
    this.queue = job
    return job
  }

  private async saveOne(value: unknown): Promise<{ saved: true }> {
    const layout = validate(value)
    if (!layout) throw new Error('INVALID_LAYOUT')
    await mkdir(this.directory, { recursive: true })
    const target = this.path()
    const temp = join(this.directory, randomUUID() + '.tmp')
    try {
      await writeFile(temp, JSON.stringify(layout), { encoding: 'utf8', flag: 'wx' })
      await rename(temp, target)
    } finally {
      await unlink(temp).catch(() => {})
    }
    return { saved: true }
  }
}
