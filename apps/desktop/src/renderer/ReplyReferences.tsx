import React from 'react'
import type {ResearchReference} from '../shared/status'
import {openProposalDocument,openProposalTopic,openProposalNote,openProposalReadingNote} from './proposal-launch'

const labels={folder:'Storage 目录',document:'文献',topic:'专题',topic_note:'笔记',reading_note:'阅读笔记'}
export function ReplyReferences({items}:{items:ResearchReference[]}){
 return items.length?<section className="reply-references" aria-label="本次回答相关资料">{items.map(item=><button key={item.kind+item.id} className="reply-reference" onClick={()=>{
  if(item.kind==='folder')window.dispatchEvent(new CustomEvent('storage-folder-open',{detail:{id:item.id}}))
  else if(item.kind==='document')openProposalDocument(item.id)
  else if(item.kind==='topic')openProposalTopic(item.id,item.title)
  else if(item.kind==='topic_note')openProposalNote(item.id)
  else if(item.kind==='reading_note'&&item.document_id)openProposalReadingNote(item.document_id,item.id)
 }}><small>{labels[item.kind]}</small><strong>{item.title}</strong>{item.path&&item.path!==item.title&&<span>{item.path}</span>}<span className="reply-reference-open">打开详情</span></button>)}</section>:null
}
