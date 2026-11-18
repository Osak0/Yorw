import React,{useEffect,useRef} from 'react'

/** Low-frequency actions stay reachable without competing with the primary task. */
export function MoreActions({children,label='更多操作'}:{children:React.ReactNode;label?:string}){
 const root=useRef<HTMLDetailsElement>(null)
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))root.current?.removeAttribute('open')};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[])
 return <details ref={root} className="workspace-more" onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))root.current?.removeAttribute('open')}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();root.current?.removeAttribute('open');root.current?.querySelector('summary')?.focus()}}}><summary>{label}</summary><div className="workspace-more-content" onClick={event=>{if((event.target as HTMLElement).closest('button')){root.current?.removeAttribute('open');if(root.current?.contains(document.activeElement))root.current?.querySelector('summary')?.focus()}}}>{children}</div></details>
}
export function ContextHelp({children,label='使用说明'}:{children:React.ReactNode;label?:string}){
 return <details className="workspace-help"><summary>{label}</summary><div>{children}</div></details>
}
/** Only callers that know a message is success may let it expire. Errors remain. */
export function useSuccessExpiry(message:string,clear:()=>void,success:boolean){
 useEffect(()=>{if(!message||!success)return;const timer=setTimeout(clear,4500);return()=>clearTimeout(timer)},[message,success])
}
