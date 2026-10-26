import React,{useEffect,useState} from 'react'
import type {ChatMessage} from '../shared/status'
import {useAiTask,aiError} from './ai-task'
import {generationError} from './generation-status'
import {MarkdownPreview} from './MarkdownPreview'
import './chat.css'

export function ChatPanel({documentId,onPage,onNote}:{documentId:string;onPage(page:number):void;onNote(id:string):void}){
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<ChatMessage[]>([]),[notice,setNotice]=useState('')
 const job=useAiTask('chat',documentId)
 useEffect(()=>{let active=true,loading=false
  const refresh=async()=>{if(loading)return;loading=true;try{const result=await window.yorw.chat.list(documentId);if(active&&result.ok)setMessages(result.value.items)}catch{if(active)setNotice('暂时无法加载对话。')}finally{loading=false}}
  setMessages([]);void refresh();const timer=setInterval(refresh,500);return()=>{active=false;clearInterval(timer)}
 },[documentId])
 const running=job.running||messages.some(message=>message.status==='running')
 async function note(id:string){try{const result=await window.yorw.chat.note(id);if(result.ok){setNotice('已保存到笔记。');onNote(result.value.id)}else setNotice(aiError(result.code))}catch{setNotice('保存失败，请重试。')}}
 async function cancel(id:string){try{await window.yorw.chat.cancel(id)}catch{setNotice('取消未完成，请重试。')}}
 async function send(){const submitted=question;setNotice('');if(await job.start(submitted))setQuestion(current=>current===submitted?'':current)}
 return <div className="chat-panel">
  <form onSubmit={event=>{event.preventDefault();void send()}}>
   <label>研究问题<textarea aria-label="研究问题" placeholder="向当前文献提问，也可以继续追问" maxLength={4000} value={question} onChange={event=>setQuestion(event.target.value)}/></label>
   <button className="primary" disabled={running||!question.trim()}>发送</button>
   {job.running&&<button type="button" onClick={()=>void job.cancel()}>取消</button>}
  </form>
  <p role="status">{notice||job.notice}</p>
  <div aria-label="问答历史">{messages.map(message=><article key={message.id}>
   <h3>{message.question}</h3>{message.status==='running'&&<p role="status">正在生成…</p>}
   {message.error_code&&<p>{generationError(message.error_code)}</p>}
   <MarkdownPreview body={message.body_md||'*正在查找原文依据…*'}/>
   <div className="chat-citations">{message.citations.map(n=><button key={n} disabled={!message.sources[n-1]?.available} onClick={()=>onPage(message.sources[n-1].physical_page)}>[S{n}] · 第 {message.sources[n-1].physical_page} 页{!message.sources[n-1]?.available?'（来源失效）':''}</button>)}</div>
   {message.status==='running'?<button onClick={()=>void cancel(message.id)}>取消生成</button>:<button disabled={running} onClick={()=>{setQuestion(message.question);void job.start(message.question)}}>重新回答</button>}
   {message.status==='completed'&&<button onClick={()=>void note(message.id)}>{message.note_id?'打开笔记':'保存到笔记'}</button>}
   {!!message.sources.length&&<details><summary>查看来源</summary>{message.sources.map((source,index)=><div key={source.id}><p>[S{index+1}] · 第 {source.physical_page} 页{!source.available&&' · 来源已失效'}</p><p>{source.text}</p><button disabled={!source.available} onClick={()=>onPage(source.physical_page)}>查看原文</button></div>)}</details>}
  </article>)}</div>
 </div>
}
