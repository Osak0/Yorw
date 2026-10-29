import React from 'react'
import type {ReaderTarget,SearchHit} from '../shared/status'
import {useAiTask} from './ai-task'
import {sessionStore,useDocumentSession} from './session-state'
import './search.css'

export function SearchPanel({documentId,onPage,onNavigate}:{documentId:string;onPage?:(page:number)=>void;onNavigate?:(target:ReaderTarget)=>void}){
 const session=useDocumentSession(documentId),query=session.searchQuery
 const setQuery=(value:string)=>sessionStore().updateDocument(documentId,{searchQuery:value})
 const job=useAiTask('search',documentId)
 const result=job.task?.status==='succeeded'?job.task.result:null
 const hits=(result?.items??[]) as SearchHit[]
 const go=(hit:SearchHit)=>{if(onNavigate)onNavigate({page:hit.physical_page??undefined,block_id:hit.block_id??undefined,evidence:hit.snippet,section_path:hit.section_path});else if(hit.physical_page)onPage?.(hit.physical_page)}
 const place=(hit:SearchHit)=>hit.physical_page?`第 ${hit.physical_page} 页`:hit.section_path?.length?hit.section_path.join(' / '):'内容块'
 return <div className="search-panel">
  <form onSubmit={event=>{event.preventDefault();void job.start(query)}}>
   <label>查找原文<input aria-label="文献内检索" placeholder="输入关键词或问题" value={query} maxLength={4000} onChange={event=>setQuery(event.target.value)}/></label>
   <button className="search-submit" disabled={job.running||!query.trim()}>搜索</button>
   {job.running&&<button type="button" onClick={()=>void job.cancel()}>取消</button>}
  </form>
  <p role="status" className="search-feedback">{job.notice}</p>
  {result&&<div className="search-results" aria-label="检索结果">
   {result.reason&&<p className="search-mode">智能检索暂不可用，已展示初步匹配结果。</p>}
   {!hits.length&&<p>没有找到相关内容。可以换一种问法再试。</p>}
   {hits.map(hit=><article key={hit.id} className="search-hit">
    <h3><button className="source-title" disabled={!hit.physical_page&&!hit.block_id} onClick={()=>go(hit)}>{hit.title}</button></h3>
    <small>{place(hit)}</small><p className="search-snippet">{hit.snippet}</p>
    <button onClick={()=>go(hit)} disabled={!hit.physical_page&&!hit.block_id}>查看依据</button>
   </article>)}
  </div>}
 </div>
}
