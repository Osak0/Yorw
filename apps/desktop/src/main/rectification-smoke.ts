import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { Backend } from './backend'

/** Explicit isolated smoke only: native picks are supplied by the test harness. */
export async function runRectificationSmoke(window:BrowserWindow,backend:Backend,folder:string,soffice:string){
 const originalOpen=dialog.showOpenDialog, originalConfirm=dialog.showMessageBox
 dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[soffice]})) as typeof dialog.showOpenDialog
 dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox
 try{
  const configProof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   const click=async text=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent===text||x.querySelector('strong')?.textContent===text)&&!x.closest('[hidden]'));if(!b)throw new Error('BUTTON:'+text);b.click();await new Promise(r=>setTimeout(r,100))}
   await click('House');await click('文献解析与预览');await wait(()=>document.querySelectorAll('input[readonly]').length>0,'PARSER_FORM')
   await click('选择并授权 LibreOffice');await wait(()=>[...document.querySelectorAll('input[readonly]')].some(x=>x.value.includes('soffice')),'PICK')
   await click('保存解析配置');await wait(()=>document.body.textContent.includes('解析配置已保存'),'SAVE')
   await click('检测组件能力');await wait(()=>document.body.textContent.includes('检测完成'),'DETECT')
   await click('House');await click('聊天模型');await wait(()=>document.querySelector('input[type=password]'),'MODEL_FORM')
   const field=[...document.querySelectorAll('.house-view input')].find(x=>!x.closest('[hidden]')&&x.type!=='password')
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,'https://example.invalid');field.dispatchEvent(new Event('input',{bubbles:true}))
   await click('House');await click('检索');await wait(()=>document.body.textContent.includes('语义检索'),'RETRIEVAL')
   await click('House');await click('聊天模型');await wait(()=>[...document.querySelectorAll('input')].some(x=>x.value==='https://example.invalid'),'DRAFT_PRESERVED')
   const close=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='关闭设置 聊天模型');close.click()
   await wait(()=>document.querySelector('.close-dialog'),'DIRTY_DIALOG');await click('取消')
   return {parserSave:true,componentDetection:true,settingsTabs:true,draftPreserved:true,closeProtected:true}
  })()`)
  for(const name of ['fixture.docx','fixture.doc','fixture.md','fixture.txt']){
   const bytes=await readFile(join(folder,name)),form=new FormData();form.append('file',new Blob([bytes]),name)
   await backend.request('/v1/documents/import','POST',form)
  }
  await new Promise(r=>setTimeout(r,1800))
  const proof=await window.webContents.executeJavaScript(`(async()=>{
   const wait=async(fn,label)=>{const end=Date.now()+60000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(label)}
   const click=async text=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent===text||x.querySelector('strong')?.textContent===text)&&!x.closest('[hidden]'));if(!b)throw new Error('BUTTON:'+text);b.click();await new Promise(r=>setTimeout(r,100))}
   await click('Storage');await wait(()=>document.querySelectorAll('.document-row').length>=4,'ROWS')
   const results=[]
   for(const name of ['fixture.docx','fixture.doc','fixture.md','fixture.txt']){
    const row=[...document.querySelectorAll('.document-row')].find(x=>x.textContent.includes(name)&&!x.textContent.includes(name+'x'))
    if(!row)throw new Error('ROW:'+name)
    ;[...row.querySelectorAll('button')].find(x=>x.textContent==='打开阅读').click()
    await wait(()=>document.querySelector('.original-reader'),'ORIGINAL:'+name)
    if(name.endsWith('.docx')||name.endsWith('.doc')){
     await click('版式预览（可选）')
     await wait(()=>document.querySelector('.original-reader .textLayer')?.textContent.includes('Methods'),'CONVERSION:'+name)
     const docs=await window.yorw.documents.list(),doc=docs.value.items.find(x=>x.original_name===name)
     const preview=await window.yorw.documents.preview({id:doc.id,action:'start'})
     const blocks=await window.yorw.documents.blocks(doc.id)
     const block=blocks.value.items.find(x=>x.text.includes('self-written'))
     const location=await window.yorw.documents.preview({id:doc.id,action:'location',preview:preview.value.id,block:block.id})
     if(!location.ok||!location.value.matched)throw new Error('MAPPING:'+name)
     results.push({name,previewId:preview.value.id,ranges:location.value.ranges})
    }else{
     await wait(()=>document.querySelector('.original-content')?.textContent.includes('Fixture'),'TEXT:'+name)
     results.push({name,originalText:true})
    }
    await click('返回文献库');await wait(()=>document.querySelectorAll('.document-row').length>=4,'RETURN')
   }
   return results
  })()`)
  await window.webContents.executeJavaScript(`(async()=>{const tab=[...document.querySelectorAll('.workspace-tab')].find(x=>x.title==='文献 · Fixture Document');tab?.click();await new Promise(r=>setTimeout(r,1500))})()`)
  await writeFile(join(folder,'word-preview.png'),(await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`(async()=>{[...document.querySelectorAll('nav button')].find(x=>x.textContent==='House').click();await new Promise(r=>setTimeout(r,200))})()`)
  await writeFile(join(folder,'house-home.png'),(await window.webContents.capturePage()).toPNG())
  return {configProof,formats:proof,nativeDialogs:'test harness supplied selection and confirmation; native validation covered by unit tests'}
 }finally{dialog.showOpenDialog=originalOpen;dialog.showMessageBox=originalConfirm}
}
