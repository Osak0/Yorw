import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, AppStatus } from '../shared/status'
import './style.css'
import { Garden } from './Garden'
import { hasUnsavedGarden } from './garden-book'
import { House } from './House'
import { Storage } from './Storage'
import { hasUnsavedNotes } from './notebook'
import { addWorkspaceTab, documentTab, moduleForTab, tabKindLabel, topicTab, type WorkspaceTab } from './workspace-tabs'
declare global { interface Window { yorw: DesktopBridge } }
type Module = 'Storage' | 'Garden' | 'House'
const MODULES: Module[] = ['Storage', 'Garden', 'House']
function App() {
  const [started, setStarted] = useState(false)
  const [module, setModule] = useState<Module>('Storage')
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  const [gardenKey, setGardenKey] = useState<string | null>(null)
  const [status, setStatus] = useState<AppStatus>({ state: 'starting', message: '正在连接本地服务' })
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
  }
  function showModule(name: Module) {
    setModule(name)
    setActiveKey(null)
    if (name === 'Storage') setStorageKey(null)
    if (name === 'Garden') setGardenKey(null)
  }
  function showLibrary() { setStorageKey(null); setActiveKey(null) }
  const storageDocumentId = storageKey ? tabs.find(tab => tab.key === storageKey)?.id ?? null : null
  const gardenTopicId = gardenKey ? tabs.find(tab => tab.key === gardenKey)?.id ?? null : null
  return <div className="app-shell">
    <header className="app-header"><div className="app-brand"><strong>知栖 <span>Yorw</span></strong></div><nav className="module-nav" aria-label="工作区">{MODULES.map(name => <button key={name} aria-current={module === name ? 'page' : undefined} onClick={() => showModule(name)}>{name}</button>)}</nav></header>
    <div className="workspace-tabbar" role="tablist" aria-label="工作标签">{tabs.length ? tabs.map(tab => <button key={tab.key} type="button" role="tab" aria-selected={activeKey === tab.key} className="workspace-tab" title={`${tabKindLabel(tab)} · ${tab.title}`} onClick={() => activateTab(tab)}><span className="workspace-tab-title">{tab.title}</span><span className="workspace-tab-kind">{tabKindLabel(tab)}</span></button>) : <span className="workspace-tab-empty">打开文献或专题后，在这里切换</span>}</div>
    {status.state !== 'ready' && <p role="status" className={`app-status ${status.state}`}>{status.message}</p>}
    {(status.state === 'ready' || started) && <main className="app-main">
      <div className="module-view" hidden={module !== 'Storage'}><Storage activeDocumentId={storageDocumentId} onOpenDocument={document => openTab(documentTab(document.id, document.title || document.original_name))} onShowLibrary={showLibrary} /></div>
      <div className="module-view" hidden={module !== 'Garden'}><Garden activeTopicId={gardenTopicId} onOpenTopic={topic => openTab(topicTab(topic.id, topic.title))} /></div>
      <div className="module-view house-view" hidden={module !== 'House'}><House active={module === 'House'} /></div>
    </main>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
