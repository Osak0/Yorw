import {openResearch} from './research-launch'
import React,{useContext,useEffect,useRef,useState} from 'react'
import type {CollaborationProposal,RelationCandidate} from '../shared/status'
import {MarkdownPreview} from './MarkdownPreview'
import {SourceNavigationContext} from './source-navigation'

const errors:Record<string,string>={PROPOSAL_STALE:'资料、范围或研究背景已变化，此方案不能采纳。',PROPOSAL_CONFLICT:'方案状态已变化，请刷新。',SOURCE_UNAVAILABLE:'来源失效，请重新核对资料后生成。',UNDO_CONFLICT:'成果已有后续修改，整组撤回已停止，修改已保留。',UNDO_DEPENDENCY:'成果已被其他资料引用，不能直接删除。',RESEARCH_AGAIN_REQUIRED:'背景或来源已变化，请重新发起研究，再生成方案。',EMPTY_SELECTION:'请选择至少一个不缺少前置项的操作。',REWRITE_NOT_EXPLICIT:'重写需要明确指定笔记并提出重写要求。',OUT_OF_SCOPE:'操作对象不在当前研究范围。'}
const explain=(code:string)=>errors[code]??`操作未完成（${code}），正式资料保持原样。`
const labels:Record<string,string>={create_topic:'新建专题',create_note:'新增笔记',append_note:'追加笔记',rewrite_note:'重写笔记',link:'建立关系',unlink:'解除关系'}

/** Operations arrive in prerequisite order, as validated by the preview service. */
export function selectProposalOperation(operations: Pick<CollaborationProposal['operations'][number], 'key'|'depends_on'>[], selected:string[], key:string, checked:boolean):string[]{
 const next=new Set(selected)
 if(checked){
  const required=new Set([key])
  for(const op of [...operations].reverse())if(required.has(op.key))for(const dep of op.depends_on)required.add(dep)
  for(const requiredKey of required)next.add(requiredKey)
 }else{
  next.delete(key)
  for(const op of operations)if(op.depends_on.some(dep=>!next.has(dep)))next.delete(op.key)
 }
 return operations.filter(op=>next.has(op.key)).map(op=>op.key)
}

export function ProposalCard({initial,onChanged}:{initial:CollaborationProposal;onChanged:()=>void}){
 const navigate=useContext(SourceNavigationContext)
 const [item,setItem]=useState(initial),[selected,setSelected]=useState(()=>initial.status==='pending'?initial.operations.map(o=>o.key):initial.decision?.selected??[]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const retry=useRef<{action:string;key:string;version:number;selected:string[]}|null>(null)
 useEffect(()=>{setItem(initial);if(initial.status!=='pending')setSelected(initial.decision?.selected??[])},[initial])
 function toggle(key:string,checked:boolean){retry.current=null;setSelected(selectProposalOperation(item.operations,selected,key,checked));setNotice(checked?'已同时选择全部前置操作。':'已同时取消依赖该项的操作；独立项仍可选择。')}
 async function act(action:'accept'|'reject'|'undo'|'repair'){
  if(busy)return
  if(action==='undo'&&!window.confirm('撤回本方案全部已采纳操作？若存在后续编辑或新增引用，整组撤回会停止。'))return
  setBusy(true);setNotice('')
  const request=retry.current?.action===action?retry.current:{action,key:crypto.randomUUID(),version:item.version,selected:[...selected]};retry.current=request
  try{const result=await window.yorw.collaboration.decide({id:item.id,action,version:request.version,request_id:request.key,selected:request.selected});if(result.ok){setItem(result.value);setSelected(result.value.status==='pending'?result.value.operations.map(o=>o.key):result.value.decision?.selected??[]);retry.current=null;setNotice(action==='repair'?'已按当前资料重新生成预览，请核对差异后选择采纳。':action==='accept'?'所选操作已整组采纳。':action==='undo'?'已撤回，修订和决定记录保留。':'已拒绝，正式资料未修改。');window.dispatchEvent(new Event('formal-materials-changed'));onChanged()}else setNotice(explain(result.code))}catch{setNotice('连接中断，重试将复用请求，避免重复创建。')}finally{setBusy(false)}
 }
 return <section className="collaboration-card" aria-label="资料修改方案"><header><strong>资料修改方案</strong><span>{({pending:'待采纳',accepted:'已采纳',rejected:'已拒绝',undone:'已撤回'} as Record<string,string>)[item.status]}</span></header>{item.stale&&<p role="status">{explain(item.conflict??'PROPOSAL_STALE')}</p>}
 {item.operations.map(op=><div key={op.key} data-operation-key={op.key} className="collaboration-operation"><label><input type="checkbox" checked={selected.includes(op.key)} disabled={busy||item.status!=='pending'||item.stale} onChange={e=>toggle(op.key,e.target.checked)}/>{labels[op.action]} · {op.title||op.target_title||op.target||`${op.first_title||op.first} → ${op.second_title||op.second}`} {item.status==='accepted'&&!selected.includes(op.key)&&<small>未采纳</small>}</label><p>{op.reason}</p>{op.action==='create_topic'&&!op.owner&&<small>归属：根目录</small>}{op.owner&&<small>归属：{op.owner_title||item.operations.find(o=>'$'+o.key===op.owner)?.title||op.owner}</small>}{op.depends_on.length>0&&<p>依赖：{op.depends_on.map(key=>item.operations.find(o=>o.key===key)?.title||key).join('、')}</p>}{op.body_md&&<details><summary>查看正文与差异</summary><MarkdownPreview body={op.after_body}/><pre>{op.diff||'正文无变化'}</pre>{item.sources.length>0&&<div><strong>本次新增内容的来源</strong>{item.sources.map((source,index)=><div key={source.citation}><p>[{op.source_citations?.[index]??source.citation}] {source.title} · {source.kind==='document'?'原文片段':'笔记认识，非论文事实'}</p><blockquote>{source.text}</blockquote>{source.kind==='document'&&source.document_id&&<button disabled={item.stale} onClick={()=>navigate(source.document_id!,{page:source.page,block_id:source.block_id,evidence:source.text})}>查看原文依据</button>}</div>)}</div>}</details>}</div>)}
 {item.sources.length>0&&!item.operations.some(op=>op.body_md)&&<details><summary>查看方案来源</summary>{item.sources.map(source=><div key={source.citation}><strong>[{source.citation}] {source.title}</strong><small>{source.kind==='document'?'原文片段':'笔记记录／历史认识，非论文事实'}</small><p>{source.text}</p>{source.kind==='document'&&source.document_id&&<button onClick={()=>navigate(source.document_id!,{page:source.page,block_id:source.block_id,evidence:source.text})}>查看原文依据</button>}</div>)}</details>}
 <div className="collaboration-actions">{item.status==='pending'&&<><button className="primary" disabled={busy||item.stale||!selected.length} onClick={()=>void act('accept')}>采纳所选</button><button disabled={busy} onClick={()=>void act('reject')}>拒绝方案</button>{item.stale&&<button disabled={busy} onClick={()=>void act('repair')}>按当前资料重新预览</button>}</>}{item.status==='accepted'&&<button disabled={busy} onClick={()=>void act('undo')}>撤回本次采纳</button>}<button disabled={busy} onClick={()=>void window.yorw.collaboration.get(item.id).then(r=>{if(r.ok)setItem(r.value)})}>刷新方案</button></div><p role="status">{notice}</p>{(notice.includes('后续修改')||notice.includes('其他资料引用'))&&<button onClick={()=>openResearch('请核对当前资料，为无法撤回的方案 '+item.id+' 提出修复建议，不覆盖后续编辑。原操作：'+item.operations.map(o=>o.action+' '+(o.title||o.target||o.first+' → '+o.second)).join('；'),{mode:'workspace',topic_id:null})}>向研究助理请求修复建议</button>}</section>
}

export function ProposalList({taskId,documentId,topicId}:{taskId?:string;documentId?:string;topicId?:string}){
 const [items,setItems]=useState<CollaborationProposal[]>([])
 async function load(){const result=await window.yorw.collaboration.list({task_id:taskId,document_id:documentId,topic_id:topicId});if(result.ok)setItems(result.value.items)}
 useEffect(()=>{let live=true;const refresh=()=>{if(live)void load()};refresh();const timer=setInterval(refresh,1800);return()=>{live=false;clearInterval(timer)}},[taskId,documentId,topicId])
 return <>{items.map(item=><ProposalCard key={item.id} initial={item} onChanged={()=>void load()}/>)}</>
}

export function TopicRelations({topicId,onOpen}:{topicId:string;onOpen:(id:string)=>void}){
 const [items,setItems]=useState<{id:string;title:string;description:string}[]>([]),[candidates,setCandidates]=useState<RelationCandidate[]>([]),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState<CollaborationProposal|null>(null),[busy,setBusy]=useState(false)
 async function load(){const result=await window.yorw.collaboration.topics(topicId);if(result.ok)setItems(result.value.items)}
 useEffect(()=>{void load();const refresh=()=>void load();window.addEventListener('formal-materials-changed',refresh);return()=>window.removeEventListener('formal-materials-changed',refresh)},[topicId])
 async function propose(other:string,action:'link'|'unlink',reason:string){setBusy(true);try{const result=await window.yorw.collaboration.preview({request_id:crypto.randomUUID(),topic_id:topicId,operations:[{key:'relation',action,first_kind:'topic',first:topicId,second_kind:'topic',second:other,reason}]});if(result.ok)setPreview(result.value);else setNotice(explain(result.code))}finally{setBusy(false)}}
 return <section aria-label="专题普通关联"><h3>专题关联 · {items.length}</h3><p>普通关联独立于父子目录，也不改变笔记与 AI 范围。</p><ul className="topic-overview-list">{items.map(item=><li key={item.id}><button onClick={()=>onOpen(item.id)}>{item.title}</button><p>{item.description}</p><button disabled={busy} onClick={()=>void propose(item.id,'unlink','用户解除专题普通关联')}>预览解除关联</button></li>)}</ul><input aria-label="专题关联检索" value={query} maxLength={200} placeholder="输入相关内容词" onChange={e=>setQuery(e.target.value)}/><button disabled={busy} onClick={()=>{setBusy(true);void window.yorw.collaboration.candidates({kind:'topic',id:topicId,query}).then(r=>{if(r.ok){const found=r.value.items.filter(i=>i.kind==='topic');setCandidates(found);setNotice(found.length?'选择候选后预览。':'没有相关专题候选。')}else setNotice(explain(r.code))}).finally(()=>setBusy(false))}}>查找关联专题</button>{candidates.map(item=><div key={item.id}><strong>{item.title}</strong><p>{item.reason}</p><button disabled={busy} onClick={()=>void propose(item.id,'link',item.reason)}>预览建立关联</button></div>)}<p role="status">{notice}</p>{preview&&<ProposalCard key={preview.id} initial={preview} onChanged={()=>void load()}/>}<details><summary>此前方案与撤回</summary><ProposalList topicId={topicId}/></details></section>
}

/** Shared entrypoint: a new topic and its document link are one selectable plan. */
export function DocumentCollaboration({documentId,onChanged,suggestedTopics=[],enrichmentId,suggestedLinks,sourceVersion}:{documentId:string;onChanged:()=>void;suggestedTopics?:{title:string;reason:string}[];enrichmentId?:number;sourceVersion:number;suggestedLinks?:{related?:{id:string;title:string;version:number;reason:string}[];topics?:{id:string;title:string;version:number;reason:string}[]}}){
 const [query,setQuery]=useState(''),[title,setTitle]=useState(''),[items,setItems]=useState<RelationCandidate[]>([]),[picked,setPicked]=useState(new Set<string>()),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<CollaborationProposal|null>(null)
 useEffect(()=>{const candidates:RelationCandidate[]=[...(suggestedLinks?.related??[]).map(i=>({...i,kind:'document' as const})),...(suggestedLinks?.topics??[]).map(i=>({...i,kind:'topic' as const}))].map(i=>({...i,excerpt:'AI 组织建议，采纳前请核对。',source:{kind:'document',id:documentId,version:sourceVersion}}));setItems(candidates);setPicked(new Set())},[documentId,enrichmentId])
 async function search(){setBusy(true);try{const r=await window.yorw.collaboration.candidates({kind:'document',id:documentId,query});if(r.ok){setItems(r.value.items);setPicked(new Set());setNotice(r.value.items.length?'请选择相关资料。':'没有相关候选，可以调整检索词或新建专题。')}else setNotice(explain(r.code))}finally{setBusy(false)}}
 async function propose(){setBusy(true);try{const operations:unknown[]=[];if(title.trim()){operations.push({key:'new_topic',action:'create_topic',title:title.trim(),reason:'用户选择的新专题'},{key:'new_link',action:'link',first_kind:'document',first:documentId,second_kind:'topic',second:'$new_topic',reason:'将当前文献整理到新专题'})}items.filter(i=>picked.has(i.id)).forEach((i,n)=>operations.push({key:'relation_'+n,action:'link',first_kind:'document',first:documentId,second_kind:i.kind,second:i.id,second_version:i.version,first_version:i.source.version,reason:i.reason}));const r=await window.yorw.collaboration.preview({request_id:crypto.randomUUID(),document_id:documentId,enrichment_id:enrichmentId,operations});if(r.ok){setPreview(r.value);setNotice('预览已生成，尚未修改正式资料。')}else setNotice(explain(r.code))}finally{setBusy(false)}}
 return <section className="collaboration-entry"><h3>整理专题与关联资料</h3><p>候选仅为组织建议，选择后先预览；普通关联不改变笔记范围。</p><div><input aria-label="关联候选检索" placeholder="从标题、标签、摘要与正文查找" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/><button disabled={busy} onClick={()=>void search()}>检索关联候选</button></div>{items.map(i=><label className="collaboration-candidate" key={i.id}><input type="checkbox" checked={picked.has(i.id)} onChange={e=>setPicked(old=>{const next=new Set(old);if(e.target.checked)next.add(i.id);else next.delete(i.id);return next})}/>{i.kind==='topic'?'专题':'文献'} · {i.title}<small>{i.reason} · v{i.version}</small><small>{i.excerpt}</small></label>)}{suggestedTopics.map((item,index)=><div key={index}><strong>建议新专题：{item.title}</strong><p>{item.reason}</p><button disabled={busy} onClick={()=>setTitle(item.title)}>使用此名称并预览关联</button></div>)}<label>新专题名称<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} placeholder="可留空"/></label><button disabled={busy||(!title.trim()&&!picked.size)} onClick={()=>void propose()}>预览所选关联与新专题</button><p role="status">{notice}</p>{preview&&<ProposalCard key={preview.id} initial={preview} onChanged={onChanged}/>}<details><summary>此前方案与撤回</summary><ProposalList documentId={documentId}/></details></section>
}
