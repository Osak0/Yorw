import React, {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import type {DocumentRecord} from '../shared/status'
import './library-directory.css'
export interface Folder {id:string;parent_id:string|null;name:string;version:number}
export function folderScope(folders:Folder[],selected:string):Set<string>{const ids=new Set([selected]);let changed=true;while(changed){changed=false;for(const f of folders)if(f.parent_id&&ids.has(f.parent_id)&&!ids.has(f.id)){ids.add(f.id);changed=true}}return ids}

export function folderPath(folders:Folder[], selected:string):Folder[] {
  const path:Folder[] = [], seen=new Set<string>()
  let current=folders.find(f=>f.id===selected)
  while(current && !seen.has(current.id)) {
    seen.add(current.id); path.unshift(current)
    current=folders.find(f=>f.id===current!.parent_id)
  }
  return path
}
export function directDocuments(documents:DocumentRecord[], selected:string) {
  return documents.filter(d=>(d.folder_id||'root')===selected)
}
type MenuTarget={document?:DocumentRecord;folder?:Folder;x:number;y:number}
type Edit={kind:'create'|'edit'|'assign';folder?:Folder;document?:DocumentRecord}
type Props={documents:DocumentRecord[];folders:Folder[];selected:string;busy?:boolean;onSelect:(id:string)=>void;onChange:()=>void;onOpen:(d:DocumentRecord)=>void;onMetadata:(d:DocumentRecord)=>void;onEdit:(d:DocumentRecord)=>void;onRemove:(d:DocumentRecord)=>void;onImport:()=>void}
export function LibraryDirectory({documents,folders,selected,busy:importing,onSelect,onChange,onOpen,onMetadata,onEdit,onRemove,onImport}:Props) {
  const [menu,setMenu]=useState<MenuTarget|null>(null), [edit,setEdit]=useState<Edit|null>(null)
  const [name,setName]=useState(''), [parent,setParent]=useState(''), [notice,setNotice]=useState(''), [busy,setBusy]=useState(false)
  const menuRef=useRef<HTMLDivElement>(null), dialogRef=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLElement|null>(null)
  useEffect(()=>{setNotice('');setMenu(null)},[selected])
  const current=folders.find(f=>f.id===selected), path=folderPath(folders,selected)
  const children=folders.filter(f=>(f.parent_id||'root')===selected)
  function dismiss(){setMenu(null);trigger.current?.focus()}
  function show(event:React.MouseEvent|React.KeyboardEvent,target:Partial<MenuTarget>={}) {
    event.preventDefault();event.stopPropagation();trigger.current=event.currentTarget as HTMLElement
    const rect=event.currentTarget.getBoundingClientRect()
    setMenu({...target,x:'clientX' in event?event.clientX:rect.left+16,y:'clientY' in event?event.clientY:rect.bottom})
  }
  function keyMenu(event:React.KeyboardEvent,target:Partial<MenuTarget>) {
    if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')show(event,target)
  }
  useLayoutEffect(()=>{
    if(!menu||!menuRef.current)return
    const el=menuRef.current, rect=el.getBoundingClientRect()
    el.style.left=Math.max(8,Math.min(menu.x,window.innerWidth-rect.width-8))+'px'
    el.style.top=Math.max(8,Math.min(menu.y,window.innerHeight-rect.height-8))+'px'
    el.querySelector<HTMLButtonElement>('button')?.focus()
    const outside=(e:PointerEvent)=>{if(!el.contains(e.target as Node))dismiss()}
    const close=()=>dismiss()
    window.addEventListener('pointerdown',outside);window.addEventListener('resize',close)
    window.addEventListener('blur',close)
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);window.removeEventListener('blur',close)}
  },[menu])
  useEffect(()=>{if(edit){dialogRef.current?.showModal();dialogRef.current?.querySelector<HTMLElement>('input,select')?.focus()}},[edit])
  async function request(input:unknown) {
    setBusy(true)
    try {
      const result=await window.yorw.documents.library(input)
      if(!result.ok){setNotice(({FOLDER_NAME_EXISTS:'同级文件夹重名，请修改名称或移动目标。',FOLDER_CYCLE:'不能移入自身或子文件夹。',FOLDER_CONFLICT:'目录已更新，请重新打开操作。',DOCUMENT_CONFLICT:'文献已更新，请重试。',INVALID_FOLDER_NAME:'文件夹名称无效。'} as Record<string,string>)[result.code]||'操作失败，请重试。');return false}
      setNotice('');onChange();return true
    }catch{setNotice('操作失败，请重试。');return false}finally{setBusy(false)}
  }
  function begin(value:Edit) {
    dismiss();setNotice('');setName(value.kind==='edit'?value.folder?.name||'':'')
    setParent(value.kind==='create'?(value.folder?.id||current?.id||''):value.kind==='assign'?(value.document?.folder_id||''):(value.folder?.parent_id||''))
    setEdit(value)
  }
  async function save() {
    if(!edit)return
    const f=edit.folder
    const ok=await request(edit.kind==='assign'?{action:'assign',value:{folder_id:parent||null,documents:{[edit.document!.id]:edit.document!.version}}}:{action:edit.kind==='edit'?'update':'create',id:edit.kind==='edit'?f?.id:undefined,value:{name,parent_id:parent||null,version:edit.kind==='edit'?f?.version:0}})
    if(ok){setEdit(null);trigger.current?.focus()}
  }
  async function system(action:string,d:DocumentRecord) {
    dismiss()
    try{const r=await window.yorw.documents.library({action,id:d.id});setNotice(r.ok?(r.value.path||'操作完成。'):'原件不可用或系统操作失败，请重试。')}catch{setNotice('系统操作失败，请重试。')}
  }
  const item=(label:string,action:()=>void,danger=false)=><button role="menuitem" className={danger?'danger':''} onClick={()=>{dismiss();action()}}>{label}</button>
  return <div className="directory-browser" onContextMenu={e=>show(e)}>
    <div className="directory-toolbar"><button disabled={importing} onClick={onImport}>导入文献</button><button onClick={()=>begin({kind:'create'})}>新建文件夹</button></div>
    <div className="directory-location"><button aria-label="返回上一级" disabled={!current} onClick={()=>onSelect(current?.parent_id||'root')}>↑</button><span title={['文献',...path.map(f=>f.name)].join(' / ')}>{path.length?path.map(f=>f.name).join(' / '):'根目录'}</span></div>
    <div className="directory-entries" aria-label="当前目录内容">
      {children.map(f=><button className="directory-entry directory-folder" key={f.id} title={f.name} onClick={()=>onSelect(f.id)} onContextMenu={e=>show(e,{folder:f})} onKeyDown={e=>keyMenu(e,{folder:f})}><span aria-hidden="true">▸</span><span>{f.name}</span></button>)}
      {documents.map(d=><button className="directory-entry directory-file" key={d.id} title={d.original_name} onClick={()=>onOpen(d)} onContextMenu={e=>show(e,{document:d})} onKeyDown={e=>keyMenu(e,{document:d})}>{d.original_name}</button>)}
      {!children.length&&!documents.length&&<p className="directory-empty">此文件夹为空</p>}
    </div>
    {notice&&<p role="status" className="directory-notice">{notice}</p>}
    {menu&&createPortal(<div ref={menuRef} role="menu" aria-label="目录操作" className="directory-menu" style={{left:menu.x,top:menu.y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
      if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();dismiss()}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()
      }
    }}>
      {menu.document?<>
        {item('打开阅读',()=>onOpen(menu.document!))}{item('查看文献资料',()=>onMetadata(menu.document!))}
        <hr/>{item('编辑标题',()=>onEdit(menu.document!))}{item('移动到…',()=>begin({kind:'assign',document:menu.document}))}
        <hr/>{item('查看原件存储位置',()=>void system('path',menu.document!))}{item('复制绝对路径',()=>void system('copy',menu.document!))}
        {item('使用默认应用打开',()=>void system('open',menu.document!))}{item('在资源管理器中显示',()=>void system('reveal',menu.document!))}
        <hr/>{item('从文献库移除',()=>onRemove(menu.document!),true)}
      </>:menu.folder?<>
        {item('进入文件夹',()=>onSelect(menu.folder!.id))}{item('新建子文件夹',()=>begin({kind:'create',folder:menu.folder}))}
        <hr/>{item('重命名 / 移动到…',()=>begin({kind:'edit',folder:menu.folder}))}
        <hr/>{item('删除文件夹',()=>{if(window.confirm('删除此文件夹？子目录和文献会移至上一级，文献不会被删除。'))void request({action:'remove',id:menu.folder!.id,version:menu.folder!.version})},true)}
      </>:<>{item('导入文献',onImport)}{item('新建文件夹',()=>begin({kind:'create'}))}</>}
    </div>,document.body)}
    {edit&&<dialog ref={dialogRef} className="directory-edit" aria-label={edit.kind==='assign'?'移动文献':'编辑文件夹'} onCancel={e=>{e.preventDefault();if(!busy){setEdit(null);trigger.current?.focus()}}}>
      <form onSubmit={e=>{e.preventDefault();void save()}}><h3>{edit.kind==='assign'?'移动文献':edit.kind==='create'?'新建文件夹':'编辑文件夹'}</h3>
      {edit.kind!=='assign'&&<label>名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} required/></label>}
      <label>目标文件夹<select value={parent} onChange={e=>setParent(e.target.value)}><option value="">根目录</option>{folders.filter(f=>edit.kind!=='edit'||!folderScope(folders,edit.folder!.id).has(f.id)).map(f=><option key={f.id} value={f.id}>{folderPath(folders,f.id).map(n=>n.name).join(' / ')}</option>)}</select></label>
      {notice&&<p role="status">{notice}</p>}<div className="directory-edit-actions"><button type="button" disabled={busy} onClick={()=>{setEdit(null);trigger.current?.focus()}}>取消</button><button type="submit" disabled={busy}>{busy?'正在保存…':'保存'}</button></div></form>
    </dialog>}
  </div>
}
