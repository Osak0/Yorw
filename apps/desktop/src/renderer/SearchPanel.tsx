import {searchReason} from './search-reason'
import React,{useState,useEffect,useRef,useCallback} from 'react'
import type {ReaderTarget,SearchHit,DocumentResource} from '../shared/status'
import {useAiTask} from './ai-task'
import {sessionStore,useDocumentSession} from './session-state'
import './search.css'

type HistoryEntry=DocumentResource['search_history'][number]
const statusLabel=(status:string)=>({succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',queued:'等待中',running:'进行中'} as Record<string,string>)[status]??'状态未知'

export function SearchPanel({documentId,onPage,onNavigate,showHistory=false}:{documentId:string;onPage?:(page:number)=>void;onNavigate?:(target:ReaderTarget)=>void;showHistory?:boolean}){
 const session=useDocumentSession(documentId),query=session.searchQuery
 const update=(patch:Parameters<ReturnType<typeof sessionStore>['updateDocument']>[1])=>sessionStore().updateDocument(documentId,patch)
 const job=useAiTask('search',documentId)
 const [entries,setEntries]=useState<HistoryEntry[]>([]),[historyNotice,setHistoryNotice]=useState(''),[mutating,setMutating]=useState(false)
 const epoch=useRef(0)
 const refresh=useCallback(async()=>{const token=++epoch.current;try{const r=await window.yorw.resources.searchHistory(documentId);if(token!==epoch.current)return;if(r.ok){setEntries(r.value.items);setHistoryNotice('')}else setHistoryNotice('历史加载失败，请重试。')}catch{if(token===epoch.current)setHistoryNotice('历史加载失败，请重试。')}},[documentId])
 useEffect(()=>{setEntries([]);if(!showHistory)return;void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>{epoch.current++;clearInterval(timer)}},[refresh,showHistory])
 const selected=showHistory?entries.find(e=>e.id===session.searchHistoryId):undefined
 const latest=job.task?.status==='succeeded'?job.task.result:null
 const result=session.searchResultsCleared?null:selected?{items:selected.items.map(hit=>({...hit,block_id:hit.evidence.find(e=>e.block_id)?.block_id})),reason:selected.reason,query:selected.query}:latest
 const hits=(result?.items??[]) as (SearchHit & {available?:boolean})[]
 const go=(hit:SearchHit)=>{if(onNavigate)onNavigate({page:hit.physical_page??undefined,block_id:hit.block_id??undefined,evidence:hit.snippet,section_path:hit.section_path});else if(hit.physical_page)onPage?.(hit.physical_page)}
 const place=(hit:SearchHit)=>hit.physical_page?`第 ${hit.physical_page} 页`:hit.section_path?.length?hit.section_path.join(' / '):'内容块'
 const run=(text:string)=>{if(!text.trim()){update({searchHistoryId:undefined,searchResultsCleared:true});return}update({searchHistoryId:undefined,searchResultsCleared:false});void job.start(text)}
 async function removeHistory(entry?:HistoryEntry){
  if(mutating)return
  if(!entry&&!window.confirm('清空当前文献检索历史？'))return
  setMutating(true)
  try{const r=entry?await window.yorw.resources.deleteSearchHistory({document_id:documentId,history_id:entry.id}):await window.yorw.resources.clearSearchHistory(documentId)
   if(!r.ok){setHistoryNotice('历史删除失败，请重试。');return}
   if(!entry||sessionStore().document(documentId).searchHistoryId===entry.id)update({searchHistoryId:undefined})
   await refresh()
  }catch{setHistoryNotice('历史删除失败，请重试。')}finally{setMutating(false)}
 }
 const open=showHistory&&(session.searchHistoryOpen??true)
 return <div className={`search-panel${showHistory?' search-panel-detailed':' search-panel-reader'}`}>
  <form className="search-topbar" onSubmit={event=>{event.preventDefault();run(query)}}>
   {showHistory&&<button type="button" aria-expanded={open} aria-controls={`search-history-${documentId}`} onClick={()=>update({searchHistoryOpen:!open})}>检索历史</button>}
   <label>查找原文<input aria-label="文献内检索" placeholder="输入关键词或问题" value={query} maxLength={1000} onChange={event=>update({searchQuery:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229&&!query.trim()){event.preventDefault();run('')}}}/></label>
   <button className="search-submit" disabled={job.running||!query.trim()}>搜索</button>
   {job.running&&<button type="button" onClick={()=>void job.cancel()}>取消</button>}
  </form>
  <div className="search-workspace">
   {open&&<aside className="search-history-sidebar" id={`search-history-${documentId}`} aria-label="检索历史">
    <div className="search-history-actions"><button disabled={mutating} onClick={()=>void refresh()}>刷新</button><button disabled={mutating||!entries.length} onClick={()=>void removeHistory()}>清空历史</button></div>
    <p role="status">{historyNotice}</p>
    <div className="search-history-list">{entries.map(entry=><div className="search-history-entry" key={entry.id}>
     <button className="search-history-select" aria-pressed={entry.id===session.searchHistoryId} onClick={()=>update({searchHistoryId:entry.id,searchQuery:entry.query,searchResultsCleared:false})}><strong>{entry.query}</strong><small>{new Date(entry.created_at).toLocaleString()} · {statusLabel(entry.status)}</small></button>
     <button aria-label={`删除历史 ${entry.query}`} disabled={mutating} onClick={()=>void removeHistory(entry)}>删除</button>
    </div>)}{!entries.length&&!historyNotice&&<p>暂无检索历史。</p>}</div>
   </aside>}
   <div className="search-results" aria-label="检索结果">
    <p role="status" className="search-feedback">{session.searchResultsCleared?'':job.notice}</p>
    {selected&&<div className="search-snapshot"><strong>{selected.query}</strong><small>{new Date(selected.created_at).toLocaleString()} · {statusLabel(selected.status)}</small>{selected.error_code&&<p>当时检索未完成（{selected.error_code}）。</p>}<button disabled={job.running} onClick={()=>run(selected.query)}>重新检索</button><button onClick={()=>update({searchHistoryId:undefined})}>返回最新结果</button></div>}
    {result?.reason&&result.reason!=='FILTER_UNAVAILABLE'&&<p className="search-mode">{searchReason(result.reason)}{!selected&&<button disabled={job.running} onClick={()=>run(String(result.query??query))}>重新检索</button>}</p>}
    {result&&!hits.length&&<p>没有找到相关内容。可以换一种问法再试。</p>}
    {hits.map(hit=><article key={hit.id} className="search-hit"><h3><button className="source-title" disabled={hit.available===false||(!hit.physical_page&&!hit.block_id)} onClick={()=>go(hit)}>{hit.title}</button></h3><small>{place(hit)}{hit.available===false?' · 来源已失效':''}</small><p className="search-snippet">{hit.snippet}</p><button onClick={()=>go(hit)} disabled={hit.available===false||(!hit.physical_page&&!hit.block_id)}>查看依据</button></article>)}
   </div>
  </div>
 </div>
}
