import React,{useEffect,useState} from 'react'
import type {EnrichmentDecision,EnrichmentSettings,EnrichmentView,ReaderTarget,DocumentBlock} from '../shared/status'

const errors:Record<string,string>={ENRICHMENT_RESPONSE_INVALID:'模型响应不是可用的 JSON 对象，请核对模型配置后重试。',ENRICHMENT_SCHEMA_INVALID:'模型返回的字段格式不符合要求，请展开失败详情查看字段。',ENRICHMENT_EVIDENCE_INVALID:'模型返回了未提供的原文块编号；结果未保存，请重试。',ENRICHMENT_FAILED:'整理处理失败，已有资料未修改。',OUTPUT_TRUNCATED:'模型输出被截断，结果未保存，请重试。',NETWORK_ERROR:'模型服务连接失败，请检查网络后重试。',AUTH_FAILED:'模型服务认证失败，请检查聊天模型密钥。',RATE_LIMITED:'模型服务暂时限流，请稍后重试。',CONFIG_MISSING:'请先在 House 配置聊天模型。',KEY_MISSING:'请先在 House 保存聊天模型密钥。',CONFIG_CHANGED:'模型配置已改变，请重试。',MATERIAL_CHANGED:'文献或资料已变化，请重新生成。',DOCUMENT_TOO_LARGE:'文献超出本轮整理预算，原件阅读与检索仍可使用。',INVALID_RESPONSE:'模型返回的资料结构或来源无效，请重试。',CONFIG_CONFLICT:'设置已被修改，请刷新后重试。'}
export function EnrichmentSettingsPanel(){
 const [saved,setSaved]=useState<EnrichmentSettings|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true;void window.yorw.enrichment.settings().then(r=>{if(live&&r.ok)setSaved(r.value)}).catch(()=>{if(live)setNotice('设置加载失败。')});return()=>{live=false}},[])
 async function save(enabled:boolean){
  if(!saved)return
  setBusy(true)
  try{const result=await window.yorw.enrichment.save({...saved,enabled});if(result.ok){setSaved(result.value);setNotice(enabled?'已授权：后续新导入文献解析后自动整理。':'已关闭自动整理，并停止尚未完成的整理任务。')}else setNotice(errors[result.code]??'设置未保存。')}
  catch{setNotice('设置未保存，请重试。')}finally{setBusy(false)}
 }
 return <section className="provider"><h2>导入后自动整理</h2><p>开启即授权将新导入文献的已解析文字发送到你配置的聊天模型，可能产生费用。生成概述、标签与已有专题建议，不修改人工资料，不自动关联专题。关闭后仍可手动整理；重启不自动重发失败或中断任务。</p><label className="check"><input aria-label="自动整理新文献" type="checkbox" checked={saved?.enabled??false} disabled={!saved||busy} onChange={e=>void save(e.target.checked)}/>授权并自动整理新导入文献</label><p role="status">{notice}</p></section>
}

export function EnrichmentPanel({id,onNavigate,onChanged}:{id:string;onNavigate(target:ReaderTarget):void;onChanged():void}){
 const [view,setView]=useState<EnrichmentView|null>(null),[blocks,setBlocks]=useState<DocumentBlock[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{let live=true
  const load=async()=>{try{const r=await window.yorw.enrichment.view(id);if(live&&r.ok)setView(r.value)}catch{if(live)setNotice('AI 整理状态加载失败。')}}
  void load();void window.yorw.documents.blocks(id).then(r=>{if(live&&r.ok)setBlocks(r.value.items)}).catch(()=>{})
  const timer=setInterval(()=>void load(),1500)
  return()=>{live=false;clearInterval(timer)}
 },[id])
 async function act(operation:()=>Promise<{ok:boolean;code?:string}>,success:string){setBusy(true);setNotice('');try{const r=await operation();if(!r.ok)setNotice(errors[r.code??'']??'操作未完成，请重试。');else{setNotice(success);const state=await window.yorw.enrichment.view(id);if(state.ok)setView(state.value);onChanged()}}catch{setNotice('操作失败，请重试。')}finally{setBusy(false)}}
 const item=view?.enrichment,running=['queued','running'].includes(view?.task?.status??'')
 function decision(action:EnrichmentDecision['action'],value=''){if(item)void act(()=>window.yorw.enrichment.decide({id,enrichment_id:item.id,action,value}),'已保存选择。')}
 function evidence(blockId:string){const block=blocks.find(b=>b.id===blockId);if(block)onNavigate({page:block.physical_page??undefined,block_id:block.id,section_path:block.section_path,evidence:block.text})}
 return <section className="resource-section enrichment-panel" aria-label="AI 文献整理"><h3>AI 文献整理</h3><p>发送已解析文字到当前聊天模型生成辅助资料，可能产生费用。结果需你核查，不能替代原文证据；人工总结与标签独立保存。</p>
 <button disabled={busy||running} onClick={()=>void act(()=>window.yorw.enrichment.generate(id),'已创建整理任务。')}>{item?'重新生成':'生成 / 重试'}</button>{running&&<button disabled={busy} onClick={()=>void act(()=>window.yorw.enrichment.cancel(id),'已停止任务；已有整理结果保留。')}>停止整理</button>}
 {view?.task&&<><p role="status">整理任务：{({queued:'等待执行',running:'正在整理',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'} as Record<string,string>)[view.task.status]??view.task.status}{view.task.error?` · ${errors[view.task.error.code]??'处理未完成，请查看失败详情。'}`:''}</p>{view.task.error&&<details><summary>失败详情</summary><p>错误代码：{view.task.error.code}</p><p>失败阶段：{view.task.error.phase??view.task.stage}</p>{!!view.task.error.fields?.length&&<p>相关字段：{view.task.error.fields.join('、')}</p>}<p>不会记录模型原始输出、文献全文或密钥。旧 INVALID_RESPONSE 记录未包含字段信息，重新尝试后可获取详细原因。</p></details>}</>}

 {item&&<><p>来源：AI · {item.created_at} · {item.coverage.length} 个内容块 · {item.prompt_version}{item.stale?' · 已过期，请重新生成':''}</p>
 {item.hidden?<p>已隐藏 AI 结果；后续生成不会恢复本解析版本已拒绝的内容。</p>:<><dl>{(['overview','research_question','method','data','conclusion','limitations'] as const).map((field,index)=>item.result[field]&&<React.Fragment key={field}><dt>{['概述','研究问题','方法','对象 / 数据','结论','局限'][index]}</dt><dd style={{whiteSpace:'pre-wrap'}}>{item.result[field]}</dd></React.Fragment>)}</dl>
 <p>AI 标签：{item.result.tags.map(tag=><span key={tag}>{tag} <button disabled={busy||item.stale} onClick={()=>decision('dismiss_tag',tag)}>移除</button> </span>)}</p>
 <details><summary>查看原文依据</summary>{item.stale?<p>对应旧解析版本；请重新生成后核查当前原文。</p>:item.result.evidence_ids.map(blockId=>{const b=blocks.find(b=>b.id===blockId);return b?<div key={blockId}><p>{b.text}</p><button onClick={()=>evidence(blockId)}>查看依据</button></div>:<p key={blockId}>原文块已不可用</p>})}</details>
 {item.recommendations.map(topic=><div key={topic.topic_id}><strong>{topic.title}</strong><p>{topic.reason}（依据见上方原文块）</p><button disabled={busy} onClick={()=>decision('accept_topic',topic.topic_id)}>确认关联</button><button disabled={busy} onClick={()=>decision('dismiss_topic',topic.topic_id)}>忽略</button></div>)}
 <button disabled={busy||item.stale} onClick={()=>decision('hide')}>隐藏 AI 结果</button></>}
 </>}<p role="status">{notice}</p></section>
}
