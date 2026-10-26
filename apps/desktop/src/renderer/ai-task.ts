import {useEffect,useRef,useState} from 'react'
import type {AiInput,AiTask} from '../shared/status'
import {generationError} from './generation-status'

export function aiError(code:string):string{
 return ({CONFIG_MISSING:'请先在 House 配置聊天模型。',KEY_MISSING:'请先在 House 保存聊天模型密钥。',NO_EVIDENCE:'没有找到足够的相关材料，请补充资料或调整要求。',TEXT_NOT_READY:'文献文字尚未准备好，请稍后再试。',REVISION_CONFLICT:'正文已有更新，草稿已保留，请载入最新版本后再生成。',MATERIAL_CHANGED:'来源内容已有变化，请重试。',CONFIG_CHANGED:'设置已变化，请重新发送。',TASK_RUNNING:'正在处理当前任务，请稍候或取消。',CHAT_RUNNING:'当前回答仍在生成。',SUGGESTION_RUNNING:'当前草稿仍在生成。',BACKEND_NOT_READY:'本地服务不可用，请重新打开知栖。'} as Record<string,string>)[code]??generationError(code)
}
export const phaseLabel=(phase:string)=>({PREPARING:'正在准备相关内容…',UNDERSTANDING:'正在理解问题…',SEARCHING:'正在查找原文…',FILTERING:'正在筛选相关内容…',GENERATING:'正在生成…'} as Record<string,string>)[phase]??'正在处理…'
export function useAiTask(kind:AiInput['kind'],target:string){
 const [task,setTask]=useState<AiTask|null>(null),[submitting,setSubmitting]=useState(false),[notice,setNotice]=useState('')
 const epoch=useRef(0),request=useRef<{signature:string;id:string;terminal?:boolean}|null>(null),pending=useRef(false)
 useEffect(()=>{
  const token=++epoch.current;let fetching=false
  setTask(null);setNotice('');setSubmitting(false);pending.current=false;request.current=null
  const refresh=async()=>{if(fetching)return;fetching=true
   try{const result=await window.yorw.ai.latest({kind,target_id:target});if(token!==epoch.current)return
    if(result.ok){const latest=result.value.items[0];if(latest&&(!pending.current||latest.input.request_id===request.current?.id)){setTask(latest);if(request.current?.id===latest.input.request_id)request.current.terminal=!['queued','running'].includes(latest.status)}}
   }catch{/* Preserve input and visible progress during a transient poll failure. */}finally{fetching=false}}
  void refresh();const timer=setInterval(refresh,750)
  return()=>{epoch.current++;clearInterval(timer)}
 },[kind,target])
 async function start(text:string,base_revision_id?:string){
  if(pending.current)return false
  const token=epoch.current,signature=JSON.stringify({kind,target,text,base_revision_id})
  if(!request.current||request.current.signature!==signature||request.current.terminal)request.current={signature,id:crypto.randomUUID()}
  pending.current=true;setSubmitting(true);setNotice('');setTask(null)
  try{const result=await window.yorw.ai.run({kind,target_id:target,text,base_revision_id,request_id:request.current.id})
   if(token!==epoch.current)return false
   if(result.ok){setTask(result.value);if(request.current)request.current.terminal=!['queued','running'].includes(result.value.status)}else{request.current=null;setNotice(aiError(result.code))}
   return result.ok
  }catch{if(token===epoch.current)setNotice('发送状态尚待确认，输入已保留；再次发送会核对原请求。')}
  finally{if(token===epoch.current){pending.current=false;setSubmitting(false)}}
  return false
 }
 async function cancel(){if(!task)return;try{const result=await window.yorw.ai.cancel(task.id);if(result.ok)setTask(result.value);else setNotice(aiError(result.code))}catch{setNotice('取消未完成，请重试。')}}
 const running=submitting||!!task&&['queued','running'].includes(task.status)
 const error=task&&['failed','interrupted'].includes(task.status)?aiError(task.error?.code??task.stage):task?.status==='cancelled'?'已取消。':''
 return {task,running,start,cancel,notice:notice||error||(running?phaseLabel(task?.stage??'PREPARING'):'')}
}
