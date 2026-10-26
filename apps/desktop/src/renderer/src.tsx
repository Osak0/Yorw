import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, AppStatus, DocumentRecord, Topic, WorkspaceLayout } from '../shared/status'
import './style.css'
import { Garden } from './Garden'
import { gardenBook, hasUnsavedGarden, unsavedTopicIds, wikiDirty } from './garden-book'
import { House } from './House'
import { Storage } from './Storage'
import { documentHasUnsavedNotes, hasUnsavedNotes, notebookFor, unsavedDocumentIds } from './notebook'
import { sessionStore } from './session-state'
import { addWorkspaceTab, documentTab, moduleForTab, nextActiveKeyAfterClose, restoreTabs, tabKindLabel, topicTab, type WorkspaceTab } from './workspace-tabs'
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
  const [unsaved, setUnsaved] = useState<{ documents: Set<string>; topics: Set<string> }>(() => ({ documents: new Set(), topics: new Set() }))
  const [layoutRevision, setLayoutRevision] = useState(0)
  const restored = useRef(false)
  const closeResolver = useRef<((choice: CloseChoice) => void) | null>(null)
  const closeDialog = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const navRefs = useRef(new Map<Module, HTMLButtonElement>())
  const sidebarRevision = useRef('')
  const saveNotice = useRef(false)
  const storageDocumentId = storageKey ? tabs.find(tab => tab.key === storageKey)?.id ?? null : null
  const gardenTopicId = gardenKey ? tabs.find(tab => tab.key === gardenKey)?.id ?? null : null
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
      if (hasUnsavedNotes() || hasUnsavedGarden()) {
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
      setUnsaved(previous => sameSet(previous.documents, documents) && sameSet(previous.topics, topics) ? previous : { documents, topics })
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
        setStorageKey(layout.storageKey && restoredTabs.some(tab => tab.key === layout.storageKey && tab.kind === 'document') ? layout.storageKey : null)
        setGardenKey(layout.gardenKey && restoredTabs.some(tab => tab.key === layout.gardenKey && tab.kind === 'topic') ? layout.gardenKey : null)
        setModule(activeTab ? moduleForTab(activeTab) : layout.module)
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
      storageKey: storageKey && tabs.some(tab => tab.key === storageKey && tab.kind === 'document') ? storageKey : null,
      gardenKey: gardenKey && tabs.some(tab => tab.key === gardenKey && tab.kind === 'topic') ? gardenKey : null,
      sidebar: sessionStore().sidebarPreferenceFor(storageDocumentId),
      directoryCollapsed: false
    }
    let active = true
    void window.yorw.layout.save(layout).then(result => {
      if (active && !result.ok && !saveNotice.current) { saveNotice.current = true; setLayoutNotice('工作标签布局未能保存。') }
    })
    return () => { active = false }
  }, [layoutReady, module, tabs, activeKey, storageKey, gardenKey, layoutRevision, storageDocumentId])
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
        if (tab.kind !== 'document') return tab
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
        if (tab.kind !== 'topic') return tab
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
    if (tab.kind === 'document') setStorageKey(tab.key)
    else setGardenKey(tab.key)
  }
  function activateTab(tab: WorkspaceTab) {
    setActiveKey(tab.key)
    setModule(moduleForTab(tab))
    if (tab.kind === 'document') setStorageKey(tab.key)
    else setGardenKey(tab.key)
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
    return tab.kind === 'document' ? documentHasUnsavedNotes(tab.id) : gardenBook().hasUnsavedTopic(tab.id)
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
    if (tab.kind === 'document') {
      const notebook = notebookFor(tab.id)
      await notebook.saveAll()
      return !notebook.hasUnsaved()
    }
    const book = gardenBook()
    await book.save(tab.id)
    const draft = book.getSnapshot().drafts[tab.id]
    return !draft || (!wikiDirty(draft) && !draft.saving)
  }
  function discardTab(tab: WorkspaceTab) {
    if (tab.kind === 'document') notebookFor(tab.id).discardAll()
    else gardenBook().discardTopic(tab.id)
  }
  async function closeTab(tab: WorkspaceTab): Promise<boolean> {
    const choice = await askClose(tab)
    if (choice === 'cancel') return false
    if (choice === 'save' && !(await saveTab(tab))) { setLayoutNotice('保存失败，标签保持打开。'); return false }
    if (choice === 'discard') discardTab(tab)
    const remaining = tabs.filter(item => item.key !== tab.key)
    const next = nextActiveKeyAfterClose(tabs, tab.key, activeKey)
    setTabs(remaining)
    setActiveKey(next)
    if (storageKey === tab.key) setStorageKey(null)
    if (gardenKey === tab.key) setGardenKey(null)
    if (next) {
      const nextTab = remaining.find(item => item.key === next)
      if (nextTab) {
        setModule(moduleForTab(nextTab))
        if (nextTab.kind === 'document') setStorageKey(nextTab.key)
        else setGardenKey(nextTab.key)
        requestAnimationFrame(() => tabRefs.current.get(nextTab.key)?.focus())
      }
    } else {
      requestAnimationFrame(() => navRefs.current.get(module)?.focus())
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
      setTabs(remaining)
    }
    const keep = remaining.find(item => item.key === activeKey)
    if (!keep) { setActiveKey(null); setStorageKey(null); setGardenKey(null); return }
    setActiveKey(keep.key)
    setModule(moduleForTab(keep))
    const keepDocument = keep.kind === 'document' ? keep : remaining.find(item => item.key === storageKey && item.kind === 'document')
    const keepTopic = keep.kind === 'topic' ? keep : remaining.find(item => item.key === gardenKey && item.kind === 'topic')
    setStorageKey(keepDocument?.key ?? null)
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
  return <div className="app-shell">
    <header className="app-header"><div className="app-brand"><strong>知栖 <span>Yorw</span></strong></div><nav className="module-nav" aria-label="工作区">{MODULES.map(name => <button key={name} ref={element => { if (element) navRefs.current.set(name, element); else navRefs.current.delete(name) }} aria-current={module === name ? 'page' : undefined} onClick={() => showModule(name)}>{name}</button>)}</nav></header>
    <div className="workspace-tabbar">
      {tabs.length ? <div className="workspace-tablist" role="tablist" aria-label="工作标签">{tabs.map(tab => <div className={`workspace-tab-item${activeKey === tab.key ? ' active' : ''}`} role="presentation" key={tab.key}>
        <button type="button" role="tab" id={`tab-${tab.key}`} data-tab-key={tab.key} aria-selected={activeKey === tab.key} aria-controls={tab.kind === 'document' ? 'storage-panel' : 'garden-panel'} tabIndex={tab.key === tabStopKey ? 0 : -1} className="workspace-tab" title={`${tabKindLabel(tab)} · ${tab.title}`} ref={element => { if (element) tabRefs.current.set(tab.key, element); else tabRefs.current.delete(tab.key) }} onClick={() => activateTab(tab)} onKeyDown={event => onTabKeyDown(event, tab)}>
          <span className="workspace-tab-title">{tab.title}</span><span className="workspace-tab-kind">{tabKindLabel(tab)}</span>
          {(tab.kind === 'document' ? unsaved.documents.has(tab.id) : unsaved.topics.has(tab.id)) && <span className="workspace-tab-dirty" aria-label="有未保存内容" title="有未保存内容">●</span>}
        </button>
        <button type="button" className="workspace-tab-close" aria-label={`关闭${tabKindLabel(tab)} ${tab.title}`} title={`关闭${tabKindLabel(tab)}`} onClick={event => { event.stopPropagation(); void closeTab(tab) }}>×</button>
      </div>)}</div> : <span className="workspace-tab-empty">打开文献或专题后，在这里切换</span>}
      {tabs.length > 1 && activeKey && <button type="button" className="workspace-tab-action" onClick={() => void closeOthers()}>关闭其他</button>}
    </div>
    {layoutNotice && <p role="status" className="app-notice">{layoutNotice}<button onClick={() => setLayoutNotice('')}>关闭提示</button></p>}
    {status.state !== 'ready' && <p role="status" className={`app-status ${status.state}`}>{status.message}</p>}
    {(status.state === 'ready' || started) && (layoutReady ? <main className="app-main">
      <div className="module-view" id="storage-panel" role={module === 'Storage' && activeTab?.kind === 'document' ? 'tabpanel' : undefined} aria-labelledby={module === 'Storage' && activeTab?.kind === 'document' ? `tab-${activeTab.key}` : undefined} hidden={module !== 'Storage'}><Storage activeDocumentId={storageDocumentId} onOpenDocument={document => openTab(documentTab(document.id, document.title || document.original_name))} onShowLibrary={showLibrary} onTitles={updateDocumentTitles} /></div>
      <div className="module-view" id="garden-panel" role={module === 'Garden' && activeTab?.kind === 'topic' ? 'tabpanel' : undefined} aria-labelledby={module === 'Garden' && activeTab?.kind === 'topic' ? `tab-${activeTab.key}` : undefined} hidden={module !== 'Garden'}><Garden activeTopicId={gardenTopicId} onOpenTopic={topic => openTab(topicTab(topic.id, topic.title))} onTitles={updateTopicTitles} /></div>
      <div className="module-view house-view" hidden={module !== 'House'}><House active={module === 'House'} /></div>
    </main> : <p className="app-status" role="status">正在恢复工作标签…</p>)}
    {closePrompt && <div className="close-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) answerClose('cancel') }}>
      <div ref={closeDialog} className="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title" onKeyDown={onDialogKeyDown}>
        <h2 id="close-dialog-title">“{closePrompt.title}”有未保存内容</h2>
        <p>保存后关闭；保存失败会保持标签打开。AI 草稿编辑会保留在本次会话。</p>
        <div className="actions"><button className="primary" onClick={() => answerClose('save')}>保存并关闭</button><button onClick={() => answerClose('discard')}>放弃并关闭</button><button onClick={() => answerClose('cancel')}>取消</button></div>
      </div>
    </div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
