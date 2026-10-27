import React,{useEffect,useState,useSyncExternalStore} from 'react'
import {gardenBook,wikiDirty} from './garden-book'
import {MarkdownPreview} from './MarkdownPreview'
import {Sources} from './SuggestionsPanel'

export function WikiReview({topicId}:{topicId:string}){
 const book=gardenBook(),state=useSyncExternalStore(book.subscribe,book.getSnapshot)
 const review=state.reviews[topicId],draft=state.drafts[topicId]
 const [notice,setNotice]=useState('')
 useEffect(()=>setNotice(''),[review?.suggestion.id])
 if(!review)return null
 const {suggestion,current,body}=review
 const stale=current.revision.id!==suggestion.base_revision_id||draft.base!==current.revision.id
 const unavailable=suggestion.sources.some(source=>source.available===false)
 const scopeChanged=suggestion.scope_changed===true
 async function save(mode:'append'|'replace'){
  if(!review)return
  try{await book.decide(topicId,'accept',review,mode)}catch(error){setNotice(error instanceof Error?error.message:'保存失败，草稿已保留。')}
 }
 async function reject(){if(!review)return;try{await book.decide(topicId,'reject',review)}catch(error){setNotice(error instanceof Error?error.message:'操作失败。')}}
 const blocked=draft.saving||!body.trim()||stale||unavailable||scopeChanged||wikiDirty(draft)
 return <section className="wiki-review" aria-label="编辑 AI 草稿"><h3>编辑草稿</h3>
  {suggestion.recoverable&&<p>这份草稿尚未完成，可以在下方补全。原始生成记录继续保留。</p>}
  {stale&&<p role="alert">正文已更新，请基于最新版本重新生成。当前草稿已保留。</p>}
  {unavailable&&<p role="alert">来源内容已有变化，请重新生成后再保存。</p>}
  {scopeChanged&&<p role="alert">专题材料范围已变化，请重新生成或核对来源后再采纳；当前草稿已保留。</p>}
  {wikiDirty(draft)&&<p>正文有未保存修改，请先保存或载入已保存正文。</p>}
  <label>草稿正文<textarea aria-label="确认后的正文" disabled={draft.saving} value={body} maxLength={200000} onChange={event=>book.editReview(topicId,event.target.value)}/></label>
  <details><summary>预览草稿</summary><MarkdownPreview body={body}/></details>
  <details><summary>查看来源</summary><Sources sources={suggestion.sources}/></details>
  <details><summary>比较已有正文</summary><div className="wiki-compare"><div><h4>当前正文</h4><pre>{current.revision.body_md||'空白正文'}</pre></div><div><h4>原始草稿</h4><pre>{suggestion.body_md}</pre></div></div></details>
  <div className="draft-actions">
   <button className="primary" disabled={blocked} onClick={()=>void save('append')}>追加到正文</button>
   <button disabled={blocked} onClick={()=>void save('replace')}>替换正文</button>
   <button disabled={draft.saving} onClick={()=>void reject()}>忽略草稿</button>
   <button disabled={draft.saving} onClick={()=>{if(body===suggestion.body_md||window.confirm('放弃本次对草稿的未保存编辑？'))book.review(topicId,null)}}>关闭草稿</button>
  </div><p role="status">{notice}</p>
 </section>
}
