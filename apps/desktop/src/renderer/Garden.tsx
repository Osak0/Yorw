import React,{useEffect,useState,useSyncExternalStore} from 'react'
import type {Revision,Topic,TopicView,Suggestion} from '../shared/status'
import {gardenBook,wikiDirty,type WikiDraft} from './garden-book'
import {MarkdownEditor} from './MarkdownEditor'
import {MarkdownPreview} from './MarkdownPreview'
import {SuggestionsPanel,Sources} from './SuggestionsPanel'
import {WikiReview} from './WikiReview'
import './notes.css'
import './garden.css'

function descendants(topics:Topic[],id:string){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const t of topics)if(t.parent_id&&found.has(t.parent_id)&&!found.has(t.id)){found.add(t.id);changed=true}}return found}

function TopicEditor({topic,draft,topics}:{topic:Topic;draft:WikiDraft;topics:Topic[]}){
 const book=gardenBook()
 const [suggestionsOpen,setSuggestionsOpen]=useState(false)
 const [restoring,setRestoring]=useState<{target:Revision;current:TopicView;requestId:string}|null>(null)
 const [title,setTitle]=useState(topic.title),[parent,setParent]=useState(topic.parent_id??''),[version,setVersion]=useState(topic.version)
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false)
 const [history,setHistory]=useState<Revision[]|null>(null),[chosen,setChosen]=useState(''),[remote,setRemote]=useState<TopicView|null>(null)
 useEffect(()=>{if(title===topic.title&&parent===(topic.parent_id??''))setVersion(topic.version)},[topic.version,topic.title,topic.parent_id,title,parent])
 const excluded=descendants(topics,topic.id)
 const error=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
 async function metadata(){setBusy(true);setNotice('');try{await book.metadata(topic.id,title,parent||null,version);const updated=book.getSnapshot().topics.find(t=>t.id===topic.id)!;setTitle(updated.title);setParent(updated.parent_id??'');setVersion(updated.version);setNotice('目录信息已保存。')}catch(e){setNotice(error(e))}finally{setBusy(false)}}
 async function loadDirectory(){await book.refresh();const current=book.getSnapshot().topics.find(t=>t.id===topic.id);if(current){setTitle(current.title);setParent(current.parent_id??'');setVersion(current.version);setNotice('已载入当前目录信息，正文草稿保持。')}}
 async function loadHistory(){setBusy(true);try{const result=await window.yorw.garden.history(topic.id);if(result.ok){setHistory(result.value.items);setChosen(result.value.items[0]?.id??'')}else setNotice(`历史加载失败（${result.code}）`)}catch{setNotice('历史加载失败。')}finally{setBusy(false)}}
 async function compare(){try{setRemote(await book.latest(topic.id))}catch(e){setNotice(error(e))}}
 async function review(suggestion:Suggestion){
  const existing=book.getSnapshot().reviews[topic.id]
  if(existing&&existing.body!==existing.suggestion.body_md&&!window.confirm('放弃之前对建议的未保存修改，比较这份建议？'))return
  try{const current=await book.latest(topic.id);book.review(topic.id,{suggestion,current,body:suggestion.body_md,requestId:crypto.randomUUID()});setNotice('已打开比较；正文尚未变化。')}catch(e){setNotice(error(e))}
 }
 async function prepareRestore(target:Revision){try{setRestoring({target,current:await book.latest(topic.id),requestId:crypto.randomUUID()})}catch(e){setNotice(error(e))}}
 async function restore(){if(!restoring)return;try{await book.restore(topic.id,restoring.target.id,{base_revision_id:restoring.current.revision.id,request_id:restoring.requestId});setRestoring(null);await loadHistory();setNotice('已回退为新修订，原历史保留。')}catch(e){setNotice(error(e))}}
 const old=history?.find(r=>r.id===chosen)
 return <article className="garden-editor" aria-label="专题编辑"><h2>{topic.title}</h2>
  <details className="topic-metadata"><summary>专题名称与父级</summary><label>名称<input aria-label="专题名称" disabled={busy} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>父级<select aria-label="专题父级" disabled={busy} value={parent} onChange={e=>setParent(e.target.value)}><option value="">根目录</option>{topics.filter(t=>!excluded.has(t.id)).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><button disabled={busy||!title.trim()} onClick={()=>void metadata()}>保存目录信息</button><button disabled={busy} onClick={()=>void loadDirectory()}>载入当前目录信息</button><small>目录变更需单独保存；不能移入自身或后代。</small></details>
  <p role="status" className="garden-feedback">{notice}</p><div className="garden-edit-toolbar"><button aria-pressed={!preview} onClick={()=>setPreview(false)}>编辑正文</button><button aria-pressed={preview} onClick={()=>setPreview(true)}>预览正文</button><button className="primary" disabled={draft.saving||draft.conflict||!wikiDirty(draft)||draft.body.length>200000} onClick={()=>void book.save(topic.id)}>保存修订</button></div>
  <p role="status" className="wiki-status">{draft.saving?'正在保存修订…':draft.message}{wikiDirty(draft)&&' · 有未保存正文（本次会话保留）'} · {draft.body.length.toLocaleString()} / 200,000</p>
  {draft.body.length>200000&&<p role="alert">正文超过上限，当前草稿保留，请缩短后保存。</p>}
  <div hidden={preview}><MarkdownEditor label="专题 Markdown 正文" value={draft.body} onChange={body=>book.edit(topic.id,body)} onSave={()=>void book.save(topic.id)}/></div>{preview&&<MarkdownPreview body={draft.body||'*尚无专题正文。*'}/>}
  <button disabled={draft.saving} onClick={()=>{if(!wikiDirty(draft)||window.confirm('放弃当前专题未保存正文，载入最新已保存修订？'))void book.latest(topic.id).then(value=>{book.acceptLatest(value,false);setRemote(null)}).catch(e=>setNotice(error(e)))}}>载入最新保存正文</button>
  {draft.conflict&&<div className="note-conflict"><p>保存基线已变化，当前草稿没有被覆盖。</p><button onClick={()=>void compare()}>比较最新修订</button>{remote&&<><p>最新修订 {remote.revision.ordinal}</p><pre>{remote.revision.body_md}</pre><button onClick={()=>{book.acceptLatest(remote,true);setRemote(null)}}>保留草稿，基于最新继续</button></>}</div>}
  <div className="garden-history"><button disabled={busy} onClick={()=>void loadHistory()}>查看修订历史</button>{history&&<><label>历史修订<select aria-label="历史修订" value={chosen} onChange={e=>setChosen(e.target.value)}>{history.map(r=><option key={r.id} value={r.id}>修订 {r.ordinal} · {r.origin} · {r.created_at}</option>)}</select></label>{old&&<><p>只读快照；查看历史不会覆盖当前草稿。回退会创建新修订并恢复该版本的来源快照。</p><MarkdownPreview body={old.body_md||'*空白初始修订。*'}/><Sources sources={old.sources as import('../shared/status').SourceRef[]}/><button disabled={draft.saving||wikiDirty(draft)} onClick={()=>void prepareRestore(old)}>比较并回退此修订</button></>}</>}</div>
  {restoring&&<section className="wiki-review" aria-label="回退确认"><h3>确认回退</h3><p>当前修订 {restoring.current.revision.ordinal} → 复制历史修订 {restoring.target.ordinal} 为新修订；历史及来源快照保留，失效来源不会恢复为可用。</p><div className="wiki-compare"><div><h4>当前已保存正文</h4><pre>{restoring.current.revision.body_md||'空白正文'}</pre></div><div><h4>将恢复的正文</h4><pre>{restoring.target.body_md||'空白正文'}</pre></div></div><button className="primary" disabled={draft.saving||wikiDirty(draft)||draft.base!==restoring.current.revision.id} onClick={()=>void restore()}>确认回退为新修订</button><button disabled={draft.saving} onClick={()=>setRestoring(null)}>取消回退</button></section>}
  <WikiReview topicId={topic.id}/>
  <button onClick={()=>setSuggestionsOpen(v=>!v)}>{suggestionsOpen?'收起材料与 AI 草稿':'材料与 AI 草稿'}</button>{suggestionsOpen&&<SuggestionsPanel topicId={topic.id} baseRevisionId={draft.base} dirty={wikiDirty(draft)} onReview={s=>void review(s)}/>}
  <p className="notes-footnote">Ctrl+S 保存正文为新修订；草稿尚无崩溃恢复能力。人工内容不会自动获得论文来源，AI 草稿在材料面板中独立生成，比较确认后才能采纳或回退；建议编辑在本次会话保留，关闭前请确认保存。</p>
 </article>
}

export function Garden(){
 const book=gardenBook(),state=useSyncExternalStore(book.subscribe,book.getSnapshot)
 const [title,setTitle]=useState(''),[parent,setParent]=useState(''),[creating,setCreating]=useState(false),[notice,setNotice]=useState(''),[createId,setCreateId]=useState(()=>crypto.randomUUID())
 useEffect(()=>{void book.refresh()},[book])
 async function create(){setCreating(true);try{await book.create(title,parent||null,createId);setTitle('');setCreateId(crypto.randomUUID());setNotice('专题已创建，初始空白修订已保存。')}catch(e){setNotice(e instanceof Error?e.message:'创建失败，请重试。')}finally{setCreating(false)}}
 function tree(parentId:string|null,seen=new Set<string>()):React.ReactNode{return <ul>{state.topics.filter(t=>t.parent_id===parentId).map(t=>seen.has(t.id)?null:<li key={t.id}><button data-topic-id={t.id} aria-current={state.selected===t.id?'true':undefined} onClick={()=>void book.select(t.id)}>{t.title}{state.drafts[t.id]&&wikiDirty(state.drafts[t.id])?' ●':''}</button>{tree(t.id,new Set([...seen,t.id]))}</li>)}</ul>}
 const topic=state.topics.find(t=>t.id===state.selected),draft=state.drafts[state.selected]
 return <div className="garden-workspace"><aside className="garden-directory" aria-label="专题目录"><h2>专题目录</h2><button onClick={()=>void book.refresh()} disabled={state.loading}>刷新目录</button><label>新专题名称<input aria-label="新专题名称" disabled={creating} value={title} maxLength={120} onChange={e=>{setTitle(e.target.value);setCreateId(crypto.randomUUID())}}/></label><label>新专题父级<select aria-label="新专题父级" disabled={creating} value={parent} onChange={e=>{setParent(e.target.value);setCreateId(crypto.randomUUID())}}><option value="">根目录</option>{state.topics.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label><button disabled={creating||!title.trim()||state.loading} onClick={()=>void create()}>创建专题</button><p role="status">{notice}</p>{!state.loading&&!state.topics.length&&<p>创建一个专题，开始积累自己的知识正文。</p>}{tree(null)}</aside>
  <div className="garden-content">{state.error&&<p role="alert">{state.error}<button onClick={()=>state.selected?void book.select(state.selected):void book.refresh()}>重试加载</button></p>}{topic&&draft?<TopicEditor key={topic.id} topic={topic} draft={draft} topics={state.topics}/>:<div className="garden-empty"><h2>{state.selected?'正在加载正文…':'让理解逐渐生长'}</h2><p>选择或创建专题，编辑 Markdown 并保存修订。也可以选材生成建议，再比较确认。</p></div>}</div>
 </div>
}
