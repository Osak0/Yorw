import React, { useEffect, useState } from 'react'
import type { ChatMessage, Evidence, ProviderConfig } from '../shared/status'
import './chat.css'

export function ChatPanel({documentId,onPage,onNote}:{documentId:string;onPage(page:number):void;onNote(id:string):void}) {
  const [question,setQuestion]=useState(''), [semantic,setSemantic]=useState(false), [minimum,setMinimum]=useState('0.5')
  const [sources,setSources]=useState<Evidence[]>([]),[selected,setSelected]=useState<string[]>([]),[consent,setConsent]=useState(false)
  const [config,setConfig]=useState<ProviderConfig|null>(null),[messages,setMessages]=useState<ChatMessage[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [prepared,setPrepared]=useState(''),[retrieval,setRetrieval]=useState('')
  useEffect(()=>{
    let active=true
    const load=async()=>{try{
      const [history,configs]=await Promise.all([window.yorw.chat.list(documentId),window.yorw.providers.list()])
      if(!active)return
      if(history.ok)setMessages(history.value.items);else setNotice(`加载失败（${history.code}）`)
      if(configs.ok)setConfig(configs.value.find(c=>c.kind==='chat')??null)
    }catch{if(active)setNotice('本地服务不可用，请重试。')}}
    void load();const timer=setInterval(load,500);return()=>{active=false;clearInterval(timer)}
  },[documentId])
  useEffect(()=>setConsent(false),[config?.version])
  const running=messages.some(m=>m.status==='running')
  async function search(){setBusy(true);setNotice('正在准备证据…');setSources([]);setSelected([]);setConsent(false)
    try{const status=await window.yorw.search.status(documentId)
      const result=await window.yorw.search.query({id:documentId,query:question,semantic,min_similarity:Number(minimum),config_version:status.ok?status.value.config?.version??0:0})
      if(result.ok){setSources(result.value.items);setSelected(result.value.items.map(s=>s.segment_id));setPrepared(question);setRetrieval(result.value.mode==='hybrid'?'关键词 + 语义':`仅关键词${result.value.reason?'（'+result.value.reason+'）':''}`);setNotice(result.value.items.length?'请核查并选择本次发送的片段。':'未找到证据，不会向聊天服务发送问题。')}
      else setNotice(`检索失败（${result.code}）`)
    }catch{setNotice('证据加载失败。')}finally{setBusy(false)}}
  async function ask(){if(!config||!consent||!selected.length||question!==prepared)return;setBusy(true)
    try{const result=await window.yorw.chat.ask({document_id:documentId,question,segment_ids:selected,config_version:config.version});if(result.ok){setMessages(v=>[...v.filter(m=>m.id!==result.value.id),result.value]);setConsent(false);setNotice('正在生成，部分内容随流保存。')}else setNotice(`发送失败（${result.code}）`)}catch{setNotice('发送状态不确定，请刷新历史后再操作。')}finally{setBusy(false)}}
  async function cancel(id:string){try{const result=await window.yorw.chat.cancel(id);setNotice(result.ok?'已取消；已发送请求仍可能计费。':`取消失败（${result.code}）`)}catch{setNotice('取消失败，请重试。')}}
  async function note(id:string){try{const result=await window.yorw.chat.note(id);if(result.ok){setNotice('已保存独立笔记及原始引用。');onNote(result.value.id)}else setNotice(`保存失败（${result.code}）`)}catch{setNotice('保存失败，请重试。')}}
  return <div className="chat-panel"><p>仅依据本次选择的原文片段回答；历史对话本地保存，本轮不自动发送历史。引用存在不代表内容已获原文证实。</p>
    <label>研究问题<textarea aria-label="研究问题" maxLength={1000} value={question} onChange={e=>{setQuestion(e.target.value);setConsent(false)}} /></label>
    <label><input type="checkbox" checked={semantic} onChange={e=>{setSemantic(e.target.checked);setConsent(false)}} />准备证据时启用语义检索（发送问题至 embedding 服务）</label>
    {semantic&&<label>最低语义相似度<input type="number" min="0" max="1" step="any" value={minimum} onChange={e=>setMinimum(e.target.value)} /></label>}
    <button disabled={busy||running||!question.trim()||question.length>1000||(semantic&&(!minimum.trim()||!Number.isFinite(Number(minimum))||Number(minimum)<0||Number(minimum)>1))} onClick={()=>void search()}>准备本次证据</button><small>证据检索限 1000 字；问题需先检索再发送。</small>
    {retrieval&&<p>{retrieval} · 仅当前文献</p>}{sources.map(s=><label className="chat-evidence" key={s.segment_id}><input type="checkbox" checked={selected.includes(s.segment_id)} onChange={e=>{setSelected(v=>e.target.checked?[...v,s.segment_id]:v.filter(x=>x!==s.segment_id));setConsent(false)}} />物理页 {s.physical_page}<span>{s.text}</span></label>)}
    <p>聊天服务：{config?`${config.model} · ${config.base_url}`:'请在 House 配置聊天服务'}</p>
    <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />确认发送问题及选中的 {selected.length} 条完整证据到上述聊天服务，可能计费。</label>
    <button disabled={busy||running||!consent||!config||!selected.length||question!==prepared} onClick={()=>void ask()}>发送并生成回答</button><p role="status">{notice}</p>
    <div aria-label="问答历史">{messages.map(m=><article key={m.id}><h3>{m.question}</h3><p>{m.status==='running'?'生成中':m.status==='completed'?'已完成':m.status==='cancelled'?'已取消':m.status==='interrupted'?'已中断':'失败'}{m.error_code&&`（${m.error_code}）`} · {m.provider.model}</p><div className="chat-answer">{m.body_md||'尚无回答文字'}</div>
      {m.status==='running'?<button onClick={()=>void cancel(m.id)}>取消生成</button>:<button onClick={()=>{setQuestion(m.question);setSources([]);setSelected([]);setConsent(false);setPrepared('');setNotice('请重新准备证据并确认发送；重试生成新记录，保留旧回答。')}}>重试此问</button>}
      {m.status==='completed'&&m.citations.map(n=><button key={n} disabled={!m.sources[n-1]?.available} onClick={()=>onPage(m.sources[n-1].physical_page)}>[S{n}] · 第 {m.sources[n-1].physical_page} 页{!m.sources[n-1].available?'（来源失效）':''}</button>)}
      {m.status==='completed'&&!m.citations.length&&<p>模型未提供可核对的 [S编号] 引用，请勿视为有来源结论。</p>}
      {m.status==='completed'&&<button onClick={()=>void note(m.id)}>{m.note_id?'打开笔记':'回答转笔记'}</button>}
      <details><summary>本次证据与引用（{m.sources.length}）</summary>{m.sources.map((s,i)=><div key={s.id}><p>[S{i+1}] · 物理页 {s.physical_page} · {m.citations.includes(i+1)?'正文引用':'提供的上下文'}{!s.available&&' · 来源已失效'}</p><p>{s.text}</p><button disabled={!s.available} onClick={()=>onPage(s.physical_page)}>跳至物理页 {s.physical_page}</button></div>)}</details>
    </article>)}</div></div>
}
