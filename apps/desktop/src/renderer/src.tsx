import {SourceNavigationContext} from './source-navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, AppStatus, DocumentRecord, ReaderTarget, Topic, WorkspaceLayout } from '../shared/status'
import './style.css'
import './workspace-ui.css'
import { Garden, type GardenPage } from './Garden'
import { collectAncestors, defaultExpanded } from './garden-tree'
import { gardenBook, hasUnsavedGarden, unsavedReviewTopicIds, unsavedTopicIds, wikiDirty } from './garden-book'
import { House, houseTitles, houseForms } from './House'
import { clearMetadataDraft } from './MetadataEditor'
import { Storage } from './Storage'
import { documentHasUnsavedNotes, hasUnsavedNotes, notebookFor, unsavedDocumentIds } from './notebook'
import { sessionStore } from './session-state'
import { addWorkspaceTab, CREATE_TOPIC_TAB_ID, documentTab, gardenToolTab, isStorageTab, moduleForTab, nextActiveKeyAfterClose, restoreTabs, tabKindLabel, toolTab, topicCreateTab, topicManageTab, topicTab, type GardenTool, type StorageTool, type WorkspaceTab } from './workspace-tabs'
declare global { interface Window { yorw: DesktopBridge } }
type Module = 'Storage' | 'Garden' | 'House'
type CloseChoice = 'save' | 'discard' | 'cancel'
const MODULES: Module[] = ['Storage', 'Garden', 'House']
const sameSet = (left: Set<string>, right: Set<string>) => left.size === right.size && [...left].every(value => right.has(value))
function App() {
  const [started, setStarted] = useState(false)
  const [module, setModule] = useState<Module>('Storage')
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [gardenKey, setGardenKey] = useState<string | null>(null)
  const [status, setStatus] = useState<AppStatus>({ state: 'starting', message: '正在连接本地服务' })
  const [layoutReady, setLayoutReady] = useState(false)
  const [layoutNotice, setLayoutNotice] = useState('')
  const [closePrompt, setClosePrompt] = useState<WorkspaceTab | null>(null)
  const [unsaved, setUnsaved] = useState<{ documents: Set<string>; topics: Set<string>; reviews: Set<string>; create: boolean; manage: Set<string> }>(() => ({ documents: new Set(), topics: new Set(), reviews: new Set(), create: false, manage: new Set() }))
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [directoryCollapsed, setDirectoryCollapsed] = useState(false)
  const [storageDirectoryCollapsed, setStorageDirectoryCollapsed] = useState(false)
  const [gardenView, setGardenView] = useState<'tree' | 'paths'>('tree')
  const [gardenExpanded, setGardenExpanded] = useState<string[] | null>(null)
  const [pendingJump, setPendingJump] = useState<({ documentId: string; sequence: number } & ReaderTarget) | null>(null)
  const jumpSequence = useRef(0)
  const restored = useRef(false)
  const closeResolver = useRef<((choice: CloseChoice) => void) | null>(null)
  const closeDialog = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const navRefs = useRef(new Map<Module, HTMLButtonElement>())
  const sidebarRevision = useRef('')
  const saveNotice = useRef(false)
  const storageTab = storageKey ? tabs.find(tab => tab.key === storageKey && isStorageTab(tab)) : undefined
  const storageDocumentId = storageTab?.id ?? null
  const storageTool: 'document' | StorageTool | null = storageTab ? storageTab.kind as 'document' | StorageTool : null
  const gardenTab = gardenKey ? tabs.find(tab => tab.key === gardenKey && !isStorageTab(tab) && tab.kind !== 'settings') : undefined
  const gardenTopicId = gardenTab && gardenTab.kind !== 'topic-create' ? gardenTab.id : null
  const gardenPage: GardenPage | null = gardenTab ? gardenTab.kind as GardenPage : null
  useEffect(() => {
    let active = true
    const update = () => window.yorw.getStatus().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setStatus({ state: 'failed', message: '无法连接桌面服务，请重新打开知栖' }) })
    void update()
    const timer = setInterval(update, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  useEffect(() => { if (status.state === 'ready') setStarted(true) }, [status.state])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (hasUnsavedNotes() || hasUnsavedGarden() || [...houseForms.values()].some(form=>form.dirty)) {
        event.preventDefault()
        // Electron explicitly accepts false; DOM typings model browser message strings.
        ;(event as unknown as { returnValue: boolean }).returnValue = false
      }
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [])
  useEffect(() => {
    const update = () => {
      const documents = new Set(unsavedDocumentIds())
      const topics = new Set(unsavedTopicIds())
      const reviews = new Set(unsavedReviewTopicIds())
      const create = gardenBook().createDirty()
      const manage = new Set(gardenBook().manageDirtyIds())
      setUnsaved(previous => sameSet(previous.documents, documents) && sameSet(previous.topics, topics) && sameSet(previous.reviews, reviews) && previous.create === create && sameSet(previous.manage, manage) ? previous : { documents, topics, reviews, create, manage })
    }
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (status.state !== 'ready' || restored.current) return
    restored.current = true
    void (async () => {
      try {
        const result = await window.yorw.layout.load()
        if (!result.ok || result.value.invalid) {
          setLayoutNotice(result.ok ? '上次的工作标签布局损坏，已从 Storage 开始。' : '无法读取上次的工作标签布局，已从 Storage 开始。')
          return
        }
        const layout = result.value.layout
        if (!layout) return
        const [documents, topics] = await Promise.all([window.yorw.documents.list(), window.yorw.garden.list()])
        if (!documents.ok && !topics.ok) {
          setLayoutNotice('无法核对已打开页面，已从 Storage 开始。')
          setModule('Storage')
          return
        }
        const documentTitles = new Map(documents.ok ? documents.value.items.map(item => [item.id, item.title || item.original_name] as const) : [])
        const topicTitles = new Map(topics.ok ? topics.value.items.map(item => [item.id, item.title] as const) : [])
        const { tabs: restoredTabs, skipped } = restoreTabs(layout.tabs, documentTitles, topicTitles)
        if (skipped) setLayoutNotice(`有 ${skipped} 个已打开页面已不存在，已跳过。`)
        const keys = new Set(restoredTabs.map(tab => tab.key))
        const active = layout.activeKey && keys.has(layout.activeKey) ? layout.activeKey : null
        const activeTab = active ? restoredTabs.find(tab => tab.key === active) : undefined
        setTabs(restoredTabs)
        setActiveKey(active)
        setStorageKey(layout.storageKey && restoredTabs.some(tab => tab.key === layout.storageKey && isStorageTab(tab)) ? layout.storageKey : null)
        setGardenKey(layout.gardenKey && restoredTabs.some(tab => tab.key === layout.gardenKey && moduleForTab(tab)==='Garden') ? layout.gardenKey : null)
        setModule(activeTab ? moduleForTab(activeTab) : layout.module)
        setDirectoryCollapsed(layout.directoryCollapsed ?? false)
        setStorageDirectoryCollapsed(layout.storageDirectoryCollapsed ?? false)
        setGardenView(layout.gardenView ?? 'tree')
        setGardenExpanded(layout.gardenExpanded ? layout.gardenExpanded.filter(id => topicTitles.has(id)) : null)
        if (layout.sidebar) sessionStore().applySidebarPreference(layout.sidebar)
      } catch {
        setLayoutNotice('无法读取上次的工作标签布局，已从 Storage 开始。')
      } finally {
        setLayoutReady(true)
      }
    })()
  }, [status.state])
  useEffect(() => {
    if (!layoutReady) return
    const layout: WorkspaceLayout = {
      version: 1,
      module,
      tabs: tabs.map(tab => ({ kind: tab.kind, id: tab.id, title: tab.title })),
      activeKey: activeKey && tabs.some(tab => tab.key === activeKey) ? activeKey : null,
      storageKey: storageKey && tabs.some(tab => tab.key === storageKey && isStorageTab(tab)) ? storageKey : null,
      gardenKey: gardenKey && tabs.some(tab => tab.key === gardenKey && !isStorageTab(tab)) ? gardenKey : null,
      sidebar: sessionStore().sidebarPreferenceFor(storageDocumentId),
      directoryCollapsed,
      storageDirectoryCollapsed,
      gardenView,
      ...(gardenExpanded ? { gardenExpanded } : {})
    }
    let active = true
    void window.yorw.layout.save(layout).then(result => {
      if (active && !result.ok && !saveNotice.current) { saveNotice.current = true; setLayoutNotice('工作标签布局未能保存。') }
    })
    return () => { active = false }
  }, [layoutReady, module, tabs, activeKey, storageKey, gardenKey, layoutRevision, storageDocumentId, directoryCollapsed, storageDirectoryCollapsed, gardenView, gardenExpanded])
  useEffect(() => {
    const update = () => {
      const preference = sessionStore().sidebarPreferenceFor(storageDocumentId)
      const key = JSON.stringify(preference)
      if (key !== sidebarRevision.current) { sidebarRevision.current = key; setLayoutRevision(value => value + 1) }
    }
    const unsubscribe = sessionStore().subscribe(update)
    update()
    return unsubscribe
  }, [storageDocumentId])
  useEffect(() => { if (closePrompt) closeDialog.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [closePrompt])
  const updateDocumentTitles = useCallback((items: DocumentRecord[]) => {
    const titles = new Map(items.map(item => [item.id, item.title || item.original_name]))
    setTabs(previous => {
      let changed = false
      const next = previous.map(tab => {
        if (!isStorageTab(tab)) return tab
        const title = titles.get(tab.id)
        if (title !== undefined && title !== tab.title) { changed = true; return { ...tab, title } }
        return tab
      })
      return changed ? next : previous
    })
  }, [])
  const updateTopicTitles = useCallback((items: Topic[]) => {
    const titles = new Map(items.map(item => [item.id, item.title]))
    setTabs(previous => {
      let changed = false
      const next = previous.map(tab => {
        if (isStorageTab(tab) || tab.kind==='settings') return tab
        const title = titles.get(tab.id)
        if (title !== undefined && title !== tab.title) { changed = true; return { ...tab, title } }
        return tab
      })
      return changed ? next : previous
    })
  }, [])
  function openTab(tab: WorkspaceTab) {
    setTabs(previous => addWorkspaceTab(previous, tab))
    setActiveKey(tab.key)
    setModule(moduleForTab(tab))
    if (isStorageTab(tab)) setStorageKey(tab.key)
    else if(tab.kind!=='settings') setGardenKey(tab.key)
  }
  function activateTab(tab: WorkspaceTab) {
    setActiveKey(tab.key)
    setModule(moduleForTab(tab))
    if (isStorageTab(tab)) setStorageKey(tab.key)
    else if(tab.kind!=='settings') setGardenKey(tab.key)
    requestAnimationFrame(() => tabRefs.current.get(tab.key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }
  function showModule(name: Module) {
    setModule(name)
    setActiveKey(null)
    if (name === 'Storage') setStorageKey(null)
    if (name === 'Garden') setGardenKey(null)
  }
  function showLibrary() { setStorageKey(null); setActiveKey(null) }
  function tabIsUnsaved(tab: WorkspaceTab) {
    if (tab.kind === 'settings') return houseForms.get(tab.id)?.dirty ?? false
    if (tab.kind === 'topic-create') return gardenBook().createDirty()
    if (tab.kind === 'topic-manage') return gardenBook().manageDirty(tab.id)
    if (tab.kind === 'topic') return gardenBook().hasUnsavedTopic(tab.id)
    if (tab.kind === 'ai') return gardenBook().hasUnsavedReview(tab.id)
    if (tab.kind === 'history') return false
    return tab.kind === 'document' || tab.kind === 'notes' ? documentHasUnsavedNotes(tab.id) : false
  }
  function askClose(tab: WorkspaceTab): Promise<CloseChoice> {
    if (!tabIsUnsaved(tab)) return Promise.resolve('discard')
    return new Promise(resolve => { closeResolver.current = resolve; setClosePrompt(tab) })
  }
  function answerClose(choice: CloseChoice) {
    const resolve = closeResolver.current
    closeResolver.current = null
    setClosePrompt(null)
    resolve?.(choice)
  }
  async function saveTab(tab: WorkspaceTab): Promise<boolean> {
    if(tab.kind==='settings')return await houseForms.get(tab.id)?.save() ?? true
    if (tab.kind === 'topic-create') {
      try {
        const topic = await gardenBook().createFromDraft()
        const topics = gardenBook().getSnapshot().topics
        const ancestors = collectAncestors(topics, topic.id)
        if (ancestors.size) setGardenExpanded(previous => [...new Set([...(previous ?? defaultExpanded(topics)), ...ancestors])])
        setTabs(previous => addWorkspaceTab(previous, topicTab(topic.id, topic.title)))
        return true
      } catch { return false }
    }
    if (tab.kind === 'topic-manage') {
      try { await gardenBook().saveManage(tab.id); return true } catch { return false }
    }
    if (tab.kind === 'document' || tab.kind === 'notes') {
      const notebook = notebookFor(tab.id)
      await notebook.saveAll()
      return !notebook.hasUnsaved()
    }
    if (tab.kind === 'topic') {
      const book = gardenBook()
      await book.save(tab.id)
      const draft = book.getSnapshot().drafts[tab.id]
      return !draft || (!wikiDirty(draft) && !draft.saving)
    }
    return true
  }
  function discardTab(tab: WorkspaceTab) {
    if (tab.kind === 'metadata') clearMetadataDraft(tab.id)
    if (tab.kind === 'topic-create') gardenBook().discardCreate()
    else if (tab.kind === 'topic-manage') gardenBook().discardManage(tab.id)
    if (tab.kind === 'document' || tab.kind === 'notes') notebookFor(tab.id).discardAll()
    else if (tab.kind === 'topic') gardenBook().discardTopic(tab.id)
    else if (tab.kind === 'ai') gardenBook().discardReview(tab.id)
  }
  function expandTool(document: DocumentRecord, tool: StorageTool) {
    const title = document.title || document.original_name
    const key = `${tool}:${document.id}`
    setTabs(previous => addWorkspaceTab(previous, toolTab(tool, document.id, title)))
    setActiveKey(key)
    setStorageKey(key)
    setModule('Storage')
    if (tool !== 'resource' && tool !== 'metadata') sessionStore().updateDocument(document.id, { sidebarMode: tool, sidebarOpen: false })
  }
  function closeMetadataTab(document: DocumentRecord) {
    clearMetadataDraft(document.id)
    const key = `metadata:${document.id}`
    setTabs(previous => previous.filter(tab => tab.key !== key))
    setActiveKey(null)
    setStorageKey(null)
    setModule('Storage')
  }
  function collapseTool(document: DocumentRecord, tool: StorageTool) {
    const title = document.title || document.original_name
    const documentKey = `document:${document.id}`
    setTabs(previous => addWorkspaceTab(previous.filter(tab => tab.key !== `${tool}:${document.id}`), documentTab(document.id, title)))
    setActiveKey(documentKey)
    setStorageKey(documentKey)
    setModule('Storage')
    if (tool !== 'resource' && tool !== 'metadata') sessionStore().updateDocument(document.id, { sidebarMode: tool, sidebarOpen: true })
  }
  function expandGardenTool(topic: Topic, tool: GardenTool) {
    const key = `${tool}:${topic.id}`
    setTabs(previous => addWorkspaceTab(previous, gardenToolTab(tool, topic.id, topic.title)))
    setActiveKey(key)
    setGardenKey(key)
    setModule('Garden')
  }
  function collapseGardenTool(topic: Topic, tool: GardenTool) {
    const topicKey = `topic:${topic.id}`
    setTabs(previous => addWorkspaceTab(previous.filter(tab => tab.key !== `${tool}:${topic.id}`), topicTab(topic.id, topic.title)))
    setActiveKey(topicKey)
    setGardenKey(topicKey)
    setModule('Garden')
  }
  function openCreate(parentId: string | null = null) {
    gardenBook().startCreate(parentId)
    const tab = topicCreateTab()
    setTabs(previous => addWorkspaceTab(previous, tab))
    setActiveKey(tab.key)
    setGardenKey(tab.key)
    setModule('Garden')
  }
  function closeCreateTab() {
    const tab = tabs.find(item => item.key === `topic-create:${CREATE_TOPIC_TAB_ID}`)
    if (tab) void closeTab(tab)
  }
  function createComplete(topic: Topic) {
    const key = `topic:${topic.id}`
    setTabs(previous => addWorkspaceTab(previous.filter(tab => tab.key !== `topic-create:${CREATE_TOPIC_TAB_ID}`), topicTab(topic.id, topic.title)))
    setActiveKey(key)
    setGardenKey(key)
    setModule('Garden')
  }
  function topicDeleted(id: string) {
    const removed = (tab: WorkspaceTab) => tab.id === id && moduleForTab(tab) === 'Garden' && tab.kind !== 'topic-create'
    const keys = new Set(tabs.filter(removed).map(tab => tab.key))
    setTabs(previous => previous.filter(tab => !removed(tab)))
    setActiveKey(previous => previous && keys.has(previous) ? null : previous)
    setGardenKey(previous => previous && keys.has(previous) ? null : previous)
    setGardenExpanded(previous => previous?.filter(value => value !== id) ?? null)
  }
  function openManage(topic: Topic) {
    const tab = topicManageTab(topic.id, topic.title)
    setTabs(previous => addWorkspaceTab(previous, tab))
    setActiveKey(tab.key)
    setGardenKey(tab.key)
    setModule('Garden')
  }
  function closeManage(topic: Topic) {
    const tab = tabs.find(item => item.key === `topic-manage:${topic.id}`)
    if (tab) void closeTab(tab)
    else openTab(topicTab(topic.id, topic.title))
  }
  function openDocumentAt(document: DocumentRecord, target: ReaderTarget) {
    const title = document.title || document.original_name
    const key = `document:${document.id}`
    setTabs(previous => addWorkspaceTab(previous, documentTab(document.id, title)))
    setActiveKey(key)
    setStorageKey(key)
    setModule('Storage')
    const sequence = ++jumpSequence.current
    setPendingJump({ documentId: document.id, ...target, sequence })
  }
  const clearJump = useCallback((sequence: number) => {
    setPendingJump(current => current && current.sequence === sequence ? null : current)
  }, [])
  async function closeTab(tab: WorkspaceTab): Promise<boolean> {
    const choice = await askClose(tab)
    if (choice === 'cancel') return false
    if (choice === 'save' && !(await saveTab(tab))) { setLayoutNotice('保存失败，标签保持打开。'); return false }
    if (choice === 'discard') discardTab(tab)
    const remaining = tabs.filter(item => item.key !== tab.key)
    const next = nextActiveKeyAfterClose(tabs, tab.key, activeKey)
    setTabs(previous => previous.filter(item => item.key !== tab.key))
    setActiveKey(next)
    if (storageKey === tab.key) setStorageKey(null)
    if (gardenKey === tab.key) setGardenKey(null)
    if (next) {
      const nextTab = remaining.find(item => item.key === next)
      if (nextTab) {
        setModule(moduleForTab(nextTab))
        if (isStorageTab(nextTab)) setStorageKey(nextTab.key)
        else if(nextTab.kind!=='settings') setGardenKey(nextTab.key)
        requestAnimationFrame(() => tabRefs.current.get(nextTab.key)?.focus())
      }
    } else {
      requestAnimationFrame(() => navRefs.current.get(module)?.focus())
    }
    if (tab.kind === 'topic-create' && choice === 'save') {
      const created = gardenBook().getSnapshot().selected
      if (created) {
        const key = `topic:${created}`
        setActiveKey(key)
        setGardenKey(key)
        setModule('Garden')
      }
    }
    return true
  }
  async function closeOthers() {
    if (!activeKey) return
    let remaining = tabs
    for (const tab of tabs) {
      if (tab.key === activeKey) continue
      const choice = await askClose(tab)
      if (choice === 'cancel') break
      if (choice === 'save' && !(await saveTab(tab))) { setLayoutNotice('保存失败，已停止关闭其余标签。'); break }
      if (choice === 'discard') discardTab(tab)
      remaining = remaining.filter(item => item.key !== tab.key)
      setTabs(previous => previous.filter(item => item.key !== tab.key))
    }
    const keep = remaining.find(item => item.key === activeKey)
    if (!keep) { setActiveKey(null); setStorageKey(null); setGardenKey(null); return }
    setActiveKey(keep.key)
    setModule(moduleForTab(keep))
    const keepStorage = isStorageTab(keep) ? keep : remaining.find(item => item.key === storageKey && isStorageTab(item))
    const keepTopic = moduleForTab(keep)==='Garden' ? keep : remaining.find(item => item.key === gardenKey && !isStorageTab(item))
    setStorageKey(keepStorage?.key ?? null)
    setGardenKey(keepTopic?.key ?? null)
    requestAnimationFrame(() => tabRefs.current.get(keep.key)?.focus())
  }
  function onDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); answerClose('cancel'); return }
    if (event.key !== 'Tab') return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    if (!buttons.length) return
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTab) {
    if (event.key === 'Delete') { event.preventDefault(); void closeTab(tab); return }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = tabs.findIndex(item => item.key === tab.key)
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : Math.min(tabs.length - 1, index + 1)
    const nextTab = tabs[nextIndex]
    if (nextTab) { activateTab(nextTab); requestAnimationFrame(() => tabRefs.current.get(nextTab.key)?.focus()) }
  }
  const tabStopKey = activeKey ?? tabs[0]?.key
  const activeTab = activeKey ? tabs.find(tab => tab.key === activeKey) : undefined
  return <SourceNavigationContext.Provider value={(identity,target)=>{void window.yorw.documents.list().then(result=>{const record=result.ok?result.value.items.find(item=>item.id===identity):undefined;if(record)openDocumentAt(record,target);else setLayoutNotice('来源文献不可用。')}).catch(()=>setLayoutNotice('来源加载失败，请重试。'))}}><div className="app-shell">
    <header className="app-header"><div className="app-brand"><strong>知栖 <span>Yorw</span></strong></div><nav className="module-nav" aria-label="工作区">{MODULES.map(name => <button key={name} ref={element => { if (element) navRefs.current.set(name, element); else navRefs.current.delete(name) }} aria-current={module === name ? 'page' : undefined} onClick={() => showModule(name)}>{name}</button>)}</nav></header>
    {tabs.length>0&&<div className="workspace-tabbar">
      {tabs.length ? <div className="workspace-tablist" role="tablist" aria-label="工作标签">{tabs.map(tab => <div className={`workspace-tab-item${activeKey === tab.key ? ' active' : ''}`} role="presentation" key={tab.key}>
        <button type="button" role="tab" id={`tab-${tab.key}`} data-tab-key={tab.key} aria-selected={activeKey === tab.key} aria-controls={tab.kind==='settings' ? 'house-panel' : isStorageTab(tab) ? 'storage-panel' : 'garden-panel'} tabIndex={tab.key === tabStopKey ? 0 : -1} className="workspace-tab" title={`${tabKindLabel(tab)} · ${tab.title}`} ref={element => { if (element) tabRefs.current.set(tab.key, element); else tabRefs.current.delete(tab.key) }} onClick={() => activateTab(tab)} onKeyDown={event => onTabKeyDown(event, tab)}>
          <span className="workspace-tab-title">{tab.title}</span><span className="workspace-tab-kind">{tabKindLabel(tab)}</span>
          {((tab.kind === 'document' || tab.kind === 'notes') ? unsaved.documents.has(tab.id) : tab.kind === 'topic' ? unsaved.topics.has(tab.id) : tab.kind === 'topic-create' ? unsaved.create : tab.kind === 'topic-manage' ? unsaved.manage.has(tab.id) : tab.kind === 'ai' ? unsaved.reviews.has(tab.id) : false) && <span className="workspace-tab-dirty" aria-label="有未保存内容" title="有未保存内容">●</span>}
        </button>
        <button type="button" className="workspace-tab-close" aria-label={`关闭${tabKindLabel(tab)} ${tab.title}`} title={`关闭${tabKindLabel(tab)}`} onClick={event => { event.stopPropagation(); void closeTab(tab) }}>×</button>
      </div>)}</div> : null}
      {tabs.length > 1 && activeKey && <button type="button" className="workspace-tab-action" onClick={() => void closeOthers()}>关闭其他</button>}
    </div>}
    {layoutNotice && <p role="status" className="app-notice">{layoutNotice}<button onClick={() => setLayoutNotice('')}>关闭提示</button></p>}
    {status.state !== 'ready' && <p role="status" className={`app-status ${status.state}`}>{status.message}</p>}
    {(status.state === 'ready' || started) && (layoutReady ? <main className="app-main">
      <div className="module-view" id="storage-panel" role={module === 'Storage' && activeTab && isStorageTab(activeTab) ? 'tabpanel' : undefined} aria-labelledby={module === 'Storage' && activeTab && isStorageTab(activeTab) ? `tab-${activeTab.key}` : undefined} hidden={module !== 'Storage'}><Storage activeDocumentId={storageDocumentId} activeTool={storageTool} storageDirectoryCollapsed={storageDirectoryCollapsed} onToggleStorageDirectory={() => setStorageDirectoryCollapsed(value => !value)} onOpenDocument={document => openTab(documentTab(document.id, document.title || document.original_name))} onOpenTool={(tool, document) => expandTool(document, tool)} onCollapseTool={(tool, document) => collapseTool(document, tool)} onCloseMetadata={closeMetadataTab} onNavigate={(document, target) => openDocumentAt(document, target)} onShowNotes={document => expandTool(document, 'notes')} onOpenTopic={topic => openTab(topicTab(topic.id, topic.title))} pendingJump={pendingJump} onJumpApplied={clearJump} onShowLibrary={showLibrary} onTitles={updateDocumentTitles} /></div>
      <div className="module-view" id="garden-panel" role={module === 'Garden' && activeTab && !isStorageTab(activeTab) ? 'tabpanel' : undefined} aria-labelledby={module === 'Garden' && activeTab && !isStorageTab(activeTab) ? `tab-${activeTab.key}` : undefined} hidden={module !== 'Garden'}><Garden onDeleted={topicDeleted} activeTopicId={gardenTopicId} activePage={gardenPage} onOpenTopic={topic => openTab(topicTab(topic.id, topic.title))} onOpenTool={(tool, topic) => expandGardenTool(topic, tool)} onCollapseTool={(tool, topic) => collapseGardenTool(topic, tool)} onOpenCreate={parentId => openCreate(parentId)} onCloseCreate={closeCreateTab} onCreateComplete={createComplete} onOpenManage={openManage} onCloseManage={closeManage} directoryCollapsed={directoryCollapsed} onToggleDirectory={() => setDirectoryCollapsed(value => !value)} view={gardenView} onViewChange={setGardenView} expanded={gardenExpanded} onExpandedChange={setGardenExpanded} onTitles={updateTopicTitles} /></div>
      <div className="module-view house-view" id="house-panel" role={module==='House'&&activeTab?.kind==='settings'?'tabpanel':undefined} aria-labelledby={module==='House'&&activeTab?.kind==='settings'?`tab-${activeTab.key}`:undefined} hidden={module !== 'House'}><div hidden={activeTab?.kind==='settings'}><House onOpen={id=>openTab({kind:'settings',id,title:houseTitles[id],key:`settings:${id}`})}/></div>{tabs.filter(tab=>tab.kind==='settings').map(tab=><div key={tab.key} hidden={activeKey!==tab.key}><House page={tab.id} active={module==='House'&&activeKey===tab.key}/></div>)}</div>
    </main> : <p className="app-status" role="status">正在恢复工作标签…</p>)}
    {closePrompt && <div className="close-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) answerClose('cancel') }}>
      <div ref={closeDialog} className="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title" onKeyDown={onDialogKeyDown}>
        <h2 id="close-dialog-title">“{closePrompt.title}”{closePrompt.kind==='topic-create'?'尚未创建':'有未保存内容'}</h2>
        <p>{closePrompt.kind==='topic-create'?'创建后关闭新建页；创建失败会保持标签打开。':closePrompt.kind==='topic-manage'?'保存目录信息后关闭；保存失败会保持标签打开。':'保存后关闭；保存失败会保持标签打开。AI 草稿编辑会保留在本次会话。'}</p>
        <div className="actions"><button className="primary" onClick={() => answerClose('save')}>{closePrompt.kind==='topic-create'?'创建并关闭':'保存并关闭'}</button><button onClick={() => answerClose('discard')}>放弃并关闭</button><button onClick={() => answerClose('cancel')}>取消</button></div>
      </div>
    </div>}
  </div></SourceNavigationContext.Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
