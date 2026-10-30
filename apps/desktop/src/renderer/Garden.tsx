import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react'
import type {Revision,SourceRef,Suggestion,Topic,TopicView} from '../shared/status'
import {gardenBook,wikiDirty,type CreateDraft,type ManageDraft,type WikiDraft} from './garden-book'
import {MarkdownEditor} from './MarkdownEditor'
import {MarkdownPreview} from './MarkdownPreview'
import {SuggestionsPanel,Sources} from './SuggestionsPanel'
import {WikiReview} from './WikiReview'
import {TopicMaterialsView} from './TopicMaterials'
import {collectAncestors,defaultExpanded,parentOptions,searchTopics,topicPath,topicPathLabel} from './garden-tree'
import type {GardenTool} from './workspace-tabs'
import './notes.css'
import './garden.css'

export type GardenPage = 'topic'|'topic-create'|'topic-manage'|GardenTool
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试。'

function ToolHeader({topic,label,onBack}:{topic:Topic;label:string;onBack():void}){
 return <div className="topic-tool-header"><div className="topic-title-row"><h2>{topic.title}</h2><span className="topic-kind-chip">{label}</span></div><button onClick={onBack}>返回正文</button></div>
}

function TopicEditor({topic,draft,topics,onOpenManage,onOpenAi,onOpenHistory,onOpenMaterials}:{topic:Topic;draft:WikiDraft;topics:Topic[];onOpenManage():void;onOpenAi():void;onOpenHistory():void;onOpenMaterials():void}){
 const book=gardenBook()
 const [notice,setNotice]=useState(''),[preview,setPreview]=useState(false),[remote,setRemote]=useState<TopicView|null>(null)
 const trail=topicPath(topics,topic.id).slice(0,-1)
 async function compare(){try{setRemote(await book.latest(topic.id))}catch(e){setNotice(errorText(e))}}
 function loadLatest(){if(!wikiDirty(draft)||window.confirm('放弃当前专题未保存正文，载入最新已保存修订？'))void book.latest(topic.id).then(value=>{book.acceptLatest(value,false);setRemote(null)}).catch(e=>setNotice(errorText(e)))}
 return <div className="topic-body-view" aria-label="专题编辑">
  <header className="topic-body-header"><div className="topic-title-row"><h2>{topic.title}</h2><span className="topic-parent-path">{trail.length?trail.map(t=>t.title).join(' / '):'根目录'}</span></div></header>
  <p role="status" className="topic-body-notice">{notice}</p>
  <div className="topic-toolbar"><div role="group" aria-label="正文视图"><button aria-pressed={!preview} onClick={()=>setPreview(false)}>编辑</button><button aria-pressed={preview} onClick={()=>setPreview(true)}>预览</button></div><button className="primary" disabled={draft.saving||draft.conflict||!wikiDirty(draft)||draft.body.length>200000} onClick={()=>void book.save(topic.id)}>保存</button><button onClick={onOpenManage}>专题管理</button><button onClick={onOpenAi}>AI 优化</button><button onClick={onOpenHistory}>修订历史</button><button onClick={onOpenMaterials}>关联材料</button></div>
  <p role="status" className="wiki-status">{draft.saving?'正在保存修订…':draft.message}{wikiDirty(draft)&&' · 有未保存正文（本次会话保留）'} · {draft.body.length.toLocaleString()} / 200,000 <button type="button" className="topic-link-button" disabled={draft.saving} onClick={loadLatest}>载入最新保存正文</button></p>
  {draft.body.length>200000&&<p role="alert" className="topic-body-alert">正文超过上限，当前草稿保留，请缩短后保存。</p>}
  {draft.conflict&&<div className="note-conflict"><p>保存基线已变化，当前草稿没有被覆盖。</p><button onClick={()=>void compare()}>比较最新修订</button>{remote&&<><p>最新修订 {remote.revision.ordinal}</p><pre>{remote.revision.body_md}</pre><button onClick={()=>{book.acceptLatest(remote,true);setRemote(null)}}>保留草稿，基于最新继续</button></>}</div>}
  <div className="topic-body-editor"><div hidden={preview}><MarkdownEditor label="专题 Markdown 正文" value={draft.body} onChange={body=>book.edit(topic.id,body)} onSave={()=>void book.save(topic.id)}/></div>{preview&&<MarkdownPreview body={draft.body||'*尚无专题正文。*'}/>}</div>
 </div>
}

function TopicAi({topic,draft,onBack}:{topic:Topic;draft:WikiDraft|undefined;onBack():void}){
 const book=gardenBook(),[notice,setNotice]=useState('')
 async function review(suggestion:Suggestion){const existing=book.getSnapshot().reviews[topic.id];if(existing&&existing.body!==existing.suggestion.body_md&&!window.confirm('放弃之前对建议的未保存修改，比较这份建议？'))return;try{const current=await book.latest(topic.id);book.review(topic.id,{suggestion,current,body:suggestion.body_md,requestId:crypto.randomUUID()});setNotice('已打开比较；正文尚未变化。')}catch(e){setNotice(errorText(e))}}
 return <div className="topic-tool-view" aria-label="AI 优化"><ToolHeader topic={topic} label="AI 优化" onBack={onBack}/><div className="topic-tool-body">{draft?<><SuggestionsPanel topicId={topic.id} baseRevisionId={draft.base} dirty={wikiDirty(draft)} onReview={suggestion=>void review(suggestion)} onReviewUpdate={suggestion=>book.refreshReview(topic.id,suggestion)}/><WikiReview topicId={topic.id}/></>:<p>正在加载专题正文…</p>}<p role="status">{notice}</p></div></div>
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

function TopicTree({topics,visible,expanded,activeTopicId,drafts,onToggle,onOpen}:{topics:Topic[];visible:Set<string>;expanded:Set<string>;activeTopicId:string|null;drafts:Record<string,WikiDraft>;onToggle(id:string):void;onOpen(topic:Topic):void}){
 const children=useMemo(()=>{const map=new Map<string|null,Topic[]>();for(const topic of topics){const key=topic.parent_id&&topics.some(item=>item.id===topic.parent_id)?topic.parent_id:null;const list=map.get(key)??[];list.push(topic);map.set(key,list)}return map},[topics])
 const rendered=new Set<string>()
 function rows(parentId:string|null,depth:number):React.ReactNode{
  return (children.get(parentId)??[]).map(topic=>{
   if(rendered.has(topic.id)||!visible.has(topic.id))return null
   rendered.add(topic.id)
   const all=(children.get(topic.id)??[]).filter(item=>visible.has(item.id)),hasChildren=all.length>0,isOpen=expanded.has(topic.id)
   return <li key={topic.id} className="garden-tree-item">
    <div className="garden-tree-row" style={{paddingLeft:8+depth*16}} data-active={activeTopicId===topic.id?'true':undefined}>
     {hasChildren?<button type="button" className="garden-tree-toggle" aria-label={`${isOpen?'收起':'展开'} ${topic.title}`} aria-expanded={isOpen} onClick={()=>onToggle(topic.id)}>{isOpen?'▾':'▸'}</button>:<span className="garden-tree-spacer" aria-hidden="true"/>}
     <button type="button" className="garden-tree-name" data-topic-id={topic.id} aria-current={activeTopicId===topic.id?'true':undefined} onClick={()=>onOpen(topic)} onKeyDown={event=>{if(event.key==='ArrowRight'&&hasChildren&&!isOpen){event.preventDefault();onToggle(topic.id)}else if(event.key==='ArrowLeft'&&hasChildren&&isOpen){event.preventDefault();onToggle(topic.id)}}}>{topic.title}{drafts[topic.id]&&wikiDirty(drafts[topic.id])&&<span className="garden-tree-dirty" aria-label="有未保存正文">●</span>}</button>
    </div>
    {hasChildren&&isOpen&&<ul className="garden-tree-children">{rows(topic.id,depth+1)}</ul>}
   </li>
  })
 }
 return <ul className="garden-tree" role="tree">{rows(null,0)}</ul>
}

function TopicPathList({topics,visible,activeTopicId,drafts,onOpen}:{topics:Topic[];visible:Set<string>;activeTopicId:string|null;drafts:Record<string,WikiDraft>;onOpen(topic:Topic):void}){
 const ordered=topics.filter(topic=>visible.has(topic.id)).map(topic=>({topic,path:topicPath(topics,topic.id)})).sort((a,b)=>topicPathLabel(topics,a.topic.id).localeCompare(topicPathLabel(topics,b.topic.id),'zh-Hans-CN'))
 return <div className="garden-path-list" role="list">{ordered.map(({topic,path})=><button type="button" role="listitem" key={topic.id} data-topic-id={topic.id} aria-current={activeTopicId===topic.id?'true':undefined} className="garden-path-item" onClick={()=>onOpen(topic)}><strong>{topic.title}{drafts[topic.id]&&wikiDirty(drafts[topic.id])&&<span className="garden-tree-dirty" aria-label="有未保存正文">●</span>}</strong><small>{path.length>1?path.slice(0,-1).map(item=>item.title).join(' / '):'根目录'}</small></button>)}</div>
}

function GardenHome({topics,loading,error,view,query,onQuery,onViewChange,onOpen,onCreate,expanded,onToggle,onExpandAll,onCollapseAll,onRefresh}:{topics:Topic[];loading:boolean;error:string;view:'tree'|'paths';query:string;onQuery(value:string):void;onViewChange(view:'tree'|'paths'):void;onOpen(topic:Topic):void;onCreate():void;expanded:Set<string>;onToggle(id:string):void;onExpandAll():void;onCollapseAll():void;onRefresh():void}){
 const search=searchTopics(topics,query),visible=query.trim()?search.visible:new Set(topics.map(topic=>topic.id)),listVisible=query.trim()?search.matches:visible
 const drafts=gardenBook().getSnapshot().drafts
 return <div className="garden-home">
  <header className="garden-home-header"><div><h1>Garden</h1><p>组织专题，保存持续生长的研究正文。</p></div><span className="garden-home-count">{topics.length} 个专题</span></header>
  <div className="garden-home-toolbar"><button className="primary" onClick={onCreate}>新建专题</button><div className="garden-view-switch" role="group" aria-label="专题视图"><button aria-pressed={view==='tree'} onClick={()=>onViewChange('tree')}>层级</button><button aria-pressed={view==='paths'} onClick={()=>onViewChange('paths')}>路径</button></div><button onClick={onExpandAll}>展开全部</button><button onClick={onCollapseAll}>收起全部</button><button onClick={onRefresh} disabled={loading}>刷新</button><label className="garden-search"><span>搜索专题</span><input aria-label="搜索专题" type="search" placeholder="按名称搜索" value={query} onChange={event=>onQuery(event.target.value)}/></label></div>
  {error&&<p role="alert" className="garden-home-error">{error}<button onClick={onRefresh}>重试</button></p>}
  {loading&&!topics.length?<p className="garden-home-note">正在加载专题…</p>:!topics.length?<div className="garden-empty"><h2>建立你的第一个研究专题</h2><p>专题用来组织文献材料和持续修订的 Wiki 正文。</p><button className="primary" onClick={onCreate}>新建专题</button></div>:query.trim()&&!search.matches.size?<div className="garden-empty"><h2>没有匹配的专题</h2><p>尝试其他名称，或清空搜索查看全部专题。</p><button onClick={()=>onQuery('')}>清空搜索</button></div>:<div className="garden-index">{view==='tree'?<TopicTree topics={topics} visible={visible} expanded={expanded} activeTopicId={null} drafts={drafts} onToggle={onToggle} onOpen={onOpen}/>:<TopicPathList topics={topics} visible={listVisible} activeTopicId={null} drafts={drafts} onOpen={onOpen}/>}</div>}
 </div>
}

function CreateTopicView({topics,draft,creating,notice,onCreate,onCancel}:{topics:Topic[];draft:CreateDraft|null;creating:boolean;notice:string;onCreate():void;onCancel():void}){
 const book=gardenBook(),options=parentOptions(topics)
 return <div className="topic-form-view" aria-label="新建专题">
  <header className="topic-form-header"><p className="topic-parent-path">Garden / 新建专题</p><h2>新建专题</h2><p>先建立目录位置，创建后继续写正文。</p></header>
  {draft&&<form className="topic-form" onSubmit={event=>{event.preventDefault();onCreate()}}><label>名称<input aria-label="新专题名称" disabled={creating} maxLength={120} value={draft.title} onChange={event=>book.editCreate('title',event.target.value)}/></label><label>父级<select aria-label="新专题父级" disabled={creating} value={draft.parent_id} onChange={event=>book.editCreate('parent_id',event.target.value)}><option value="">根目录</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label><div className="actions"><button className="primary" disabled={creating||!draft.title.trim()}>创建专题</button><button type="button" disabled={creating} onClick={onCancel}>取消</button></div></form>}
  <p role="status">{notice}</p>
 </div>
}

function ManageTopicView({topic,topics,draft,busy,notice,onSave,onBack}:{topic:Topic;topics:Topic[];draft:ManageDraft|undefined;busy:boolean;notice:string;onSave():void;onBack():void}){
 const book=gardenBook(),options=parentOptions(topics,topic.id),path=topicPathLabel(topics,topic.id)
 return <div className="topic-form-view" aria-label="专题管理">
  <header className="topic-form-header"><p className="topic-parent-path">{path}</p><h2>专题管理</h2><p>名称和父级属于目录信息，不修改正文、修订或来源。</p></header>
  {draft&&<form className="topic-form" onSubmit={event=>{event.preventDefault();onSave()}}><label>名称<input aria-label="专题管理名称" disabled={busy} maxLength={120} value={draft.title} onChange={event=>book.editManage(topic.id,'title',event.target.value)}/></label><label>父级<select aria-label="专题管理父级" disabled={busy} value={draft.parent_id} onChange={event=>book.editManage(topic.id,'parent_id',event.target.value)}><option value="">根目录</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label><small>不能移入自身或后代；移动不会改变文献、正文和来源。</small><div className="actions"><button className="primary" disabled={busy||!draft.title.trim()}>保存目录信息</button><button type="button" disabled={busy} onClick={onBack}>返回正文</button></div></form>}
  <p role="status">{notice}</p>
 </div>
}

export function Garden({activeTopicId,activePage,onOpenTopic,onOpenTool,onCollapseTool,onOpenCreate,onCloseCreate,onCreateComplete,onOpenManage,onCloseManage,directoryCollapsed,onToggleDirectory,view,onViewChange,expanded,onExpandedChange,onTitles}:{
 activeTopicId:string|null
 activePage:GardenPage|null
 onOpenTopic(topic:Topic):void
 onOpenTool(tool:GardenTool,topic:Topic):void
 onCollapseTool(tool:GardenTool,topic:Topic):void
 onOpenCreate(parentId?:string|null):void
 onCloseCreate():void
 onCreateComplete(topic:Topic):void
 onOpenManage(topic:Topic):void
 onCloseManage(topic:Topic):void
 directoryCollapsed:boolean
 onToggleDirectory():void
 view:'tree'|'paths'
 onViewChange(view:'tree'|'paths'):void
 expanded:string[]|null
 onExpandedChange(ids:string[]):void
 onTitles(topics:Topic[]):void
}){
 const book=gardenBook(),state=useSyncExternalStore(book.subscribe,book.getSnapshot)
 const [query,setQuery]=useState(''),[creating,setCreating]=useState(false),[createNotice,setCreateNotice]=useState(''),[manageNotice,setManageNotice]=useState(''),[managing,setManaging]=useState(false)
 useEffect(()=>{void book.refresh()},[book])
 useEffect(()=>{onTitles(state.topics)},[onTitles,state.topics])
 useEffect(()=>{if(activePage&&activePage!=='topic-create'&&activeTopicId&&state.selected!==activeTopicId)void book.select(activeTopicId)},[activePage,activeTopicId,state.selected,book])
 useEffect(()=>{if(activePage==='topic-create'&&!state.create)book.startCreate(null)},[activePage,state.create,book])
 useEffect(()=>{if(activePage==='topic-manage'&&activeTopicId)book.manage(activeTopicId)},[activePage,activeTopicId,state.topics])
 const effectiveExpanded=useMemo(()=>new Set((expanded??defaultExpanded(state.topics)).filter(id=>state.topics.some(topic=>topic.id===id))),[expanded,state.topics])
 const search=searchTopics(state.topics,query),treeExpanded=useMemo(()=>{const next=new Set(effectiveExpanded);if(query.trim())search.ancestors.forEach(id=>next.add(id));return next},[effectiveExpanded,query,search.ancestors])
 useEffect(()=>{if(activePage==='topic'&&activeTopicId){const ancestors=collectAncestors(state.topics,activeTopicId);if([...ancestors].some(id=>!effectiveExpanded.has(id))){const next=new Set(effectiveExpanded);ancestors.forEach(id=>next.add(id));onExpandedChange([...next])}}},[activePage,activeTopicId,state.topics.length])
 function toggle(id:string){const next=new Set(effectiveExpanded);if(next.has(id))next.delete(id);else next.add(id);onExpandedChange([...next])}
 function expandAll(){onExpandedChange(state.topics.map(topic=>topic.id))}
 function collapseAll(){onExpandedChange([])}
 async function create(){if(!state.create)return;setCreating(true);setCreateNotice('');try{const created=await book.createFromDraft();const topics=book.getSnapshot().topics;const ancestors=collectAncestors(topics,created.id),next=new Set(effectiveExpanded);ancestors.forEach(id=>next.add(id));onExpandedChange([...next]);onCreateComplete(created)}catch(e){setCreateNotice(errorText(e))}finally{setCreating(false)}}
 async function saveManage(topic:Topic){setManaging(true);setManageNotice('');try{await book.saveManage(topic.id);setManageNotice('目录信息已保存。')}catch(e){setManageNotice(errorText(e))}finally{setManaging(false)}}
 const topic=activeTopicId?state.topics.find(item=>item.id===activeTopicId):undefined,draft=activeTopicId?state.drafts[activeTopicId]:undefined
 const drafts=state.drafts
 if(!activePage)return <GardenHome topics={state.topics} loading={state.loading} error={state.error} view={view} query={query} onQuery={setQuery} onViewChange={onViewChange} onOpen={onOpenTopic} onCreate={()=>onOpenCreate(null)} expanded={treeExpanded} onToggle={toggle} onExpandAll={expandAll} onCollapseAll={collapseAll} onRefresh={()=>void book.refresh()}/>
 if(activePage==='topic-create')return <CreateTopicView topics={state.topics} draft={state.create} creating={creating} notice={createNotice} onCreate={()=>void create()} onCancel={onCloseCreate}/>
 if(activePage==='topic-manage')return topic?<ManageTopicView topic={topic} topics={state.topics} draft={state.manage[topic.id]} busy={managing} notice={manageNotice} onSave={()=>void saveManage(topic)} onBack={()=>onCloseManage(topic)}/>:<div className="garden-empty"><h2>{state.loading?'正在加载专题…':'专题暂不可用'}</h2><p>该专题不在当前目录中，可能已被移除。</p><button onClick={()=>void book.refresh()}>刷新目录</button></div>
 if(activePage==='ai'||activePage==='history'||activePage==='materials')return topic?<div className="garden-tool-page">{activePage==='ai'?<TopicAi topic={topic} draft={draft} onBack={()=>onCollapseTool('ai',topic)}/>:activePage==='history'?<TopicHistory topic={topic} draft={draft} onBack={()=>onCollapseTool('history',topic)}/>:<TopicMaterialsView key={topic.id} topic={topic} onBack={()=>onCollapseTool('materials',topic)}/>}</div>:<div className="garden-empty"><h2>专题暂不可用</h2><button onClick={()=>void book.refresh()}>刷新目录</button></div>
 if(!topic||!draft)return <div className="garden-empty"><h2>{state.loading?'正在加载正文…':'专题暂不可用'}</h2><p>{state.loading?'正在读取专题目录。':'该专题不在当前目录中，可能已被移除；请刷新目录后重试。'}</p><button onClick={()=>void book.refresh()}>刷新目录</button></div>
 return <div className={`garden-workspace${directoryCollapsed?' collapsed':''}`}>
  {!directoryCollapsed&&<aside className="garden-directory" aria-label="专题目录"><div className="garden-directory-header"><h2>专题</h2><button onClick={onToggleDirectory}>收起目录</button></div><label className="garden-search"><span>搜索专题</span><input aria-label="搜索专题" type="search" placeholder="按名称搜索" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="garden-directory-actions"><button className="primary" onClick={()=>onOpenCreate(activeTopicId)}>新建专题</button><button onClick={()=>void book.refresh()} disabled={state.loading}>刷新</button></div>{query.trim()&&!search.matches.size?<p className="garden-directory-note">没有匹配的专题。</p>:<TopicTree topics={state.topics} visible={query.trim()?search.visible:new Set(state.topics.map(item=>item.id))} expanded={treeExpanded} activeTopicId={activeTopicId} drafts={drafts} onToggle={toggle} onOpen={onOpenTopic}/>}</aside>}
  <div className="garden-content">{directoryCollapsed&&<div className="garden-content-bar"><button onClick={onToggleDirectory}>展开目录</button><span>{topic.title}</span></div>}{state.error&&<p role="alert">{state.error}<button onClick={()=>void book.refresh()}>重试加载</button></p>}<TopicEditor topic={topic} draft={draft} topics={state.topics} onOpenManage={()=>onOpenManage(topic)} onOpenAi={()=>onOpenTool('ai',topic)} onOpenHistory={()=>onOpenTool('history',topic)} onOpenMaterials={()=>onOpenTool('materials',topic)}/></div>
 </div>
}
