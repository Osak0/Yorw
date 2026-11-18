import {useSuccessExpiry} from './WorkspaceUI'
import React, {useContext, useEffect, useRef, useState} from 'react'
import type {CollaborationProposal, ProposalDecisionRecord, ProposalOperation} from '../shared/status'
import {MarkdownPreview} from './MarkdownPreview'
import {SourceNavigationContext} from './source-navigation'
import {openResearch} from './research-launch'
import {
  notifyProposal, openProposal, openProposalDocument, openProposalNote,
  openProposalReadingNote, openProposalTopic, updateProposalTitle,
} from './proposal-launch'
import {defaultProposalSelection, proposalExplain, proposalLabels, proposalOperationName, proposalStatus, proposalTitle, selectProposalOperation} from './proposal-model'
import './proposal.css'

const conflictReason: Record<string, string> = {
  context_changed: '范围或研究背景已变化', source_unavailable: '来源不可用', object_changed: '对象已被修改',
  folder_changed: '目录成员或名称已变化', folder_unavailable: '目录已删除', relation_changed: '关系已变化',
  operation_changed: '需要重新核对',
}
const decisionActions: Record<string, string> = {accept: '采纳', reject: '拒绝', undo: '撤回', repair: '重新预览'}
const selectionKey = (id: string) => `yorw:proposal-selection:${id}`
const savedSelection = (id: string): {version?: number; selected?: string[]} | null => {
  try {
    const value = JSON.parse(localStorage.getItem(selectionKey(id)) ?? 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}
const storeSelection = (id: string, version: number, selected: string[]) => {
  try { localStorage.setItem(selectionKey(id), JSON.stringify({version, selected})) } catch { /* local draft is optional */ }
}

function operationOwnership(operation: ProposalOperation, item: CollaborationProposal): string {
  if (operation.owner_path) return operation.owner_path
  if (!operation.owner) return '根目录'
  if (operation.owner.startsWith('$')) {
    const prior = item.operations.find(candidate => candidate.key === operation.owner.slice(1))
    return prior ? `同方案新建：${proposalOperationName(prior)}` : operation.owner_title || operation.owner
  }
  return operation.owner_title || operation.owner
}

function RecordNavigation({record}: {record: ProposalDecisionRecord}) {
  const navigation = record.navigation
  if (navigation?.tab === 'topic' && navigation.id) {
    return <button onClick={() => openProposalTopic(navigation.id!, (record.after as {title?: string} | undefined)?.title)}>打开专题</button>
  }
  if (navigation?.tab === 'topic-note' && navigation.id) {
    return <button onClick={() => openProposalNote(navigation.id!)}>打开笔记</button>
  }
  if (navigation?.tab === 'notes' && navigation.id) {
    return <button onClick={() => openProposalReadingNote(navigation.id!, navigation.note_id ?? '')}>打开阅读笔记</button>
  }
  if (record.kind === 'relation') {
    return <>
      {record.first_navigation?.id && (record.first_navigation.tab === 'topic'
        ? <button onClick={() => openProposalTopic(record.first_navigation!.id!)}>打开专题</button>
        : <button onClick={() => openProposalDocument(record.first_navigation!.id!)}>打开文献</button>)}
      {record.second_navigation?.id && (record.second_navigation.tab === 'topic'
        ? <button onClick={() => openProposalTopic(record.second_navigation!.id!)}>打开专题</button>
        : <button onClick={() => openProposalDocument(record.second_navigation!.id!)}>打开文献</button>)}
    </>
  }
  return null
}

function recordLabel(record: ProposalDecisionRecord, item: CollaborationProposal): string {
  const resolve = (reference?: string) => reference?.startsWith('$')
    ? item.operations.find(candidate => candidate.key === reference.slice(1))?.object_id : reference
  if (record.kind === 'relation') {
    const operation = item.operations.find(candidate =>
      (candidate.first === record.first || resolve(candidate.first) === record.first) &&
      (candidate.second === record.second || resolve(candidate.second) === record.second))
    return operation ? `建立关系：${proposalOperationName(operation)}` : '建立关系'
  }
  const operation = item.operations.find(candidate =>
    candidate.pending_object_id === record.id || candidate.object_id === record.id || candidate.target === record.id)
  return operation ? proposalOperationName(operation) : record.kind === 'note' ? '笔记修改' : '专题成果'
}

/** Compact result entry shared by answer cards and the detail page. */
export function ProposalResultLinks({item, limit = 4}: {item: CollaborationProposal; limit?: number}) {
  const records = item.decision?.records ?? []
  if (!records.length) return null
  return <div className="proposal-result-links">
    {records.slice(0, limit).map((record, index) => <span key={`${record.kind}-${record.id ?? index}`}>
      <span>{recordLabel(record, item)}</span>
      <RecordNavigation record={record} />
    </span>)}
  </div>
}

function ObjectLink({operation, side}: {operation: ProposalOperation; side: 'first' | 'second'}) {
  const reference = side === 'first' ? operation.first : operation.second
  const kind = side === 'first' ? operation.first_kind : operation.second_kind
  const title = (side === 'first' ? operation.first_title : operation.second_title) || reference
  if (!reference || reference.startsWith('$')) return <span>{title || '同方案新建对象'}</span>
  if (kind === 'document') return <button className="proposal-object-link" onClick={() => openProposalDocument(reference)}>{title}</button>
  if (kind === 'topic') return <button className="proposal-object-link" onClick={() => openProposalTopic(reference, title)}>{title}</button>
  return <span>{title}</span>
}

export function ProposalDetail({id, active}: {id: string; active: boolean}) {
  const navigate = useContext(SourceNavigationContext)
  const [item, setItem] = useState<CollaborationProposal | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useSuccessExpiry(notice,()=>setNotice(''),['所选操作已整组采纳。','已撤回，修订和决定记录保留。','已拒绝，正式资料未修改。','已同时选择全部前置操作。','已同时取消依赖该项的操作；独立项仍可选择。'].includes(notice))
  const [missing, setMissing] = useState(false)
  const [conflictCode, setConflictCode] = useState('')
  const retry = useRef<{action: string; key: string; version: number; selected: string[]} | null>(null)

  function reconcile(value: CollaborationProposal) {
    if (value.status !== 'pending') { setSelected(value.decision?.selected ?? []); return }
    const keys = new Set(value.operations.map(operation => operation.key))
    const saved = savedSelection(id)
    if (saved && Array.isArray(saved.selected)) {
      const restored = saved.selected.filter(key => keys.has(key))
      setSelected(restored.reduce((selection, key) => selectProposalOperation(value.operations, selection, key, true), [] as string[]))
    } else setSelected(defaultProposalSelection(value.operations))
  }

  async function load() {
    const result = await window.yorw.collaboration.get(id)
    if (!result.ok) {
      if (result.code === 'PROPOSAL_NOT_FOUND') { setMissing(true); setItem(null) }
      setNotice(proposalExplain(result.code)); return
    }
    setMissing(false); setItem(result.value); reconcile(result.value)
    updateProposalTitle(id, proposalTitle(result.value))
  }

  useEffect(() => {
    if (!active) return
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 60) }
    window.addEventListener('proposal-changed', refresh)
    window.addEventListener('formal-materials-changed', refresh)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('proposal-changed', refresh)
      window.removeEventListener('formal-materials-changed', refresh)
    }
  }, [id, active])

  useEffect(() => {
    if (!item || item.status !== 'pending') return
    storeSelection(id, item.version, selected)
  }, [id, item?.version, item?.status, selected])

  function toggle(key: string, checked: boolean) {
    if (!item) return
    retry.current = null
    setSelected(selectProposalOperation(item.operations, selected, key, checked))
    setNotice(checked ? '已同时选择全部前置操作。' : '已同时取消依赖该项的操作；独立项仍可选择。')
  }

  function requestRepair() {
    if (!item) return
    openResearch(`请核对当前资料，为无法撤回的方案 ${item.id} 提出修复建议，不覆盖后续编辑。原操作：${item.operations.map(operation => `${proposalLabels[operation.action] ?? operation.action} ${proposalOperationName(operation)}`).join('；')}`, {mode: 'workspace', topic_id: null})
  }

  async function act(action: 'accept' | 'reject' | 'undo' | 'repair') {
    if (!item || busy) return
    if (action === 'undo' && !window.confirm('撤回本方案全部已采纳操作？若存在后续编辑或新增引用，整组撤回会停止。')) return
    setBusy(true); setNotice(''); setConflictCode('')
    const request = retry.current?.action === action ? retry.current : {action, key: crypto.randomUUID(), version: item.version, selected: [...selected]}
    retry.current = request
    try {
      const result = await window.yorw.collaboration.decide({id: item.id, action, version: request.version, request_id: request.key, selected: request.selected})
      if (!result.ok) {
        setNotice(proposalExplain(result.code))
        if (result.code === 'UNDO_CONFLICT' || result.code === 'UNDO_DEPENDENCY') setConflictCode(result.code)
        if (['PROPOSAL_STALE', 'PROPOSAL_CONFLICT', 'MATERIAL_CHANGED', 'SOURCE_UNAVAILABLE'].includes(result.code)) await load()
        return
      }
      retry.current = null
      if (action === 'repair') {
        const next = result.value
        updateProposalTitle(next.id, proposalTitle(next))
        openProposal(next.id, proposalTitle(next))
        setNotice('已按当前资料生成新的预览；旧方案与决定保留。')
        notifyProposal(item.id)
        window.dispatchEvent(new Event('formal-materials-changed'))
        return
      }
      setItem(result.value)
      setSelected(result.value.status === 'pending' ? result.value.operations.map(operation => operation.key) : result.value.decision?.selected ?? [])
      setNotice(action === 'accept' ? '所选操作已整组采纳。' : action === 'undo' ? '已撤回，修订和决定记录保留。' : '已拒绝，正式资料未修改。')
      notifyProposal(result.value.id)
      window.dispatchEvent(new Event('formal-materials-changed'))
    } catch {
      setNotice('连接中断，重试会复用请求，避免重复创建。')
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return <section className="proposal-dossier proposal-missing" aria-label="修改方案不可用">
      <h1>方案不可用</h1>
      <p>{notice || '该方案已被删除，或不属于当前工作区。'}</p>
    </section>
  }
  if (!item) return <section className="proposal-dossier"><p role="status">{notice || '正在载入方案…'}</p>{notice && <button onClick={() => void load()}>重试</button>}</section>

  const pending = item.status === 'pending'
  const chosen = new Set(selected)
  const accepted = new Set(item.decision?.selected ?? [])
  const status = proposalStatus[item.status] ?? item.status
  const heading = proposalTitle(item)

  return <section className="proposal-dossier" aria-label="资料修改方案详情">
    <header className="proposal-head">
      <div>
        <p className="proposal-kicker">资料修改方案</p>
        <h1>{heading}</h1>
        <p className="proposal-meta">{pending ? `共 ${item.operations.length} 项操作，已选 ${selected.length} 项` : `共 ${item.operations.length} 项操作，采纳 ${accepted.size} 项`}</p>
      </div>
      <span className={`proposal-state ${item.status}${item.stale ? ' stale' : ''}`}>{item.stale ? '需要重新预览' : status}</span>
    </header>

    {item.stale && <section className="proposal-conflict" role="status">
      <h2>资料已有变化</h2>
      <p>{proposalExplain(item.conflict ?? 'PROPOSAL_STALE')}</p>
      {(() => {
        const affected = item.conflict_objects?.length ? item.conflict_objects : item.operations.map(operation => ({kind: 'operation', id: operation.key, title: proposalOperationName(operation), reason: 'operation_changed'}))
        return <><p>受影响的对象：</p><ul className="proposal-conflict-objects">{affected.map(object => <li key={`${object.kind}-${object.id}`}><span>{object.title || object.id}</span><small>{conflictReason[object.reason ?? ''] ?? '需要重新核对'}</small></li>)}</ul></>
      })()}
      <p>你的选择已保留；重新预览会生成新方案，旧决定仍可查阅。</p>
      <div className="proposal-actions">
        <button className="primary" disabled={busy} onClick={() => void act('repair')}>按当前资料重新预览</button>
        <button disabled={busy} onClick={requestRepair}>在研究助理中讨论</button>
      </div>
    </section>}

    <div className="proposal-body">
      <section className="proposal-ops" aria-label="操作摘要">
        {item.operations.map((operation, index) => {
          const isChosen = chosen.has(operation.key)
          const isAccepted = accepted.has(operation.key)
          const state = pending ? (isChosen ? '将执行' : '未选择') : (isAccepted ? '已采纳' : '未采纳')
          const offset = operation.source_offset || 0
          const sources = item.sources.map((source, index) => ({source, citation: `S${index + 1 + offset}`})).filter(entry => !operation.source_citations?.length || operation.source_citations.includes(entry.citation))
          const relation = operation.action === 'link' || operation.action === 'unlink'
          return <article key={operation.key} data-operation-key={operation.key} className={`proposal-op${isChosen ? ' selected' : ''}${!pending && !isAccepted ? ' skipped' : ''}`}>
            <div className="proposal-op-seq" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
            <div className="proposal-op-main">
              <label className="proposal-op-choice">
                {pending && <input type="checkbox" checked={isChosen} disabled={busy || item.stale} onChange={event => toggle(operation.key, event.target.checked)} />}
                <span className="proposal-op-action">{proposalLabels[operation.action] ?? operation.action}</span>
                <strong>{proposalOperationName(operation)}</strong>
              </label>
              <p className="proposal-op-reason">{operation.reason}</p>
              {relation && <div className="proposal-op-relation">
                <ObjectLink operation={operation} side="first" />
                <span className="proposal-op-relation-word">{operation.action === 'unlink' ? '解除与' : '与'}</span>
                <ObjectLink operation={operation} side="second" />
              </div>}
              {!relation && (operation.action === 'create_topic' || operation.action === 'create_note') && <p className="proposal-op-owner">归属：{operation.owner && !operation.owner.startsWith('$')
                ? <button className="proposal-object-link" onClick={() => openProposalTopic(operation.owner, operation.owner_path || operation.owner_title || operation.owner)}>{operationOwnership(operation, item)}</button>
                : operationOwnership(operation, item)}</p>}
              {operation.target_path && <p className="proposal-op-owner">笔记归属：{operation.target_path}
                {operation.target && operation.target_kind === 'topic_note' && <button className="proposal-object-link" onClick={() => openProposalNote(operation.target)}>打开原笔记</button>}
                {operation.target && operation.target_kind === 'reading_note' && operation.target_document_id && <button className="proposal-object-link" onClick={() => openProposalReadingNote(operation.target_document_id!, operation.target)}>打开阅读笔记</button>}
              </p>}
              {operation.body_md && <details className="proposal-diff">
                <summary>查看正文与差异</summary>
                <MarkdownPreview body={operation.after_body || operation.body_md} />
                <pre>{operation.diff || '正文无变化'}</pre>
              </details>}
              {sources.length > 0 && <details className="proposal-evidence">
                <summary>本次依据（{sources.length}）</summary>
                {sources.map(({source, citation}) => <div key={citation} className="proposal-source">
                  <strong>[{citation}] {source.title}</strong>
                  <small>{source.kind === 'document' ? '原文片段' : '笔记记录／历史认识，非论文事实'}</small>
                  <p>{source.text}</p>
                  {source.kind === 'document' && source.document_id && <button disabled={item.stale} onClick={() => navigate(source.document_id!, {page: source.page, block_id: source.block_id, evidence: source.text})}>查看原文依据</button>}
                </div>)}
              </details>}
            </div>
            <aside className="proposal-op-margin">
              <span className={`proposal-op-state${isAccepted ? ' accepted' : ''}`}>{state}</span>
              {operation.depends_on.length > 0 && <span>依赖：{operation.depends_on.map(key => item.operations.find(candidate => candidate.key === key)?.title || key).join('、')}</span>}
              {relation && operation.first_path && <span>{operation.first_kind === 'document' ? '文献' : '专题'}：{operation.first_path}</span>}
              {relation && operation.second_path && <span>{operation.second_kind === 'document' ? '文献' : '专题'}：{operation.second_path}</span>}
              {pending && operation.pending_object_id && <span>采纳后创建</span>}
            </aside>
          </article>
        })}
      </section>

      {item.decision?.records?.length ? <section className="proposal-results" aria-label="采纳结果">
        <h2>采纳结果</h2>
        <ul>{item.decision.records.map((record, index) => <li key={`${record.kind}-${record.id ?? index}`}>
          <span>{recordLabel(record, item)}</span>
          {item.status !== 'undone' && <RecordNavigation record={record} />}
        </li>)}</ul>
        {item.decision.skipped_dependencies?.length ? <p>未采纳：{item.decision.skipped_dependencies.map(key => {
          const operation = item.operations.find(candidate => candidate.key === key)
          return operation ? proposalOperationName(operation) : key
        }).join('、')}</p> : null}
        {item.status === 'undone' && <p>已撤回，成果不再可用。</p>}
      </section> : null}

      {item.dependencies?.length ? <details className="proposal-dependencies">
        <summary>目录依赖（{item.dependencies.length}）</summary>
        {item.dependencies.map(dependency => <p key={dependency.folder_id}>{dependency.path}：{dependency.member_count} 份材料，版本 {dependency.version}</p>)}
      </details> : null}

      {item.decisions?.length ? <details className="proposal-history">
        <summary>历史决定（{item.decisions.length}）</summary>
        <ol>{item.decisions.map((decision, index) => <li key={`${decision.request_id}-${index}`}>
          <span>{decisionActions[decision.action] ?? decision.action}</span>
          <small>{proposalStatus[decision.status ?? ''] ?? decision.status ?? ''} · 请求 {decision.selected.length} 项 · {new Date(decision.created_at).toLocaleString()}</small>
        </li>)}</ol>
      </details> : null}

      {item.sources.length > 0 && !item.operations.some(operation => operation.body_md) && <details className="proposal-evidence">
        <summary>本方案来源（{item.sources.length}）</summary>
        {item.sources.map(source => <div key={source.citation} className="proposal-source">
          <strong>[{source.citation}] {source.title}</strong>
          <small>{source.kind === 'document' ? '原文片段' : '笔记记录／历史认识，非论文事实'}</small>
          <p>{source.text}</p>
          {source.kind === 'document' && source.document_id && <button disabled={item.stale} onClick={() => navigate(source.document_id!, {page: source.page, block_id: source.block_id, evidence: source.text})}>查看原文依据</button>}
        </div>)}
      </details>}
    </div>

    <footer className="proposal-rail">
      <div className="proposal-rail-count"><strong>{pending ? selected.length : accepted.size}</strong> / {item.operations.length} 项{pending ? '已选' : '已采纳'}</div>
      <div className="proposal-rail-actions">
        {pending && <>
          <button className="primary" disabled={busy || item.stale || !selected.length} onClick={() => void act('accept')}>采纳所选</button>
          <button disabled={busy} onClick={() => void act('reject')}>拒绝方案</button>
        </>}
        {item.status === 'accepted' && <button disabled={busy} onClick={() => void act('undo')}>撤回本次采纳</button>}
      </div>
    </footer>
    <p className="proposal-notice" role="status">{notice}</p>
    {conflictCode && <section className="proposal-conflict" role="status">
      <h2>撤回冲突</h2>
      <p>以下成果已有后续修改或新增引用，整组撤回已停止，修改已保留。</p>
      <ul className="proposal-conflict-objects">{(item.decision?.records ?? []).map((record, index) => <li key={`${record.kind}-${record.id ?? index}`}><span>{recordLabel(record, item)}</span><small>需核对</small></li>)}</ul>
      <button onClick={requestRepair}>向研究助理请求修复建议</button>
    </section>}
  </section>
}
