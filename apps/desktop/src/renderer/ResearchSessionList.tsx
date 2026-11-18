import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {ResearchSession} from '../shared/status'

const UNPARTITIONED = ''
const EMPTY_PARTITIONS_KEY = 'yorw-research-empty-partitions'
const MAX_PARTITION = 40

/** Group sessions by user partition; the unfiled group stays last. */
export function groupSessions(sessions: ResearchSession[]) {
  const groups = new Map<string, ResearchSession[]>()
  for (const session of sessions) {
    const key = session.partition || UNPARTITIONED
    const bucket = groups.get(key) ?? []
    bucket.push(session)
    groups.set(key, bucket)
  }
  return [...groups.entries()].sort(orderPartitions)
}

function orderPartitions([left]: [string, ResearchSession[]], [right]: [string, ResearchSession[]]) {
  if (left === right) return 0
  if (!left) return 1
  if (!right) return -1
  return left.localeCompare(right, 'zh-Hans-CN')
}

/** A partition is a folder in the history sidebar; an empty folder is a local preference. */
function readEmptyPartitions(): string[] {
  try {
    if (typeof window === 'undefined') return []
    const raw: unknown = JSON.parse(window.localStorage.getItem(EMPTY_PARTITIONS_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((name): name is string => typeof name === 'string' && !!name.trim() && name.length <= MAX_PARTITION).slice(0, 100)
      : []
  } catch {
    return []
  }
}

function writeEmptyPartitions(names: string[]) {
  try { window.localStorage.setItem(EMPTY_PARTITIONS_KEY, JSON.stringify(names)) } catch { /* preference only */ }
}

type Menu =
  | {kind: 'session'; session: ResearchSession; x: number; y: number}
  | {kind: 'partition'; name: string; x: number; y: number}

type Props = {
  sessions: ResearchSession[]
  selected: string | null
  archived: boolean
  onOpen(session: ResearchSession): void
  onRename(session: ResearchSession, title: string): Promise<boolean>
  onPartition(session: ResearchSession, partition: string): Promise<boolean>
  onRenamePartition(from: string, to: string): Promise<boolean>
  onRemovePartition(name: string): Promise<boolean>
  onArchive(session: ResearchSession): void
  onRemove(session: ResearchSession): void
}

export function ResearchSessionList({sessions,selected,archived,onOpen,onRename,onPartition,onRenamePartition,onRemovePartition,onArchive,onRemove}: Props) {
  const [menu,setMenu]=useState<Menu|null>(null)
  const [renaming,setRenaming]=useState<string|null>(null)
  const [draft,setDraft]=useState('')
  const [moveMenu,setMoveMenu]=useState(false)
  const [newPartition,setNewPartition]=useState('')
  const [collapsed,setCollapsed]=useState<string[]>([])
  const [entered,setEntered]=useState<string|null>(null)
  const [emptyPartitions,setEmptyPartitions]=useState<string[]>(readEmptyPartitions)
  const [creating,setCreating]=useState(false)
  const [createDraft,setCreateDraft]=useState('')
  const [renamingPartition,setRenamingPartition]=useState<string|null>(null)
  const [partitionDraft,setPartitionDraft]=useState('')
  const [notice,setNotice]=useState('')
  const [helpOpen,setHelpOpen]=useState(false)
  const input=useRef<HTMLInputElement|null>(null)
  const createInput=useRef<HTMLInputElement|null>(null)
  const partitionInput=useRef<HTMLInputElement|null>(null)
  const menuRef=useRef<HTMLDivElement|null>(null)
  const createButton=useRef<HTMLButtonElement|null>(null)
  const locationButton=useRef<HTMLButtonElement|null>(null)

  const partitionNames=useMemo(()=>{
    const names=new Set<string>()
    for(const session of sessions) if(session.partition) names.add(session.partition)
    for(const name of emptyPartitions) names.add(name)
    return [...names].sort((left,right)=>left.localeCompare(right,'zh-Hans-CN'))
  },[sessions,emptyPartitions])

  useEffect(()=>{if(renaming)input.current?.focus()},[renaming])
  useEffect(()=>{if(creating)createInput.current?.focus()},[creating])
  useEffect(()=>{if(renamingPartition)partitionInput.current?.focus()},[renamingPartition])
  useEffect(()=>{setMenu(null);setMoveMenu(false)},[selected])

  const visible=sessions
    .filter(session=>archived||!session.archived)
    .filter(session=>!entered||session.partition===entered)
  const groups=useMemo(()=>{
    const base=groupSessions(visible)
    if(entered){
      if(base.length) return base
      return partitionNames.includes(entered)?[[entered,[]] as [string,ResearchSession[]]]:[]
    }
    const seen=new Set(base.map(([name])=>name))
    const extras=partitionNames.filter(name=>!seen.has(name)).map(name=>[name,[]] as [string,ResearchSession[]])
    return [...base,...extras].sort(orderPartitions)
  },[visible,partitionNames,entered])

  function dismiss() {
    setMenu(null);setMoveMenu(false);setNewPartition('')
  }
  function showSessionMenu(session: ResearchSession, x: number, y: number) {
    setMenu({kind:'session',session,x,y});setMoveMenu(false);setNewPartition('');setNotice('')
  }
  function showPartitionMenu(name: string, x: number, y: number) {
    setMenu({kind:'partition',name,x,y});setMoveMenu(false);setNewPartition('');setNotice('')
  }
  function startRename(session: ResearchSession) {
    dismiss();setRenaming(session.id);setDraft(session.title)
  }
  async function saveRename(session: ResearchSession) {
    const title=draft.trim()
    setRenaming(null)
    if(!title||title===session.title)return
    if(!await onRename(session,title))setDraft(session.title)
  }
  async function move(session: ResearchSession, partition: string) {
    dismiss()
    await onPartition(session,partition)
  }
  function isOpen(partition: string) {
    return !collapsed.includes(partition)
  }
  function toggle(partition: string) {
    setCollapsed(names=>names.includes(partition)?names.filter(name=>name!==partition):[...names,partition])
  }
  function enterPartition(name: string) {
    dismiss();setEntered(name)
  }
  function leavePartition() {
    setEntered(null)
  }
  useEffect(()=>{if(entered)locationButton.current?.focus()},[entered])
  useEffect(()=>{
    if(entered&&!partitionNames.includes(entered))setEntered(null)
  },[entered,partitionNames])

  function startCreate() {
    dismiss();setNotice('');setCreateDraft('');setCreating(true)
  }
  function createPartition() {
    const name=createDraft.trim()
    if(!name){setNotice('请输入分区名称。');return}
    if(name.length>MAX_PARTITION){setNotice(`分区名称最多 ${MAX_PARTITION} 个字符。`);return}
    if(partitionNames.includes(name)){setNotice('已有同名分区。');return}
    const next=[...emptyPartitions,name]
    setEmptyPartitions(next);writeEmptyPartitions(next)
    setCreating(false);setCreateDraft('');setNotice('')
    createButton.current?.focus()
  }
  function startRenamePartition(name: string) {
    dismiss();setNotice('');setPartitionDraft(name);setRenamingPartition(name)
  }
  async function saveRenamePartition(from: string) {
    const name=partitionDraft.trim()
    if(!name||name===from){setRenamingPartition(null);return}
    if(name.length>MAX_PARTITION){setNotice(`分区名称最多 ${MAX_PARTITION} 个字符。`);return}
    if(partitionNames.includes(name)){setNotice('已有同名分区。');return}
    const ok=await onRenamePartition(from,name)
    if(!ok)return
    setRenamingPartition(null);setNotice('')
    if(emptyPartitions.includes(from)){
      const next=emptyPartitions.map(item=>item===from?name:item)
      setEmptyPartitions(next);writeEmptyPartitions(next)
    }
    if(entered===from)setEntered(name)
  }
  async function removePartition(name: string) {
    if(!window.confirm(`删除分区“${name}”？其中的会话会移到未分区，不会被删除。`))return
    dismiss()
    const ok=await onRemovePartition(name)
    if(!ok){setNotice('分区未完全删除，请刷新后重试。');return}
    const next=emptyPartitions.filter(item=>item!==name)
    setEmptyPartitions(next);writeEmptyPartitions(next)
    if(entered===name)setEntered(null)
    setNotice('')
  }

  useLayoutEffect(()=>{
    if(!menu||!menuRef.current)return
    const el=menuRef.current,rect=el.getBoundingClientRect()
    el.style.left=Math.max(8,Math.min(menu.x,window.innerWidth-rect.width-8))+'px'
    el.style.top=Math.max(8,Math.min(menu.y,window.innerHeight-rect.height-8))+'px'
    el.querySelector<HTMLButtonElement>('button')?.focus()
    const outside=(event:PointerEvent)=>{if(!el.contains(event.target as Node))dismiss()}
    const close=()=>dismiss()
    window.addEventListener('pointerdown',outside);window.addEventListener('resize',close);window.addEventListener('blur',close)
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);window.removeEventListener('blur',close)}
  },[menu])
  useLayoutEffect(()=>{
    if(!menu||!menuRef.current)return
    const el=menuRef.current,rect=el.getBoundingClientRect()
    el.style.top=Math.max(8,Math.min(Number.parseFloat(el.style.top)||menu.y,window.innerHeight-rect.height-8))+'px'
  },[moveMenu])

  function sessionRow(session: ResearchSession) {
    return <div className={`research-session-row${selected===session.id?' current':''}`} key={session.id}
      onContextMenu={event=>{event.preventDefault();showSessionMenu(session,event.clientX,event.clientY)}}>
      {renaming===session.id
        ? <form className="research-session-rename" onSubmit={event=>{event.preventDefault();void saveRename(session)}}>
            <input ref={input} aria-label="会话名称" value={draft} maxLength={80} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setRenaming(null)}}}/>
          </form>
        : <button className="research-session-open" aria-current={selected===session.id?'page':undefined} onClick={()=>onOpen(session)}>
            <strong>{session.title}</strong>
            <small>{session.archived?'已归档 · ':''}{new Date(session.updated_at).toLocaleString()}</small>
          </button>}
      <button className="research-session-more" aria-label={`管理会话 ${session.title}`} aria-haspopup="menu" aria-expanded={menu?.kind==='session'&&menu.session.id===session.id} onClick={event=>{event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();showSessionMenu(session,rect.right-8,rect.bottom+4)}}>···</button>
    </div>
  }

  function partitionRow(partition: string, items: ResearchSession[]) {
    const open=isOpen(partition)
    const label=partition||'未分区'
    return <div className="research-partition-row">
      <button className="research-partition-toggle" aria-expanded={open}
        aria-label={`${open?'收起':'展开'} ${label}`}
        title={partition?'单击展开，双击进入，右键管理':undefined}
        onClick={()=>toggle(partition)}
        onDoubleClick={partition?()=>enterPartition(partition):undefined}
        onContextMenu={partition?event=>{event.preventDefault();showPartitionMenu(partition,event.clientX,event.clientY)}:undefined}
        onKeyDown={event=>{
          if(event.key==='Enter'){event.preventDefault();if(partition)enterPartition(partition);else toggle(partition)}
          if(event.key==='ArrowRight'){event.preventDefault();setCollapsed(names=>names.filter(name=>name!==partition))}
          if(event.key==='ArrowLeft'){event.preventDefault();setCollapsed(names=>names.includes(partition)?names:[...names,partition])}
          if(partition&&(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){
            event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();showPartitionMenu(partition,rect.right-8,rect.bottom+4)
          }
        }}>
        <span className="research-partition-state" aria-hidden="true">{open?'收起':'展开'}</span>
        <span className="research-partition-name">{label}</span>
        <span className="research-partition-count">{items.length}</span>
      </button>
      {partition&&<button className="research-partition-more" aria-label={`管理分区 ${partition}`} aria-haspopup="menu"
        aria-expanded={menu?.kind==='partition'&&menu.name===partition}
        onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();showPartitionMenu(partition,rect.right-8,rect.bottom+4)}}>···</button>}
    </div>
  }

  function group(partition: string, items: ResearchSession[]) {
    const open=isOpen(partition)
    return <section className="research-session-group" key={partition||'none'} aria-label={partition||'未分区'}>
      {renamingPartition===partition
        ? <form className="research-partition-form" onSubmit={event=>{event.preventDefault();void saveRenamePartition(partition)}}
            onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setRenamingPartition(null);setNotice('')}}}>
            <input ref={partitionInput} aria-label="分区名称" value={partitionDraft} maxLength={MAX_PARTITION} onChange={event=>setPartitionDraft(event.target.value)}/>
            <button type="submit">保存</button>
            <button type="button" onClick={()=>{setRenamingPartition(null);setNotice('')}}>取消</button>
          </form>
        : partitionRow(partition,items)}
      {open&&<div className="research-partition-items">
        {items.length?items.map(sessionRow):<p className="research-partition-empty">此分区还没有会话。在会话的“···”菜单中选择“移动到分区”即可放入。</p>}
      </div>}
    </section>
  }

  return <div className="research-session-manager">
    <div className="research-partition-toolbar">
      <button ref={createButton} className="research-partition-create" onClick={startCreate}>新建分区</button>
      <button type="button" className="research-partition-help-button" aria-expanded={helpOpen} onClick={()=>setHelpOpen(!helpOpen)}>分区说明</button>
    </div>
    {helpOpen&&<div className="research-partition-help-text">
      <p>分区只整理历史会话，不改变助理能读取的资料范围。资料范围在输入框下方的“范围”中选择。</p>
      <p>单击文件夹展开或收起，双击进入分区，右键或“···”重命名、删除。</p>
    </div>}
    {creating&&<form className="research-partition-form" onSubmit={event=>{event.preventDefault();createPartition()}}
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setCreating(false);setCreateDraft('');setNotice('')}}}>
      <input ref={createInput} aria-label="新分区名称" value={createDraft} maxLength={MAX_PARTITION} placeholder="分区名称" onChange={event=>setCreateDraft(event.target.value)}/>
      <button type="submit">创建</button>
      <button type="button" onClick={()=>{setCreating(false);setCreateDraft('');setNotice('')}}>取消</button>
    </form>}
    {notice&&<p className="research-partition-notice" role="status">{notice}</p>}
    {entered&&<div className="research-partition-location">
      <button ref={locationButton} onClick={leavePartition}>全部分区</button>
      <span>/ {entered}</span>
    </div>}
    <div className="research-session-list">
      {!groups.length&&<p className="research-session-empty">{entered?'此分区还没有会话。':archived?'没有会话。':'没有会话，先提出一个研究问题。'}</p>}
      {entered
        ? <div className="research-partition-items is-entered">
            {(groups[0]?.[1]??[]).length
              ? groups[0][1].map(sessionRow)
              : <p className="research-partition-empty">此分区还没有会话。在会话的“···”菜单中选择“移动到分区”即可放入。</p>}
          </div>
        : groups.map(([partition,items])=>group(partition,items))}
    </div>
    {menu&&createPortal(<div ref={menuRef} role="menu" aria-label={menu.kind==='partition'?'分区操作':'会话操作'} className="research-session-menu" style={{left:menu.x,top:menu.y}}
      onContextMenu={event=>event.preventDefault()}
      onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();dismiss()}}}>
      {menu.kind==='partition'?<>
        <button role="menuitem" onClick={()=>{dismiss();enterPartition(menu.name)}}>进入分区</button>
        <button role="menuitem" onClick={()=>startRenamePartition(menu.name)}>重命名分区</button>
        <button role="menuitem" className="danger" onClick={()=>void removePartition(menu.name)}>删除分区</button>
      </>:<>
        <button role="menuitem" onClick={()=>startRename(menu.session)}>重命名</button>
        <button role="menuitem" aria-expanded={moveMenu} onClick={()=>setMoveMenu(!moveMenu)}>移动到分区…</button>
        {moveMenu&&<div className="research-session-partitions">
          <button role="menuitem" aria-pressed={!menu.session.partition} onClick={()=>void move(menu.session,'')}>未分区</button>
          {partitionNames.map(name=><button role="menuitem" aria-pressed={menu.session.partition===name} key={name} onClick={()=>void move(menu.session,name)}>{name}</button>)}
          <form onSubmit={event=>{event.preventDefault();if(newPartition.trim())void move(menu.session,newPartition.trim())}}>
            <input aria-label="新分区名称" value={newPartition} maxLength={MAX_PARTITION} placeholder="新建分区" onChange={event=>setNewPartition(event.target.value)}/>
            <button disabled={!newPartition.trim()}>移动</button>
          </form>
        </div>}
        <button role="menuitem" onClick={()=>{dismiss();onArchive(menu.session)}}>{menu.session.archived?'恢复会话':'归档会话'}</button>
        <button role="menuitem" className="danger" onClick={()=>{dismiss();onRemove(menu.session)}}>删除会话</button>
      </>}
    </div>,document.body)}
  </div>
}
