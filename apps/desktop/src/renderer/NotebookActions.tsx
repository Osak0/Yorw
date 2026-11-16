import React,{useEffect,useState} from 'react'
import type {NotebookSummary} from '../shared/status'
import {gardenBook} from './garden-book'
export function NotebookActions({id,baseline,onChange}:{id:string;baseline?:string;onChange:(note:NotebookSummary)=>void}){
 const [note,setNote]=useState<NotebookSummary|null>(null),[title,setTitle]=useState(''),[renaming,setRenaming]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{let active=true;void window.yorw.garden.notebook(id).then(r=>{if(active&&r.ok){setNote(r.value);setTitle(r.value.title);onChange(r.value)}});return()=>{active=false}},[id,baseline])
 async function rename(){if(!note||!title.trim())return;const r=await window.yorw.garden.renameNotebook({id,title:title.trim(),version:note.version});if(r.ok){setNote(r.value);onChange(r.value);setRenaming(false)}else setNotice('名称保存失败，可能已有新版本，请刷新后重试。')}
 async function remove(){if(!note)return;if(gardenBook().hasUnsavedTopic(id)){setNotice('请先保存或放弃此笔记的未保存内容。');return}if(!window.confirm('删除此笔记？所有共享入口都会移除，历史修订保留。'))return;const r=await window.yorw.garden.removeNotebook({id,version:note.version});if(r.ok){gardenBook().forgetDraft(id);window.dispatchEvent(new CustomEvent('notebook-deleted',{detail:note}));void gardenBook().refresh()}else setNotice('删除失败，笔记可能已有新版本，请刷新后重试。')}
 return <div className="notebook-detail-owner"><p>笔记归属：{note?.owner_title??'正在载入'} · 所有共享入口编辑同一份原笔记。</p><button onClick={()=>setRenaming(v=>!v)}>重命名笔记</button><button onClick={()=>void remove()}>删除笔记</button>{renaming&&<form onSubmit={e=>{e.preventDefault();void rename()}}><input aria-label="笔记名称" value={title} maxLength={120} onChange={e=>setTitle(e.target.value)}/><button disabled={!title.trim()}>保存名称</button></form>}<p role="status">{notice}</p></div>
}
