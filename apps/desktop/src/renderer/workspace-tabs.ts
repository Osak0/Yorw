import type { WorkspaceLayoutTab } from '../shared/status'

export type WorkspaceModule = 'Storage' | 'Garden'

export type WorkspaceTab = {
  key: string
  kind: 'document' | 'topic'
  id: string
  title: string
}

export function documentTab(id: string, title: string): WorkspaceTab {
  return { key: `document:${id}`, kind: 'document', id, title }
}

export function topicTab(id: string, title: string): WorkspaceTab {
  return { key: `topic:${id}`, kind: 'topic', id, title }
}

/** 同一页面类型与实体只保留一个标签；重复打开由调用方激活已有项。 */
export function addWorkspaceTab(tabs: WorkspaceTab[], tab: WorkspaceTab): WorkspaceTab[] {
  return tabs.some(item => item.key === tab.key) ? tabs : [...tabs, tab]
}

export function moduleForTab(tab: WorkspaceTab): WorkspaceModule {
  return tab.kind === 'document' ? 'Storage' : 'Garden'
}

export function tabKindLabel(tab: WorkspaceTab): string {
  return tab.kind === 'document' ? '文献' : '专题'
}

/** Restores saved pages against the current workspace and reports pages that no longer exist. */
export function restoreTabs(items: WorkspaceLayoutTab[], documents: Map<string, string>, topics: Map<string, string>): { tabs: WorkspaceTab[]; skipped: number } {
  const tabs: WorkspaceTab[] = []
  for (const item of items) {
    if (item.kind === 'document') {
      const title = documents.get(item.id)
      if (title !== undefined) tabs.push(documentTab(item.id, title))
    } else {
      const title = topics.get(item.id)
      if (title !== undefined) tabs.push(topicTab(item.id, title))
    }
  }
  return { tabs, skipped: items.length - tabs.length }
}

/** Closing a background tab keeps the active page; closing the active tab picks its neighbour. */
export function nextActiveKeyAfterClose(tabs: WorkspaceTab[], closingKey: string, activeKey: string | null): string | null {
  if (activeKey !== closingKey) return activeKey
  const index = tabs.findIndex(tab => tab.key === closingKey)
  if (index < 0) return activeKey
  return tabs[index + 1]?.key ?? tabs[index - 1]?.key ?? null
}
