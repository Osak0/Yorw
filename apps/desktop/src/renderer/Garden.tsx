import React,{useEffect,useState,useSyncExternalStore} from 'react'
import type {Revision,SourceRef,Suggestion,Topic,TopicView} from '../shared/status'
import {gardenBook,wikiDirty,type WikiDraft} from './garden-book'
import {MarkdownEditor} from './MarkdownEditor'
import {MarkdownPreview} from './MarkdownPreview'
import {SuggestionsPanel,Sources} from './SuggestionsPanel'
import {WikiReview} from './WikiReview'
import {TopicMaterialsView} from './TopicMaterials'
import type {GardenTool} from './workspace-tabs'
import './notes.css'
import './garden.css'

function descendants(topics:Topic[],id:string){const found=new Set([id]);let changed=true;while(changed){changed=false;for(const t of topics)if(t.parent_id&&found.has(t.parent_id)&&!found.has(t.id)){found.add(t.id);changed=true}}return found}
function pathTo(topics:Topic[],topic:Topic){const chain:Topic[]=[];const seen=new Set<string>();let current:Topic|undefined=topic;while(current&&!seen.has(current.id)){seen.add(current.id);chain.unshift(current);current=current.parent_id?topics.find(item=>item.id===current!.parent_id):undefined}return chain}
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试。'

function ToolHeader({topic,label,onBack}:{topic:Topic;label:string;onBack():void}){
 return <div className="topic-tool-header"><div className="topic-title-row"><h2>{topic.title}</h2><span className="topic-kind-chip">{label}</span></div><button onClick={onBack}>返回正文</button></div>
}

function TopicEditor({topic,draft,topics,onOpenAi,onOpenHistory,onOpenMaterials}:{topic:Topic;draft:WikiDraft;topics:Topic[];onOpenAi():void;onOpenHistory():void;onOpenMaterials():void}){
 const book=gardenBook()
 const [title,setTitle]=useState(topic.title),[parent,setParent]=useState(topic.parent_id??''),[version,setVersion]=useState(topic.version)
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false),[remote,setRemote]=useState<TopicView|null>(null)
 useEffect(()=>{if(title===topic.title&&parent===(topic.parent_id??''))setVersion(topic.version)},[topic.version,topic.title,topic.parent_id,title,parent])
 const excluded=descendants(topics,topic.id),trail=pathTo(topics,topic).slice(0,-1)
 async function metadata(){setBusy(true);setNotice('');try{await book.metadata(topic.id,title,parent||null,version);const updated=book.getSnapshot().topics.find(t=>t.id===topic.id)!;setTitle(updated.title);setParent(updated.parent_id??'');setVersion(updated.version);setNotice('目录信息已保存。')}catch(e){setNotice(errorText(e))}finally{setBusy(false)}}
 async function loadDirectory(){await book.refresh();const current=book.getSnapshot().topics.find(t=>t.id===topic.id);if(current){setTitle(current.title);setParent(current.parent_id??'');setVersion(current.version);setNotice('已载入当前目录信息，正文草稿保持。')}}
 async function compare(){try{setRemote(await book.latest(topic.id))}catch(e){setNotice(errorText(e))}}
 function loadLatest(){if(!wikiDirty(draft)||window.confirm('放弃当前专题未保存正文，载入最新已保存修订？'))void book.latest(topic.id).then(value=>{book.acceptLatest(value,false);setRemote(null)}).catch(e=>setNotice(errorText(e)))}
 return <div className="topic-body-view" aria-label="专题编辑">
  <header className="topic-body-header"><div className="topic-title-row"><h2>{topic.title}</h2><span className="topic-parent-path">{trail.length?trail.map(t=>t.title).join(' / '):'根目录'}</span></div>
   <details className="topic-metadata"><summary>名称与父级</summary><div className="topic-metadata-form"><label>名称<input aria-label="专题名称" disabled={busy} maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>父级<select aria-label="专题父级" disabled={busy} value={parent} onChange={e=>setParent(e.target.value)}><option value="">根目录</option>{topics.filter(t=>!excluded.has(t.id)).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><div className="actions"><button disabled={busy||!title.trim()} onClick={()=>void metadata()}>保存目录信息</button><button disabled={busy} onClick={()=>void loadDirectory()}>载入当前目录信息</button></div><small>目录变更需单独保存；不能移入自身或后代。</small></div></details>
  </header>
  <p role="status" className="topic-body-notice">{notice}</p>
  <div className="topic-toolbar"><div role="group" aria-label="正文视图"><button aria-pressed={!preview} onClick={()=>setPreview(false)}>编辑</button><button aria-pressed={preview} onClick={()=>setPreview(true)}>预览</button></div><button className="primary" disabled={draft.saving||draft.conflict||!wikiDirty(draft)||draft.body.length>200000} onClick={()=>void book.save(topic.id)}>保存</button><button onClick={onOpenAi}>AI 优化</button><button onClick={onOpenHistory}>修订历史</button><button onClick={onOpenMaterials}>关联材料</button></div>
  <p role="status" className="wiki-status">{draft.saving?'正在保存修订…':draft.message}{wikiDirty(draft)&&' · 有未保存正文（本次会话保留）'} · {draft.body.length.toLocaleString()} / 200,000 <button type="button" className="topic-link-button" disabled={draft.saving} onClick={loadLatest}>载入最新保存正文</button></p>
  {draft.body.length>200000&&<p role="alert" className="topic-body-alert">正文超过上限，当前草稿保留，请缩短后保存。</p>}
  {draft.conflict&&<div className="note-conflict"><p>保存基线已变化，当前草稿没有被覆盖。</p><button onClick={()=>void compare()}>比较最新修订</button>{remote&&<><p>最新修订 {remote.revision.ordinal}</p><pre>{remote.revision.body_md}</pre><button onClick={()=>{book.acceptLatest(remote,true);setRemote(null)}}>保留草稿，基于最新继续</button></>}</div>}
  <div className="topic-body-editor"><div hidden={preview}><MarkdownEditor label="专题 Markdown 正文" value={draft.body} onChange={body=>book.edit(topic.id,body)} onSave={()=>void book.save(topic.id)}/></div>{preview&&<MarkdownPreview body={draft.body||'*尚无专题正文。*'}/>}</div>
 </div>
}

function TopicAi({topic,draft,onBack}:{topic:Topic;draft:WikiDraft|undefined;onBack():void}){
 const book=gardenBook(),[notice,setNotice]=useState('')
 async function review(suggestion:Suggestion){const existing=book.getSnapshot().reviews[topic.id];if(existing&&existing.body!==existing.suggestion.body_md&&!window.confirm('放弃之前对建议的未保存修改，比较这份建议？'))return;try{const current=await book.latest(topic.id);book.review(topic.id,{suggestion,current,body:suggestion.body_md,requestId:crypto.randomUUID()});setNotice('已打开比较；正文尚未变化。')}catch(e){setNotice(errorText(e))}}
 return <div className="topic-tool-view" aria-label="AI 优化"><ToolHeader topic={topic} label="AI 优化" onBack={onBack}/><div className="topic-tool-body">{draft?<><SuggestionsPanel topicId={topic.id} baseRevisionId={draft.base} dirty={wikiDirty(draft)} onReview={suggestion=>void review(suggestion)}/><WikiReview topicId={topic.id}/></>:<p>正在加载专题正文…</p>}<p role="status">{notice}</p></div></div>
}

function TopicHistory({topic,draft,onBack}:{topic:Topic;draft:WikiDraft|undefined;onBack():void}){
 const book=gardenBook()
 const [history,setHistory]=useState<Revision[]|null>(null),[chosen,setChosen]=useState(''),[restoring,setRestoring]=useState<{target:Revision;current:TopicView;requestId:string}|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 async function loadHistory(){setBusy(true);try{const result=await window.yorw.garden.history(topic.id);if(result.ok){setHistory(result.value.items);setChosen(result.value.items[0]?.id??'')}else setNotice(`历史加载失败（${result.code}）`)}catch{setNotice('历史加载失败。')}finally{setBusy(false)}}
 useEffect(()=>{void loadHistory()},[topic.id])
 async function prepareRestore(target:Revision){try{setRestoring({target,current:await book.latest(topic.id),requestId:crypto.randomUUID()})}catch(e){setNotice(errorText(e))}}
 async function restore(){if(!restoring)return;try{await book.restore(topic.id,restoring.target.id,{base_revision_id:restoring.current.revision.id,request_id:restoring.requestId});setRestoring(null);await loadHistory();setNotice('已回退为新修订，原历史保留。')}catch(e){setNotice(errorText(e))}}
 const old=history?.find(revision=>revision.id===chosen),dirty=!draft||wikiDirty(draft)||draft.saving
 return <div className="topic-tool-view" aria-label="修订历史"><ToolHeader topic={topic} label="修订历史" onBack={onBack}/><div className="topic-tool-body">
  <div className="topic-history-toolbar"><button disabled={busy} onClick={()=>void loadHistory()}>刷新修订历史</button><p role="status">{notice}</p></div>
  {history?history.length?<><label>历史修订<select aria-label="历史修订" value={chosen} onChange={event=>setChosen(event.target.value)}>{history.map(revision=><option key={revision.id} value={revision.id}>修订 {revision.ordinal} · {revision.origin} · {revision.created_at}</option>)}</select></label>{old&&<section className="topic-history-revision"><p>只读快照；查看历史不会覆盖当前草稿。回退会创建新修订并恢复该版本的来源快照。</p><MarkdownPreview body={old.body_md||'*空白初始修订。*'}/><Sources sources={old.sources as SourceRef[]}/><button disabled={dirty} onClick={()=>void prepareRestore(old)}>比较并回退此修订</button></section>}</>:<p>暂无修订。</p>:<p>正在加载修订历史…</p>}
  {restoring&&<section className="wiki-review" aria-label="回退确认"><h3>确认回退</h3><p>当前修订 {restoring.current.revision.ordinal} → 复制历史修订 {restoring.target.ordinal} 为新修订；历史及来源快照保留，失效来源不会恢复为可用。</p><div className="wiki-compare"><div><h4>当前已保存正文</h4><pre>{restoring.current.revision.body_md||'空白正文'}</pre></div><div><h4>将恢复的正文</h4><pre>{restoring.target.body_md||'空白正文'}</pre></div></div><button className="primary" disabled={dirty||draft?.base!==restoring.current.revision.id} onClick={()=>void restore()}>确认回退为新修订</button><button disabled={draft?.saving} onClick={()=>setRestoring(null)}>取消回退</button></section>}
 </div></div>
}

export function Garden({activeTopicId,activeTool,onOpenTopic,onOpenTool,onCollapseTool,directoryCollapsed,onToggleDirectory,onTitles}:{activeTopicId:string|null;activeTool:'topic'|GardenTool|null;onOpenTopic(topic:Topic):void;onOpenTool(tool:GardenTool,topic:Topic):void;onCollapseTool(tool:GardenTool,topic:Topic):void;directoryCollapsed:boolean;onToggleDirectory():void;onTitles(topics:Topic[]):void}){
 const book=gardenBook(),state=useSyncExternalStore(book.subscribe,book.getSnapshot)
 const [creatingOpen,setCreatingOpen]=useState(false),[title,setTitle]=useState(''),[parent,setParent]=useState(''),[creating,setCreating]=useState(false),[notice,setNotice]=useState(''),[createId,setCreateId]=useState(()=>crypto.randomUUID())
 useEffect(()=>{void book.refresh()},[book])
 useEffect(()=>{onTitles(state.topics)},[onTitles,state.topics])
 useEffect(()=>{if(activeTopicId&&state.selected!==activeTopicId)void book.select(activeTopicId)},[activeTopicId,state.selected,book])
 async function create(){setCreating(true);try{const created=await book.create(title,parent||null,createId);setTitle('');setParent('');setCreateId(crypto.randomUUID());setCreatingOpen(false);setNotice('专题已创建，初始空白修订已保存。');onOpenTopic(created)}catch(e){setNotice(errorText(e))}finally{setCreating(false)}}
 function tree(parentId:string|null,seen=new Set<string>()):React.ReactNode{return <ul>{state.topics.filter(t=>t.parent_id===parentId).map(t=>seen.has(t.id)?null:<li key={t.id}><button data-topic-id={t.id} aria-current={activeTopicId===t.id?'true':undefined} onClick={()=>onOpenTopic(t)}>{t.title}{state.drafts[t.id]&&wikiDirty(state.drafts[t.id])?' ●':''}</button>{tree(t.id,new Set([...seen,t.id]))}</li>)}</ul>}
 const topic=activeTopicId?state.topics.find(t=>t.id===activeTopicId):undefined,draft=activeTopicId?state.drafts[activeTopicId]:undefined,tool=activeTool??'topic'
 return <div className={`garden-workspace${directoryCollapsed?' collapsed':''}`}>
  {!directoryCollapsed&&<aside className="garden-directory" aria-label="专题目录"><div className="garden-directory-header"><h2>专题目录</h2><div className="garden-directory-actions"><button onClick={()=>setCreatingOpen(value=>!value)}>{creatingOpen?'收起':'新建'}</button><button onClick={()=>void book.refresh()} disabled={state.loading}>刷新</button></div></div>
   {creatingOpen&&<form className="garden-create" onSubmit={event=>{event.preventDefault();void create()}}><label>名称<input aria-label="新专题名称" disabled={creating} maxLength={120} value={title} onChange={e=>{setTitle(e.target.value);setCreateId(crypto.randomUUID())}}/></label><label>父级<select aria-label="新专题父级" disabled={creating} value={parent} onChange={e=>{setParent(e.target.value);setCreateId(crypto.randomUUID())}}><option value="">根目录</option>{state.topics.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label><div className="actions"><button className="primary" disabled={creating||!title.trim()||state.loading}>创建专题</button><button type="button" onClick={()=>setCreatingOpen(false)}>取消</button></div></form>}
   <p role="status">{notice}</p>{!state.loading&&!state.topics.length&&<p>创建一个专题，开始积累自己的知识正文。</p>}{tree(null)}</aside>}
  <div className="garden-content"><div className="garden-content-bar"><span>{activeTopicId?(tool==='ai'?'AI 优化':tool==='history'?'修订历史':tool==='materials'?'关联材料':'专题正文'):'专题目录'}</span><button onClick={onToggleDirectory}>{directoryCollapsed?'展开目录':'收起目录'}</button></div>
   {state.error&&<p role="alert">{state.error}<button onClick={()=>activeTopicId?void book.select(activeTopicId):void book.refresh()}>重试加载</button></p>}
   {!activeTopicId?<div className="garden-empty"><h2>专题目录</h2><p>从左侧选择专题，或新建专题开始编辑。</p></div>:topic&&draft?(tool==='ai'?<TopicAi topic={topic} draft={draft} onBack={()=>onCollapseTool('ai',topic)}/>:tool==='history'?<TopicHistory topic={topic} draft={draft} onBack={()=>onCollapseTool('history',topic)}/>:tool==='materials'?<TopicMaterialsView key={topic.id} topic={topic} onBack={()=>onCollapseTool('materials',topic)}/>:<TopicEditor topic={topic} draft={draft} topics={state.topics} onOpenAi={()=>onOpenTool('ai',topic)} onOpenHistory={()=>onOpenTool('history',topic)} onOpenMaterials={()=>onOpenTool('materials',topic)}/>):<div className="garden-empty"><h2>{state.loading?'正在加载正文…':'专题暂不可用'}</h2><p>{state.loading?'正在读取专题目录。':'该专题不在当前目录中，可能已被移除；请刷新目录后重试。'}</p><button onClick={()=>void book.refresh()}>刷新目录</button></div>}
  </div>
 </div>
}
