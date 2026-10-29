import type { WorkspaceLayoutTab } from '../shared/status'

export type WorkspaceModule = 'Storage' | 'Garden' | 'House'
export type StorageTool = 'notes' | 'search' | 'chat' | 'resource' | 'metadata'
export type GardenTool = 'ai' | 'history' | 'materials'
export type WorkspaceTabKind = 'settings' | 'document' | 'topic' | StorageTool | GardenTool
const STORAGE_KINDS: WorkspaceTabKind[] = ['document', 'notes', 'search', 'chat', 'resource', 'metadata']

export type WorkspaceTab = {
  key: string
  kind: WorkspaceTabKind
  id: string
  title: string
}

function makeTab(kind: WorkspaceTabKind, id: string, title: string): WorkspaceTab {
  return { key: `${kind}:${id}`, kind, id, title }
}

export function documentTab(id: string, title: string): WorkspaceTab {
  return makeTab('document', id, title)
}

export function topicTab(id: string, title: string): WorkspaceTab {
  return makeTab('topic', id, title)
}

export function toolTab(tool: StorageTool, id: string, title: string): WorkspaceTab {
  return makeTab(tool, id, title)
}

export function gardenToolTab(tool: GardenTool, id: string, title: string): WorkspaceTab {
  return makeTab(tool, id, title)
}

export function isStorageTab(tab: WorkspaceTab): boolean {
  return STORAGE_KINDS.includes(tab.kind)
}

/** 同一页面类型与实体只保留一个标签；重复打开由调用方激活已有项。 */
export function addWorkspaceTab(tabs: WorkspaceTab[], tab: WorkspaceTab): WorkspaceTab[] {
  return tabs.some(item => item.key === tab.key) ? tabs : [...tabs, tab]
}

export function moduleForTab(tab: WorkspaceTab): WorkspaceModule {
  return tab.kind === 'settings' ? 'House' : isStorageTab(tab) ? 'Storage' : 'Garden'
}

export function tabKindLabel(tab: WorkspaceTab): string {
  return { settings:'设置', document: '文献', topic: '专题', notes: '笔记', search: '检索', chat: '问答', resource: '文献资料', metadata: '整理文献', ai: 'AI 优化', history: '修订历史', materials: '关联材料' }[tab.kind]
}

/** Restores saved pages against the current workspace and reports pages that no longer exist. */
export function restoreTabs(items: WorkspaceLayoutTab[], documents: Map<string, string>, topics: Map<string, string>): { tabs: WorkspaceTab[]; skipped: number } {
  const tabs: WorkspaceTab[] = []
  for (const item of items) {
    if(item.kind==='settings'){tabs.push(makeTab('settings',item.id,({parsers:'文献解析与预览',chat:'聊天模型',retrieval:'检索',data:'数据与导出'} as Record<string,string>)[item.id]));continue}
    const garden = !STORAGE_KINDS.includes(item.kind)
    const title = (garden ? topics : documents).get(item.id)
    if (title !== undefined) tabs.push(makeTab(item.kind, item.id, title))
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
