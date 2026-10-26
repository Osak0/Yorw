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
