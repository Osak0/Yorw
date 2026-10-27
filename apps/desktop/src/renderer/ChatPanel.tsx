import React,{useEffect,useRef,useState} from 'react'
import type {ChatMessage} from '../shared/status'
import {useAiTask,aiError} from './ai-task'
import {generationError} from './generation-status'
import {MarkdownPreview} from './MarkdownPreview'
import {sessionStore,useDocumentSession} from './session-state'
import './chat.css'

export function ChatPanel({documentId,onPage,onNote}:{documentId:string;onPage(page:number):void;onNote(id:string):void}){
 const session=useDocumentSession(documentId),question=session.chatQuestion
 const setQuestion=(value:string|((current:string)=>string))=>{const current=sessionStore().document(documentId).chatQuestion;sessionStore().updateDocument(documentId,{chatQuestion:typeof value==='function'?value(current):value})}
 const [messages,setMessages]=useState<ChatMessage[]>([]),[notice,setNotice]=useState('')
 const [atBottom,setAtBottom]=useState(true)
 const history=useRef<HTMLDivElement>(null)
 const composing=useRef(false)
 const job=useAiTask('chat',documentId)
 const running=job.running||messages.some(message=>message.status==='running')
 useEffect(()=>{let active=true,loading=false
  const refresh=async()=>{if(loading)return;loading=true;try{const result=await window.yorw.chat.list(documentId);if(active&&result.ok)setMessages(result.value.items)}catch{if(active)setNotice('暂时无法加载对话。')}finally{loading=false}}
  setMessages([]);void refresh();const timer=setInterval(refresh,500);return()=>{active=false;clearInterval(timer)}
 },[documentId])
 useEffect(()=>{if(!atBottom||!history.current)return;history.current.scrollTop=history.current.scrollHeight},[messages,atBottom])
 function scrollToLatest(){const element=history.current;if(element){element.scrollTop=element.scrollHeight;setAtBottom(true)}}
 function onHistoryScroll(){const element=history.current;if(!element)return;setAtBottom(element.scrollTop+element.clientHeight>=element.scrollHeight-24)}
 async function note(id:string){try{const result=await window.yorw.chat.note(id);if(result.ok){setNotice('已保存到笔记。');onNote(result.value.id)}else setNotice(aiError(result.code))}catch{setNotice('保存失败，请重试。')}}
 async function stop(){try{if(job.running){await job.cancel();return}const active=messages.find(message=>message.status==='running');if(active)await window.yorw.chat.cancel(active.id)}catch{setNotice('停止未完成，请重试。')}}
 async function send(){const submitted=question.trim();setNotice('');if(!submitted||running)return;setAtBottom(true);if(await job.start(submitted)){if(sessionStore().document(documentId).chatQuestion===question)sessionStore().updateDocument(documentId,{chatQuestion:''});requestAnimationFrame(scrollToLatest)}}
 function retry(message:ChatMessage){setQuestion(message.question);setNotice('');setAtBottom(true);void job.start(message.question).then(started=>{if(started)requestAnimationFrame(scrollToLatest)})}
 function onComposeKeyDown(event:React.KeyboardEvent<HTMLTextAreaElement>){if(event.key!=='Enter'||event.shiftKey)return;if(composing.current||event.nativeEvent.isComposing||event.keyCode===229)return;event.preventDefault();void send()}
 return <div className="chat-panel">
  <div className="chat-history-wrap">
   <div className="chat-history" ref={history} onScroll={onHistoryScroll} aria-label="问答历史">
    {messages.map(message=><article key={message.id} className={`chat-message ${message.status}`}>
     <div className="chat-question">{message.question}</div>
     <div className="chat-answer">
      {message.status==='running'&&!message.body_md&&<p className="chat-progress">正在查找原文并生成回答…</p>}
      {message.error_code&&<p className="chat-error">{generationError(message.error_code)}</p>}
      {message.body_md?<MarkdownPreview body={message.body_md}/>:message.status!=='running'&&<p className="chat-progress">没有生成正文。</p>}
      <div className="chat-citations">{message.citations.map(n=><button key={n} disabled={!message.sources[n-1]?.available} onClick={()=>message.sources[n-1]&&onPage(message.sources[n-1].physical_page)}>[S{n}] · 第 {message.sources[n-1]?.physical_page ?? '—'} 页{!message.sources[n-1]?.available?'（来源失效）':''}</button>)}</div>
      {message.status!=='running'&&<div className="chat-actions"><button disabled={running} onClick={()=>retry(message)}>重新回答</button>{message.status==='completed'&&<button onClick={()=>void note(message.id)}>{message.note_id?'打开笔记':'保存到笔记'}</button>}</div>}
      {!!message.sources.length&&<details className="chat-sources"><summary>查看来源</summary>{message.sources.map((source,index)=><div key={source.id}><p>[S{index+1}] · 第 {source.physical_page} 页{!source.available&&' · 来源已失效'}</p><p>{source.text}</p><button disabled={!source.available} onClick={()=>onPage(source.physical_page)}>查看原文</button></div>)}</details>}
     </div>
    </article>)}
    {!messages.length&&!running&&<p className="chat-empty">向当前文献提问。回答只使用本文检索到的原文证据。</p>}
   </div>
   {!atBottom&&<button className="chat-latest" type="button" title="跳转到最新消息（对话底部）" aria-label="回到最新消息，跳转到对话底部" onClick={scrollToLatest}>回到最新 <span aria-hidden="true">↓</span></button>}
  </div>
  <p className="chat-status" role="status">{notice||job.notice}</p>
  <form className="chat-compose" onSubmit={event=>{event.preventDefault();void send()}}>
   <label>研究问题<textarea aria-label="研究问题" placeholder="向当前文献提问，也可以继续追问" maxLength={4000} value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={onComposeKeyDown} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}}/></label>
   <div className="chat-compose-actions"><span className="chat-hint">Enter 发送 · Shift+Enter 换行</span><button className="primary" disabled={running||!question.trim()}>发送</button>{running&&<button type="button" onClick={()=>void stop()}>停止</button>}</div>
  </form>
 </div>
}
