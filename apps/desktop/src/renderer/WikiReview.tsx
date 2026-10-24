import React,{useEffect,useState,useSyncExternalStore} from 'react'
import {gardenBook,wikiDirty} from './garden-book'
import {MarkdownPreview} from './MarkdownPreview'
import {Sources} from './SuggestionsPanel'

export function WikiReview({topicId}:{topicId:string}){
 const book=gardenBook(),state=useSyncExternalStore(book.subscribe,book.getSnapshot)
 const review=state.reviews[topicId],draft=state.drafts[topicId]
 const [confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{setConfirmed(false);setNotice('')},[review?.requestId,review?.suggestion.id,review?.current.revision.id,draft?.base])
 if(!review)return null
 const {suggestion,current,body}=review
 const stale=current.revision.id!==suggestion.base_revision_id||draft.base!==current.revision.id
 const unavailable=suggestion.sources.some(s=>s.available===false)
 async function decide(action:'accept'|'reject'){
  if(!review)return
  if(action==='reject'&&!window.confirm('拒绝此建议？保留生成记录，正文不会变化。'))return
  try{await book.decide(topicId,action,review);setConfirmed(false)}catch(e){setNotice(e instanceof Error?e.message:'操作失败，比较草稿已保留。')}
 }
 return <section className="wiki-review" aria-label="比较与确认建议"><h3>比较与确认建议</h3>
  <p>将下方“确认后的正文”保存为新的完整修订；来源保留本次材料快照。请逐项核查编号与论断，引用存在不代表已验证。</p>
  <div className="wiki-compare"><div><h4>生成时基础正文</h4><pre>{suggestion.base_body_md||'空白正文'}</pre></div><div><h4>比较时最新正文 · 修订 {current.revision.ordinal}</h4><pre>{current.revision.body_md||'空白正文'}</pre></div><div><h4>AI 原始建议</h4><pre>{suggestion.body_md}</pre></div></div>
  {stale&&<p role="alert">建议基线已过期，禁止采纳；请基于最新正文重新生成。仍可拒绝旧建议。</p>}
  {unavailable&&<p role="alert">材料版本失效，禁止采纳；原始快照仍可查看，请重新选材生成。</p>}
  {wikiDirty(draft)&&<p>手工正文有未保存内容，请先保存或明确放弃，再采纳。</p>}
  <label>确认后的正文<textarea aria-label="确认后的正文" disabled={draft.saving} value={body} maxLength={200000} onChange={e=>{book.editReview(topicId,e.target.value);setConfirmed(false)}}/></label>
  <details><summary>预览确认后的正文</summary><MarkdownPreview body={body}/></details><Sources sources={suggestion.sources}/>
  <label><input type="checkbox" checked={confirmed} disabled={draft.saving} onChange={e=>setConfirmed(e.target.checked)}/>我已比较正文、核查来源，确认将上述正文保存为新修订。</label>
  <button className="primary" disabled={draft.saving||!confirmed||!body.trim()||stale||unavailable||wikiDirty(draft)} onClick={()=>void decide('accept')}>确认采纳并保存修订</button>
  <button disabled={draft.saving} onClick={()=>void decide('reject')}>拒绝此建议</button>
  <button disabled={draft.saving} onClick={()=>{if(body===suggestion.body_md||window.confirm('放弃本次对建议的未保存修改？原始建议保留。'))book.review(topicId,null)}}>关闭比较</button>
  <p role="status">{notice}</p>
 </section>
}
