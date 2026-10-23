import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, AppStatus } from '../shared/status'
import './style.css'
import { House } from './House'
declare global { interface Window { yorw: DesktopBridge } }
function App() {
  const [page, setPage] = useState('Storage')
  const [status, setStatus] = useState<AppStatus>({ state: 'starting', message: '正在连接本地服务' })
  useEffect(() => {
    let active = true
    const update = () => window.yorw.getStatus().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setStatus({ state: 'failed', message: '无法连接桌面服务，请重新打开知栖' }) })
    void update()
    const timer = setInterval(update, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return <><header><strong>知栖 <span>Yorw</span></strong><nav aria-label="工作区">{['Storage', 'Garden', 'House'].map(name => <button key={name} aria-current={page === name ? 'page' : undefined} onClick={() => setPage(name)}>{name}</button>)}</nav></header><main><p className="eyebrow">YOUR OWN RESEARCH WORKPLACE</p><h1>{page}</h1><p>{page === 'Storage' ? '积累材料，让每一次阅读有所沉淀。' : page === 'Garden' ? '培育理解，让知识逐渐生长。' : '安放属于自己的研究工作区。'}</p>{page === 'House' && <p role="status" className={status.state}>{status.message}</p>}{status.state === 'ready' && <div hidden={page !== 'House'}><House /></div>}<section hidden={page === 'House'}><h2>工作区正在构建</h2><p>当前版本已接通桌面与本地服务，文献、笔记和专题功能将分步加入。</p><p role="status" className={status.state}>{status.message}</p></section></main></>
}
createRoot(document.getElementById('root')!).render(<App />)
