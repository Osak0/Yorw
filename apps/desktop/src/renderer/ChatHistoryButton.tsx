import React,{useRef,useState} from 'react'
import type {ChatHistoryView} from '../shared/status'
import {MarkdownPreview} from './MarkdownPreview'

export function ChatHistoryButton({documentId}:{documentId:string}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [value,setValue]=useState<ChatHistoryView|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 async function load(){
  setBusy(true);setNotice('')
  try{const result=await window.yorw.chat.history(documentId);if(result.ok)setValue(result.value);else setNotice('历史总结读取失败，请重试。')}
  catch{setNotice('历史总结读取失败，请重试。')}finally{setBusy(false)}
 }
 return <><button onClick={()=>{setValue(null);dialog.current?.showModal();void load()}}>查看 History.md</button>
 <dialog ref={dialog} className="chat-memory-dialog" aria-label="当前文献 History.md"><header><strong>History.md · 当前文献问答总结</strong><div><button disabled={busy} onClick={()=>void load()}>刷新</button><button onClick={()=>dialog.current?.close()}>关闭</button></div></header>
 <p className="resource-hint">历史用于理解追问，回答仍需核对当前原文；未完成的旧回答可能不完整。</p>
 {value&&<p className="resource-hint">{value.turn_count} 轮记录 · {value.compressed_turns} 轮已压缩 · 每 {value.compress_every} 轮旧记录压缩 · 上下文预算 {value.token_estimate} / {value.token_limit}（token 保守估计）</p>}
 <div className="chat-memory-content">{value&&<MarkdownPreview body={value.markdown}/>}</div><p role="status">{notice||(!value&&busy?'正在读取…':'')}{value?.export_available===false?'本地文件暂未导出，当前展示数据库中的历史。':''}</p>
 </dialog></>
}
