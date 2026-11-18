import React,{useState} from 'react'
export const clampDirectoryWidth=(value:number,available:number)=>Math.min(Math.max(200,value),Math.max(200,Math.min(520,available-380)))
export function useDirectoryWidth(storageKey='yorw-directory-width'){
 const [width,setWidth]=useState(()=>{try{const value=Number(localStorage.getItem(storageKey));return Number.isFinite(value)&&value>=200?Math.min(520,value):280}catch{return 280}})
 const update=(value:number,available:number)=>{const next=clampDirectoryWidth(value,available);setWidth(next);try{localStorage.setItem(storageKey,String(next))}catch{}}
 return {width,update}
}
export function DirectorySplitter({width,onResize,label='调整文献目录宽度'}:{width:number;label?:string;onResize:(value:number,available:number)=>void}){
 return <div className="directory-splitter" role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0} aria-valuemin={200} aria-valuemax={520} aria-valuenow={width}
 onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();onResize(e.key==='Home'?200:e.key==='End'?520:width+(e.key==='ArrowRight'?16:-16),e.currentTarget.parentElement!.clientWidth)}}}
 onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId)}}
 onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const container=e.currentTarget.parentElement!;onResize(e.clientX-container.getBoundingClientRect().left,container.clientWidth)}}}
 onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}/>
}
