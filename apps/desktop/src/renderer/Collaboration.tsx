import React, {useEffect, useState} from 'react'
import type {CollaborationProposal, RelationCandidate} from '../shared/status'
import {openProposal, PROPOSAL_CHANGED} from './proposal-launch'
import {proposalExplain, proposalStatus, proposalTitle} from './proposal-model'
import {ProposalResultLinks} from './ProposalDetail'

export {selectProposalOperation} from './proposal-model'

/** Compact answer-card entry. Full inspection and adoption live in the proposal tab. */
export function ProposalCard({initial}: {initial: CollaborationProposal; onChanged?: () => void}) {
  const [item, setItem] = useState(initial)
  useEffect(() => {
    let live = true
    const refresh = () => {
      void window.yorw.collaboration.get(initial.id).then(result => {
        if (!live || !result.ok) return
        setItem(result.value)
      })
    }
    window.addEventListener(PROPOSAL_CHANGED, refresh)
    window.addEventListener('formal-materials-changed', refresh)
    refresh()
    return () => {
      live = false
      window.removeEventListener(PROPOSAL_CHANGED, refresh)
      window.removeEventListener('formal-materials-changed', refresh)
    }
  }, [initial.id])
  const status = item.stale ? '需要重新预览' : proposalStatus[item.status] ?? item.status
  return <section className="proposal-summary" aria-label="资料修改方案">
    <div className="proposal-summary-copy">
      <strong>{proposalTitle(item)}</strong>
      <small>共 {item.operations.length} 项操作</small>
    </div>
    <span className={`proposal-state ${item.status}${item.stale ? ' stale' : ''}`}>{status}</span>
    {item.status === 'accepted' && <ProposalResultLinks item={item} limit={3} />}
    <button className="proposal-summary-open" onClick={() => openProposal(item.id, proposalTitle(item))}>查看方案</button>
  </section>
}

export function ProposalList({taskId, documentId, topicId,refreshKey,proposalIds=[]}: {taskId?: string; documentId?: string; topicId?: string;refreshKey?:string;proposalIds?:string[]}) {
  const [items,setItems]=useState<CollaborationProposal[]>([]),[notice,setNotice]=useState('')
  useEffect(()=>{
    let live=true,sequence=0
    const refresh=async()=>{
      const current=++sequence
      try{
        const listed=await window.yorw.collaboration.list({task_id:taskId,document_id:documentId,topic_id:topicId})
        const related=await Promise.all(proposalIds.map(id=>window.yorw.collaboration.get(id)))
        if(!live||current!==sequence)return
        const merged=new Map<string,CollaborationProposal>()
        if(listed.ok)for(const item of listed.value.items)merged.set(item.id,item)
        for(const result of related)if(result.ok)merged.set(result.value.id,result.value)
        setItems([...merged.values()]);setNotice(listed.ok?'':'方案暂时无法载入，请重新打开会话。')
      }catch{if(live&&current===sequence)setNotice('方案载入连接中断，请重新打开会话。')}
    }
    const update=()=>void refresh();update()
    window.addEventListener(PROPOSAL_CHANGED,update);window.addEventListener('formal-materials-changed',update)
    return()=>{live=false;window.removeEventListener(PROPOSAL_CHANGED,update);window.removeEventListener('formal-materials-changed',update)}
  },[taskId,documentId,topicId,refreshKey,proposalIds.join('|')])
  return <>{notice&&<p role="status">{notice}</p>}{items.map(item=><ProposalCard key={item.id} initial={item}/>)}</>
}

export function TopicRelations({topicId, onOpen}: {topicId: string; onOpen: (id: string) => void}) {
  const [items, setItems] = useState<{id: string; title: string; description: string}[]>([]), [candidates, setCandidates] = useState<RelationCandidate[]>([]), [query, setQuery] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState<CollaborationProposal | null>(null), [busy, setBusy] = useState(false)
  async function load() {
    const result = await window.yorw.collaboration.topics(topicId)
    if (result.ok) setItems(result.value.items)
  }
  useEffect(() => {
    void load()
    const refresh = () => void load()
    window.addEventListener('formal-materials-changed', refresh)
    window.addEventListener(PROPOSAL_CHANGED, refresh)
    return () => { window.removeEventListener('formal-materials-changed', refresh); window.removeEventListener(PROPOSAL_CHANGED, refresh) }
  }, [topicId])
  async function propose(other: string, action: 'link' | 'unlink', reason: string) {
    setBusy(true)
    try {
      const result = await window.yorw.collaboration.preview({request_id: crypto.randomUUID(), topic_id: topicId, operations: [{key: 'relation', action, first_kind: 'topic', first: topicId, second_kind: 'topic', second: other, reason}]})
      if (result.ok) setPreview(result.value)
      else setNotice(proposalExplain(result.code))
    } finally { setBusy(false) }
  }
  return <section aria-label="专题普通关联"><h3>专题关联 · {items.length}</h3><p>普通关联独立于父子目录，也不改变笔记与 AI 范围。</p><ul className="topic-overview-list">{items.map(item => <li key={item.id}><button onClick={() => onOpen(item.id)}>{item.title}</button><p>{item.description}</p><button disabled={busy} onClick={() => void propose(item.id, 'unlink', '用户解除专题普通关联')}>预览解除关联</button></li>)}</ul><input aria-label="专题关联检索" value={query} maxLength={200} placeholder="输入相关内容词" onChange={event => setQuery(event.target.value)} /><button disabled={busy} onClick={() => { setBusy(true); void window.yorw.collaboration.candidates({kind: 'topic', id: topicId, query}).then(result => { if (result.ok) { const found = result.value.items.filter(candidate => candidate.kind === 'topic'); setCandidates(found); setNotice(found.length ? '选择候选后预览。' : '没有相关专题候选。') } else setNotice(proposalExplain(result.code)) }).finally(() => setBusy(false)) }}>查找关联专题</button>{candidates.map(item => <div key={item.id}><strong>{item.title}</strong><p>{item.reason}</p><button disabled={busy} onClick={() => void propose(item.id, 'link', item.reason)}>预览建立关联</button></div>)}<p role="status">{notice}</p>{preview && <ProposalCard key={preview.id} initial={preview} onChanged={() => void load()} />}<details><summary>此前方案与撤回</summary><ProposalList topicId={topicId} /></details></section>
}

/** Shared entrypoint: a new topic and its document link are one selectable plan. */
export function DocumentCollaboration({documentId, onChanged, suggestedTopics = [], enrichmentId, suggestedLinks, sourceVersion}: {documentId: string; onChanged: () => void; suggestedTopics?: {title: string; reason: string}[]; enrichmentId?: number; sourceVersion: number; suggestedLinks?: {related?: {id: string; title: string; version: number; reason: string}[]; topics?: {id: string; title: string; version: number; reason: string}[]}}) {
  const [query, setQuery] = useState(''), [title, setTitle] = useState(''), [items, setItems] = useState<RelationCandidate[]>([]), [picked, setPicked] = useState(new Set<string>()), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState<CollaborationProposal | null>(null)
  useEffect(() => {
    const candidates: RelationCandidate[] = [...(suggestedLinks?.related ?? []).map(item => ({...item, kind: 'document' as const})), ...(suggestedLinks?.topics ?? []).map(item => ({...item, kind: 'topic' as const}))].map(item => ({...item, excerpt: 'AI 组织建议，采纳前请核对。', source: {kind: 'document', id: documentId, version: sourceVersion}}))
    setItems(candidates); setPicked(new Set())
  }, [documentId, enrichmentId])
  useEffect(() => {
    const refresh = () => onChanged()
    window.addEventListener(PROPOSAL_CHANGED, refresh)
    window.addEventListener('formal-materials-changed', refresh)
    return () => { window.removeEventListener(PROPOSAL_CHANGED, refresh); window.removeEventListener('formal-materials-changed', refresh) }
  }, [onChanged])
  async function search() {
    setBusy(true)
    try {
      const result = await window.yorw.collaboration.candidates({kind: 'document', id: documentId, query})
      if (result.ok) {
        setItems(result.value.items); setPicked(new Set())
        setNotice(result.value.items.length ? '请选择相关资料。' : '没有相关候选，可以调整检索词或新建专题。')
      } else setNotice(proposalExplain(result.code))
    } finally { setBusy(false) }
  }
  async function propose() {
    setBusy(true)
    try {
      const operations: unknown[] = []
      if (title.trim()) {
        operations.push({key: 'new_topic', action: 'create_topic', title: title.trim(), reason: '用户选择的新专题'}, {key: 'new_link', action: 'link', first_kind: 'document', first: documentId, second_kind: 'topic', second: '$new_topic', reason: '将当前文献整理到新专题'})
      }
      items.filter(item => picked.has(item.id)).forEach((item, index) => operations.push({key: 'relation_' + index, action: 'link', first_kind: 'document', first: documentId, second_kind: item.kind, second: item.id, second_version: item.version, first_version: item.source.version, reason: item.reason}))
      const result = await window.yorw.collaboration.preview({request_id: crypto.randomUUID(), document_id: documentId, enrichment_id: enrichmentId, operations})
      if (result.ok) { setPreview(result.value); setNotice('预览已生成，尚未修改正式资料。') }
      else setNotice(proposalExplain(result.code))
    } finally { setBusy(false) }
  }
  return <section className="collaboration-entry"><h3>整理专题与关联资料</h3><p>候选仅为组织建议，选择后先预览；普通关联不改变笔记范围。</p><div><input aria-label="关联候选检索" placeholder="从标题、标签、摘要与正文查找" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><button disabled={busy} onClick={() => void search()}>检索关联候选</button></div>{items.map(item => <label className="collaboration-candidate" key={item.id}><input type="checkbox" checked={picked.has(item.id)} onChange={event => setPicked(old => { const next = new Set(old); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} />{item.kind === 'topic' ? '专题' : '文献'} · {item.title}<small>{item.reason} · v{item.version}</small><small>{item.excerpt}</small></label>)}{suggestedTopics.map((item, index) => <div key={index}><strong>建议新专题：{item.title}</strong><p>{item.reason}</p><button disabled={busy} onClick={() => setTitle(item.title)}>使用此名称并预览关联</button></div>)}<label>新专题名称<input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="可留空" /></label><button disabled={busy || (!title.trim() && !picked.size)} onClick={() => void propose()}>预览所选关联与新专题</button><p role="status">{notice}</p>{preview && <ProposalCard key={preview.id} initial={preview} onChanged={onChanged} />}<details><summary>此前方案与撤回</summary><ProposalList documentId={documentId} /></details></section>
}
