import React, {useEffect, useRef, useState} from 'react'
import {PdfReader} from './PdfReader'
import {MarkdownPreview} from './MarkdownPreview'
import type {ReaderTarget} from '../shared/status'

export interface OriginalNode {type:string;text?:string;src?:string;heading?:number;align?:string;list?:boolean;bold?:boolean;italic?:boolean;underline?:boolean;colspan?:number;children?:OriginalNode[]}
type Props=Omit<React.ComponentProps<typeof PdfReader>,'jump'> & {jump?:ReaderTarget & {sequence:number}}
const messages:Record<string,string>={COMPONENT_APPROVAL_REQUIRED:'版式预览需要可选 LibreOffice。请在 House → 文献解析与预览中选择并授权，然后保存。',COMPONENT_MISSING:'版式预览需要可选 LibreOffice；基础阅读和已有检索依据仍可使用。',CANCELLED:'已取消版式转换，基础阅读仍可使用。',INTERRUPTED:'上次版式转换中断，可重试。',INVALID_FILE:'原文件格式无效或已损坏，仍可查看已有依据。',OUTPUT_TOO_LARGE:'原文件超过基础预览限制，仍可查看已有依据。',TIMEOUT:'版式转换超时，基础阅读仍可使用。'}
export function normalizeOriginalText(value:string){return value.replace(/\|/g,' ').replace(/\s+/g,'')}
function OriginalContent({node,path='root',highlight}:{node:OriginalNode;path?:string;highlight?:string}):React.ReactNode{
 const children=node.children?.map((child,index)=><OriginalContent key={index} node={child} path={`${path}-${index}`} highlight={highlight}/>)
 const location={id:`original-${path}`,'data-original-node':path,className:`docx-original-node${highlight===path?' original-evidence-highlight':''}`}
 if(node.type==='text'||node.type==='placeholder')return node.text
 if(node.type==='image')return <img src={node.src} alt="原文件内嵌图片" loading="lazy"/>
 if(node.type==='run')return <span style={{fontWeight:node.bold?'bold':undefined,fontStyle:node.italic?'italic':undefined,textDecoration:node.underline?'underline':undefined}}>{children}</span>
 if(node.type==='table')return <table {...location}><tbody>{children}</tbody></table>
 if(node.type==='row')return <tr>{children}</tr>
 if(node.type==='cell')return <td colSpan={node.colspan}>{children}</td>
 if(node.type==='paragraph')return <div {...location} role={node.heading?'heading':undefined} aria-level={node.heading??undefined} style={{textAlign:node.align==='both'?'justify':node.align as 'left'|'right'|'center',fontSize:node.heading?`${1.7-node.heading*.1}em`:undefined,fontWeight:node.heading?'bold':undefined,whiteSpace:'pre-wrap'}}>{node.list&&<span aria-hidden="true">• </span>}{node.children?.length?children:<br/>}</div>
 return <>{children}</>
}
export function OriginalReader(props:Props){
 const {document:record,jump}=props,word=record.format==='doc'||record.format==='docx'
 const [original,setOriginal]=useState<{kind:string;content?:OriginalNode;notice?:string;warnings?:string[]}>(),[body,setBody]=useState(''),[raw,setRaw]=useState(false)
 const [preview,setPreview]=useState<{id:string;status:string;error?:string}>(),[conversion,setConversion]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
 const [basis,setBasis]=useState(''),[place,setPlace]=useState(''),[notice,setNotice]=useState(''),[highlight,setHighlight]=useState<string>(),[ranges,setRanges]=useState<{page:number;quote:string}[]>([]),[target,setTarget]=useState<{page:number;sequence:number}>(),[quote,setQuote]=useState('')
 const content=useRef<HTMLElement>(null)
 useEffect(()=>{
  let alive=true
  setLoading(true);setError('');setOriginal(undefined);setPreview(undefined);setConversion(false);setHighlight(undefined);setTarget(undefined)
  void window.yorw.documents.preview({id:record.id,action:word?'original':'text'}).then(result=>{
   if(!alive)return
   if(result.ok){if(word)setOriginal(result.value);else setBody(result.value.text)}
   else setError(messages[result.code]??'基础预览不可用。可查看已有依据，或使用系统应用打开原件。')
  }).catch(()=>{if(alive)setError('基础预览读取失败；已有检索和问答依据仍可查看。')}).finally(()=>{if(alive)setLoading(false)})
  return()=>{alive=false}
 },[record.id,retry,word])
 useEffect(()=>{
  if(!conversion)return
  let alive=true,timer:ReturnType<typeof setTimeout>
  async function start(){
   try{
    const result=await window.yorw.documents.preview({id:record.id,action:'start'})
    if(!alive)return
    if(!result.ok){setNotice(messages[result.code]??'版式转换不可用；继续使用基础阅读。');setConversion(false);return}
    setPreview(result.value)
    async function poll(){
     const next=await window.yorw.documents.preview({id:record.id,action:'status',preview:result.ok?result.value.id:undefined})
     if(!alive)return
     if(!next.ok){setNotice('读取版式转换状态失败；继续使用基础阅读。');setConversion(false);return}
     setPreview(next.value)
     if(next.value.status==='running')timer=setTimeout(()=>void poll().catch(()=>{if(alive){setNotice('版式转换连接中断；继续使用基础阅读。');setConversion(false)}}),600)
     else if(next.value.status!=='ready'){setNotice(messages[next.value.error]??'版式转换失败；继续使用基础阅读。');setConversion(false)}
    }
    if(result.value.status==='running')timer=setTimeout(()=>void poll().catch(()=>{if(alive){setNotice('版式转换连接中断；继续使用基础阅读。');setConversion(false)}}),600)
    else if(result.value.status!=='ready'){setNotice(messages[result.value.error]??'版式转换不可用；继续使用基础阅读。');setConversion(false)}
   }catch{if(alive){setNotice('版式转换不可用；继续使用基础阅读。');setConversion(false)}}
  }
  void start()
  return()=>{alive=false;clearTimeout(timer)}
 },[conversion,record.id])
 useEffect(()=>{
  if(!jump)return
  let alive=true
  setBasis(jump.evidence??'');setPlace(jump.section_path?.join(' / ')??'');setHighlight(undefined);setRanges([]);setTarget(undefined)
  void (async()=>{
   const result=jump.block_id?await window.yorw.documents.blocks(record.id):null
   if(!alive)return
   const block=result?.ok?result.value.items.find(item=>item.id===jump.block_id):undefined
   const evidence=block?.text||jump.evidence||''
   setBasis(evidence);setPlace(block?.section_path.join(' / ')||jump.section_path?.join(' / ')||'文献内容')
   if(conversion&&preview?.status==='ready'&&jump.block_id){
    const match=await window.yorw.documents.preview({id:record.id,action:'location',preview:preview.id,block:jump.block_id})
    if(!alive)return
    if(match.ok&&match.value.matched){const first=match.value.ranges[0];setRanges(match.value.ranges);setQuote(first.quote);setTarget({page:first.page,sequence:jump.sequence});setNotice('已展示依据，并定位转换预览。')}
    else setNotice('已展示依据；未能唯一定位转换预览页。')
   }else if(original?.kind==='docx'&&evidence){
    const needle=normalizeOriginalText(evidence.replace(/^\s*[-:| ]+$/gm,''))
    const candidates=[...(content.current?.querySelectorAll<HTMLElement>('.docx-original-node')??[])].filter(node=>needle&&normalizeOriginalText(node.textContent??'').includes(needle))
    const leaves=candidates.filter(node=>!candidates.some(other=>other!==node&&node.contains(other)))
    if(leaves.length===1){setHighlight(leaves[0].dataset.originalNode);leaves[0].scrollIntoView({block:'center'});setNotice('已展示依据，并标记原件基础预览中的匹配内容。')}
    else setNotice('已展示依据；原件中未找到唯一匹配位置。')
   }else if(!word&&evidence&&body.includes(evidence)&&body.indexOf(evidence)===body.lastIndexOf(evidence)){
    setRaw(true);setNotice('已展示依据，并标记原始文本。');requestAnimationFrame(()=>window.document.getElementById(`original-hit-${record.id}`)?.scrollIntoView({block:'center'}))
   }else setNotice(evidence?'已展示依据。当前没有可定位的应用内原件预览。':'此来源版本的依据暂不可用，请重新检索。')
   props.onJumpApplied?.(jump.sequence)
  })().catch(()=>{if(alive){setNotice('已展示保存的依据；原件定位暂不可用。');props.onJumpApplied?.(jump.sequence)}})
  return()=>{alive=false}
 },[jump?.sequence,original,body,conversion,preview?.status,record.id])
 async function openOriginal(){try{const result=await window.yorw.documents.openOriginal(record.id);if(!result.ok)setNotice('系统应用未能打开原件，请检查文件关联。')}catch{setNotice('系统应用未能打开原件，请检查文件关联。')}}
 const index=basis?body.indexOf(basis):-1
 return <div className="original-reader">
  <div className="reader-toolbar"><strong>{record.title||record.original_name}</strong><span>{conversion&&preview?.status==='ready'?'版式预览（可选 LibreOffice）':word?'原件基础预览 · 只读':'原文件 · 只读'}</span><button onClick={()=>void openOriginal()}>系统应用打开原件</button>{word&&<button onClick={()=>{setNotice('版式预览需要用户安装并授权 LibreOffice；不影响基础阅读、检索和问答。');setConversion(value=>!value)}}>{conversion?'返回基础阅读':'版式预览（可选）'}</button>}{!word&&record.format==='md'&&<button onClick={()=>setRaw(value=>!value)}>{raw?'阅读视图':'原始文本'}</button>}</div>
  {!(conversion&&preview?.status==='ready')&&<div className="reader-toolbar"><button onClick={props.onClose}>返回文献库</button><button onClick={props.onNotes}>笔记</button><button onClick={props.onSearch}>检索</button><button onClick={props.onChat}>问答</button><button onClick={props.onResource}>资料</button></div>}
  {notice&&<p role="status" className="reader-feedback">{notice}</p>}
  {basis&&<section className="evidence-basis" aria-label="原文依据"><strong>原文依据 · {place}</strong><blockquote>{basis}</blockquote></section>}
  {conversion&&preview?.status==='ready'?<><div className="reader-toolbar">{ranges.length>1&&ranges.map((range,index)=><button key={index} onClick={()=>{setQuote(range.quote);setTarget({page:range.page,sequence:Date.now()})}}>转换预览第 {range.page} 页</button>)}</div><PdfReader {...props} previewId={preview.id} highlight={quote} jump={target}/></>:<>
   {conversion&&<div role="status">正在生成可选版式预览；下方基础阅读仍可使用。<button onClick={()=>{if(preview)void window.yorw.documents.preview({id:record.id,action:'cancel',preview:preview.id});setConversion(false)}}>取消转换</button></div>}
   {loading?<p role="status">正在读取原文件…</p>:error?<div role="alert">{error}<button onClick={()=>setRetry(value=>value+1)}>重试基础预览</button></div>:word?<><p className="original-notice">{original?.notice}</p>{original?.warnings?.map(item=><p key={item} className="original-notice">{item}</p>)}{original?.content?<article ref={content} className="original-content docx-original"><OriginalContent node={original.content} highlight={highlight}/></article>:<p>检索与问答引用将直接显示原文依据；如需查看完整旧 DOC 版式，可选择可选版式预览，或导入 DOCX 副本。</p>}</>:<article className="original-content">{record.format==='md'&&!raw?<MarkdownPreview body={body||' '}/>:<pre>{index>=0?<>{body.slice(0,index)}<mark id={`original-hit-${record.id}`}>{basis}</mark>{body.slice(index+basis.length)}</>:body}</pre>}</article>}
  </>}
 </div>
}
