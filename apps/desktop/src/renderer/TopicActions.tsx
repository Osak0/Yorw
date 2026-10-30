import React,{createContext,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {Topic} from '../shared/status'
import {gardenBook} from './garden-book'
import './library-directory.css'

type MenuEvent=React.MouseEvent|React.KeyboardEvent
type OpenMenu=(event:MenuEvent,topic:Topic)=>void
const TopicMenuContext=createContext<OpenMenu>(()=>{})
export const useTopicMenu=()=>useContext(TopicMenuContext)
type Props={children:React.ReactNode;onOpen(topic:Topic):void;onManage(topic:Topic):void;onHistory(topic:Topic):void;onCreate(parentId:string):void;onDeleted(id:string):void}

/** Same compact menu and keyboard conventions as the document directory. */
export function TopicActions({children,onOpen,onManage,onHistory,onCreate,onDeleted}:Props){
 const [menu,setMenu]=useState<{topic:Topic;x:number;y:number}|null>(null)
 const [target,setTarget]=useState<Topic|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const ref=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null),dialog=useRef<HTMLDialogElement>(null)
 function dismiss(){setMenu(null);if(trigger.current?.isConnected)trigger.current.focus()}
 const show:OpenMenu=(event,topic)=>{event.preventDefault();event.stopPropagation();trigger.current=event.currentTarget as HTMLElement;const rect=trigger.current.getBoundingClientRect();setMenu({topic,x:'clientX' in event?event.clientX:rect.left+16,y:'clientY' in event?event.clientY:rect.bottom})}
 useLayoutEffect(()=>{
  if(!menu||!ref.current)return
  const el=ref.current,rect=el.getBoundingClientRect()
  el.style.left=Math.max(8,Math.min(menu.x,window.innerWidth-rect.width-8))+'px'
  el.style.top=Math.max(8,Math.min(menu.y,window.innerHeight-rect.height-8))+'px'
  el.querySelector<HTMLButtonElement>('button')?.focus()
  const outside=(event:PointerEvent)=>{if(!el.contains(event.target as Node))dismiss()}
  const close=()=>dismiss()
  window.addEventListener('pointerdown',outside);window.addEventListener('resize',close);window.addEventListener('blur',close)
  return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);window.removeEventListener('blur',close)}
 },[menu])
 useEffect(()=>{if(target){dialog.current?.showModal();dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()}},[target])
 function cancel(){if(busy)return;setTarget(null);setError('');if(trigger.current?.isConnected)trigger.current.focus()}
 async function remove(){
  if(!target||busy)return
  setBusy(true);setError('')
  try{await gardenBook().remove(target);onDeleted(target.id);setTarget(null)}catch(e){setError(e instanceof Error?e.message:'删除失败，请重试。')}finally{setBusy(false)}
 }
 function item(label:string,action:()=>void,danger=false){return <button role="menuitem" className={danger?'danger':''} onClick={()=>{dismiss();action()}}>{label}</button>}
 return <TopicMenuContext.Provider value={show}>{children}
  {menu&&createPortal(<div ref={ref} role="menu" aria-label="专题操作" className="directory-menu topic-context-menu" style={{left:menu.x,top:menu.y}} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
   if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();dismiss()}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()}
  }}>
   {item('打开专题',()=>onOpen(menu.topic))}{item('新建子专题',()=>onCreate(menu.topic.id))}
   <hr/>{item('专题管理 / 重命名与移动',()=>onManage(menu.topic))}{item('修订历史',()=>onHistory(menu.topic))}
   <hr/>{item('删除专题',()=>{setError('');setTarget(menu.topic)},true)}
  </div>,document.body)}
  {target&&createPortal(<dialog ref={dialog} className="directory-edit topic-delete-dialog" aria-labelledby="topic-delete-title" onCancel={event=>{event.preventDefault();cancel()}}>
   <h3 id="topic-delete-title">删除专题“{target.title}”？</h3>
   <p>仅删除此专题。直接子专题移至其父级（根专题的子专题移至根目录）；关联文献保留，当前专题关联解除。历史修订保留，但此专题不再作为可用来源。</p>
   <p>此操作没有界面撤销入口。未保存编辑须先保存，或关闭相应标签并放弃编辑。</p>
   {error&&<p role="alert">{error}</p>}
   <div className="directory-edit-actions"><button disabled={busy} onClick={cancel}>取消</button><button className="danger" disabled={busy} onClick={()=>void remove()}>{busy?'正在删除…':'确认删除专题'}</button></div>
  </dialog>,document.body)}
 </TopicMenuContext.Provider>
}
