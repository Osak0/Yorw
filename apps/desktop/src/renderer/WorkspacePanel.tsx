import React,{useEffect,useState} from 'react'
import type {ExportCatalog} from '../shared/status'

const explain=(code:string)=>({INVALID_EXPORT_SELECTION:'请选择 1–500 个笔记或专题，不可重复。',EXPORT_TOO_LARGE:'内容与来源清单超过 20 MiB，请减少选择后重试。',EXPORT_UNAVAILABLE:'导出临时文件不可用，请重新创建快照。',EXPORT_DESTINATION_PROTECTED:'请选择工作区和应用数据目录以外的位置，避免覆盖正在使用的资料。',BACKEND_NOT_READY:'本地服务不可用，请稍后重试。'}[code]??`操作失败（${code}），没有确认保存成功。`)
export function WorkspacePanel({active=true}:{active?:boolean}){
 const [info,setInfo]=useState<{data_location:string;workspace_id:string;schema_version:number}|null>(null),[catalog,setCatalog]=useState<ExportCatalog|null>(null)
 const [notes,setNotes]=useState<string[]>([]),[topics,setTopics]=useState<string[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const [snapshot,setSnapshot]=useState<{task_id:string;count:number;bytes:number}|null>(null)
 async function load(){setBusy(true);try{const [a,b]=await Promise.all([window.yorw.workspace.info(),window.yorw.workspace.catalog()]);if(a.ok)setInfo(a.value);else setNotice(explain(a.code));if(b.ok){setCatalog(b.value);setNotes(v=>v.filter(id=>b.value.notes.some(n=>n.id===id)));setTopics(v=>v.filter(id=>b.value.topics.some(t=>t.id===id)))}else setNotice(explain(b.code))}catch{setNotice('数据位置或内容列表加载失败，请重试。')}finally{setBusy(false)}}
 useEffect(()=>{if(active)void load()},[active])
 async function save(task:string){const result=await window.yorw.workspace.save(task);setNotice(result.ok?(result.value.cancelled?'已取消保存，可再次保存这份快照。':'内容 ZIP 已保存。请解压核查正文与来源清单。'):explain(result.code))}
 async function create(){setBusy(true);try{const result=await window.yorw.workspace.create({note_ids:notes,topic_ids:topics});if(!result.ok){setNotice(explain(result.code));return}setSnapshot(result.value);await save(result.value.task_id)}catch{setNotice('导出或保存失败，未确认写入成功；可重试保存已有快照。')}finally{setBusy(false)}}
 const toggle=(values:string[],id:string,checked:boolean)=>checked?[...values,id]:values.filter(v=>v!==id)
 return <section className="provider workspace-panel"><h2>本地数据与内容导出</h2><button disabled={busy} onClick={()=>void load()}>刷新数据与导出列表</button>{info&&<><p>当前工作区（{info.schema_version} 版数据结构）</p><code className="workspace-location">{info.data_location}</code><small>工作区 ID：{info.workspace_id}。本步显示数据位置，暂不提供目录迁移。</small></>}
  <p>导出已保存的笔记和 Wiki 当前修订，附带来源快照及导出时可用性。Markdown 正文保持原样；不包含未保存草稿。</p>
  <p><strong>内容导出不是完整备份。</strong>不包含 PDF、密钥、模型配置、聊天历史、未采纳建议或完整修订历史；不提供恢复导入。</p>
  {catalog&&<fieldset disabled={busy}><div className="actions"><button onClick={()=>{setNotes(catalog.notes.map(n=>n.id));setTopics(catalog.topics.map(t=>t.id))}}>全选已保存内容</button><button onClick={()=>{setNotes([]);setTopics([])}}>清空选择</button></div>
   <details open><summary>笔记（{catalog.notes.length}）</summary><div className="export-choices">{catalog.notes.map(n=><label key={n.id}><input type="checkbox" checked={notes.includes(n.id)} onChange={e=>setNotes(v=>toggle(v,n.id,e.target.checked))}/>{n.label||'空笔记'} · {n.document_title}{!n.document_available?' · 关联文献已移除':''}</label>)}</div></details>
   <details open><summary>Wiki 当前修订（{catalog.topics.length}）</summary><div className="export-choices">{catalog.topics.map(t=><label key={t.id}><input type="checkbox" checked={topics.includes(t.id)} onChange={e=>setTopics(v=>toggle(v,t.id,e.target.checked))}/>{t.title}</label>)}</div></details>
   <p>已选 {notes.length+topics.length} / 500 项；正文及来源清单合计上限 20 MiB。创建时读取最新已保存版本，随后用系统对话框选择 ZIP 位置。</p>
   <button className="primary" disabled={!notes.length&&!topics.length||notes.length+topics.length>500} onClick={()=>void create()}>创建快照并导出 ZIP</button>
  </fieldset>}
  {snapshot&&<p>最近快照：{snapshot.count} 项 · {snapshot.bytes.toLocaleString()} 字节。<button disabled={busy} onClick={()=>{setBusy(true);void save(snapshot.task_id).catch(()=>setNotice('保存失败，可重试。')).finally(()=>setBusy(false))}}>再次保存这份快照</button></p>}
  <p role="status">{notice}</p>
 </section>
}
