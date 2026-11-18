import React,{useLayoutEffect,useRef,useState} from 'react'

export function ResearchComposer({value,onChange,onSend,disabled=false,label,placeholder,controls,id}:{value:string;onChange:(value:string)=>void;onSend:()=>void;disabled?:boolean;label:string;placeholder:string;controls?:React.ReactNode;id?:string}){
 const input=useRef<HTMLTextAreaElement>(null),composing=useRef(false)
 const [expanded,setExpanded]=useState(false)
 useLayoutEffect(()=>{
  const element=input.current;if(!element)return
  const resize=()=>{element.style.height='auto';element.style.height=`${Math.min(element.scrollHeight,expanded?Math.max(180,window.innerHeight*.45):204)}px`}
  resize();const observer=new ResizeObserver(resize);observer.observe(element.parentElement!);return()=>observer.disconnect()
 },[value,expanded])
 function submit(){if(!disabled&&value.trim())onSend()}
 return <form className={`research-composer shared-composer${expanded?' expanded':''}`} onSubmit={event=>{event.preventDefault();submit()}}>
  <textarea id={id} ref={input} aria-label={label} rows={3} maxLength={4000} value={value} placeholder={placeholder} onChange={event=>onChange(event.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&!composing.current&&event.keyCode!==229){event.preventDefault();submit()}}}/>
  <div className="composer-toolbar">{controls}<button type="button" aria-expanded={expanded} onClick={()=>{const element=input.current,start=element?.selectionStart,end=element?.selectionEnd;setExpanded(!expanded);requestAnimationFrame(()=>{element?.focus();if(start!==undefined&&end!==undefined)element?.setSelectionRange(start,end)})}}>{expanded?'收起输入':'展开输入'}</button><span>Enter 发送 · Shift+Enter 换行{value.length>=3600?` · ${value.length}/4000`:''}</span><button className="primary" disabled={disabled||!value.trim()}>发送</button></div>
 </form>
}
