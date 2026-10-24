import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, AppStatus } from '../shared/status'
import './style.css'
import { Garden } from './Garden'
import { hasUnsavedGarden } from './garden-book'
import { House } from './House'
import { Storage } from './Storage'
import { hasUnsavedNotes } from './notebook'
declare global { interface Window { yorw: DesktopBridge } }
function App() {
  const [started, setStarted] = useState(false)
  const [reading, setReading] = useState(false)
  const [page, setPage] = useState('Storage')
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
  return <><header><strong>知栖 <span>Yorw</span></strong><nav aria-label="工作区">{['Storage', 'Garden', 'House'].map(name => <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => setPage(name)}>{name}</button>)}</nav></header><main className={reading && page === 'Storage' ? 'reader-active' : page === 'Garden' ? 'garden-active' : ''}><p className="eyebrow">YOUR OWN RESEARCH WORKPLACE</p><h1>{page}</h1><p className="page-intro">{page === 'Storage' ? '积累材料，让每一次阅读有所沉淀。' : page === 'Garden' ? '培育理解，让知识逐渐生长。' : '安放属于自己的研究工作区。'}</p>{status.state !== 'ready' && <p role="status" className={status.state}>{status.message}</p>}{(status.state === 'ready' || started) && <><div hidden={page !== 'Garden'}><Garden /></div><div hidden={page !== 'House'}><House /></div><div hidden={page !== 'Storage'}><Storage onReading={setReading} /></div></>}</main></>
}
createRoot(document.getElementById('root')!).render(<App />)
