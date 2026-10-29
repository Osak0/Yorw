import {SourceNavigationContext} from './source-navigation'
import React,{useContext,useEffect,useRef,useState} from 'react'
import type {Suggestion,SourceRef} from '../shared/status'
import {MarkdownPreview} from './MarkdownPreview'
import {useAiTask,aiError} from './ai-task'
import {generationError} from './generation-status'
import {sessionStore,useTopicSession} from './session-state'
import './suggestions.css'

const labels={document:'论文原文',note:'用户笔记',message:'模型对话',wiki:'已有 Wiki'}
export function Sources({sources}:{sources:SourceRef[]}){
 const navigate=useContext(SourceNavigationContext)
 return <div className="suggestion-sources">{sources.map((source,index)=><details key={source.source_id??index}>
  <summary>[{source.source_id??'S'+(index+1)}] {source.title??source.evidence?.[0]?.document_title??labels[source.kind]??'来源'}{source.available===false?' · 来源已变化':''}</summary><small>{labels[source.kind]??'来源'}</small>
  <p className="source-excerpt">{source.excerpt}</p>
  {source.evidence?.map((e,i)=><div key={i}><p>{e.document_title} · {e.physical_page ? `第 ${e.physical_page} 页` : e.section_path?.length ? e.section_path.join(' / ') : '内容块'}</p><p className="source-excerpt">{e.quote}</p><button disabled={source.available===false||(!e.block_id&&!e.physical_page)} onClick={()=>navigate(e.document_id,{block_id:e.block_id??undefined,page:e.physical_page??undefined,evidence:e.quote,section_path:e.section_path})}>查看依据</button></div>)}
 </details>)}</div>
}
export function SuggestionsPanel({topicId,baseRevisionId,dirty,onReview,onReviewUpdate}:{topicId:string;baseRevisionId:string;dirty:boolean;onReview(suggestion:Suggestion):void;onReviewUpdate?(suggestion:Suggestion):void}){
 const session=useTopicSession(topicId),instruction=session.aiInstruction,scope=session.aiScope
 const setInstruction=(value:string)=>sessionStore().updateTopic(topicId,{aiInstruction:value})
 const setScope=(value:'topic'|'workspace')=>sessionStore().updateTopic(topicId,{aiScope:value})
 const [history,setHistory]=useState<Suggestion[]>([]),[notice,setNotice]=useState('')
 const job=useAiTask('draft',topicId),opened=useRef('')
 useEffect(()=>{let active=true,loading=false
  const refresh=async()=>{if(loading)return;loading=true;try{const result=await window.yorw.suggestions.list(topicId);if(active&&result.ok)setHistory(result.value.items)}catch{if(active)setNotice('暂时无法加载草稿。')}finally{loading=false}}
  setHistory([]);opened.current='';void refresh();const timer=setInterval(refresh,700);return()=>{active=false;clearInterval(timer)}
 },[topicId])
 useEffect(()=>{
  const id=job.task?.result?.suggestion_id
  const draft=history.find(item=>item.id===id)
  if(draft&&!draft.decision&&(draft.status==='completed'||draft.recoverable)&&opened.current!==draft.id){opened.current=draft.id;onReview(draft)}
 },[history,job.task?.result?.suggestion_id,onReview])
 useEffect(()=>{
  const current=history.find(item=>item.id===opened.current)
  if(current&&onReviewUpdate)onReviewUpdate(current)
 },[history,onReviewUpdate])
 const running=job.running||history.some(item=>item.status==='running')
 const streaming=history.find(item=>item.id===job.task?.result?.suggestion_id&&item.status==='running')
 async function cancel(item:Suggestion){try{await window.yorw.suggestions.cancel(item.id)}catch{setNotice('取消未完成，请重试。')}}
 return <section className="wiki-suggestions"><h3>AI 草稿</h3>
  <form onSubmit={event=>{event.preventDefault();setNotice('');void job.start(instruction,baseRevisionId,scope)}}>
   <label>生成要求<textarea aria-label="Wiki 生成要求" placeholder="例如：整理这些研究对视觉证据依赖的结论和仍待验证的问题" maxLength={2000} value={instruction} onChange={event=>setInstruction(event.target.value)}/></label>
   <label>材料范围<select aria-label="AI 材料范围" value={scope} disabled={running} onChange={event=>setScope(event.target.value as 'topic'|'workspace')}><option value="topic">当前专题及子专题</option><option value="workspace">全工作区</option></select></label>
   <p className="scope-hint">{scope==='topic'?'使用本专题及子专题关联的文献、笔记和子专题 Wiki；当前正文只作编辑背景。':'使用整个工作区的已保存文献、笔记和 Wiki。'}</p>
   <button className="primary" disabled={running||!instruction.trim()}>生成草稿</button>
   {job.running&&<button type="button" onClick={()=>void job.cancel()}>取消</button>}
  </form>
  {dirty&&<p>当前正文有未保存修改，本次会参考已保存的版本。</p>}
  <p role="status">{notice||job.notice}</p>
  {streaming&&<section className="draft-stream" aria-label="正在生成的草稿"><MarkdownPreview body={streaming.body_md||'*正在生成…*'}/><button onClick={()=>void cancel(streaming)}>取消生成</button></section>}
  <details className="draft-history"><summary>草稿历史（{history.length}）</summary>
   {[...history].reverse().map(item=><article key={item.id} className="suggestion-record">
    <h4>{item.instruction}</h4><p>{item.status==='running'?'正在生成…':item.status==='completed'?'草稿已完成':item.recoverable?'草稿未完成':item.status==='cancelled'?'已取消':'生成未完成'}</p>
    {item.error_code&&<p>{aiError(item.error_code)||generationError(item.error_code)}</p>}
    {item.status==='running'&&<button onClick={()=>void cancel(item)}>取消生成</button>}
    {item.decision?<p>已{item.decision.action==='accept'?'保存':'忽略'}</p>:(item.status==='completed'||item.recoverable)&&<button onClick={()=>onReview(item)}>编辑草稿</button>}
    <details><summary>查看内容与来源</summary><MarkdownPreview body={item.body_md||'*尚无内容。*'}/><Sources sources={item.sources}/></details>
   </article>)}
  </details>
 </section>
}
