import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Exercises real renderer state against an isolated, self-authored PDF workspace. */
export async function runDocumentManagementSmoke(window: BrowserWindow, report: string) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (check, label) => { const end = Date.now()+15000; while(Date.now()<end) { if(check()) return; await new Promise(r=>setTimeout(r,60)) } throw Error(label) }
    const button = (text, root=document) => [...root.querySelectorAll('button')].find(b=>b.textContent===text)
    const click = text => { const b=button(text); if(!b)throw Error('MISSING_'+text); b.click() }
    const tab = kind => [...document.querySelectorAll('.workspace-tab')].find(t=>t.textContent.includes(kind))
    const home = async () => { document.querySelector('nav button').click(); await wait(()=>document.querySelector('.document-row'),'HOME') }
    const manage = () => { const b=button('管理文献'); if(b.getAttribute('aria-expanded')!=='true') b.click() }
    const field = () => document.querySelector('[aria-label="文献标题"]')
    const input = value => { const f=field(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,value); f.dispatchEvent(new Event('input',{bubbles:true})) }
    await home()
    const row=document.querySelector('.document-row'), actions=row.querySelector('.document-actions')
    const primary=[...actions.children].filter(e=>e.tagName==='BUTTON').map(e=>e.textContent)
    if(JSON.stringify(primary)!==JSON.stringify(['打开阅读','管理文献']))throw Error('PRIMARY_ACTIONS')
    const toggle=button('管理文献',row), top=toggle.getBoundingClientRect().top
    toggle.click(); await wait(()=>row.querySelector('.document-management-actions'),'EXPAND')
    const menu=[...row.querySelector('.document-management-actions').children].map(e=>e.textContent)
    if(JSON.stringify(menu)!==JSON.stringify(['编辑元数据','笔记','检索','问答','解析','删除文献']))throw Error('MENU_ORDER')
    if(Math.abs(toggle.getBoundingClientRect().top-top)>1)throw Error('TOGGLE_JUMP')
    if(row.querySelector('.document-parser-actions'))throw Error('PARSER_EAGER')
    button('解析',row).click(); await wait(()=>row.querySelector('.document-parser-actions select'),'PARSE_OPTIONS')
    button('编辑元数据',row).click(); await wait(field,'METADATA')
    const page=document.querySelector('.metadata-tool')
    await wait(()=>page.textContent.includes('所属专题'),'RELATIONS')
    if(page.textContent.indexOf('相关文献')>page.textContent.indexOf('所属专题'))throw Error('FIELD_ORDER')
    const original=field().value
    input('stage-two draft'); await new Promise(r=>setTimeout(r,120))
    await home(); manage(); await wait(()=>button('笔记'),'NOTES_MENU'); click('笔记')
    await wait(()=>document.querySelector('.notes-panel'),'NOTES')
    tab('编辑元数据').click(); await wait(field,'DRAFT_REOPEN')
    if(field().value!=='stage-two draft')throw Error('DRAFT_LOST')
    const metaTab=tab('编辑元数据').closest('.workspace-tab-item')
    metaTab.querySelector('.workspace-tab-close').click()
    await wait(()=>document.querySelector('[role="dialog"]'),'CLOSE_GUARD')
    button('取消',document.querySelector('[role="dialog"]')).click()
    await wait(field,'CANCEL_CLOSE')
    if(field().value!=='stage-two draft')throw Error('CANCEL_LOST_DRAFT')
    click('保存'); await wait(()=>!field(),'SAVED_CLOSE')
    await home(); manage(); await wait(()=>button('编辑元数据'),'REOPEN_MENU'); click('编辑元数据'); await wait(field,'SAVED_REOPEN')
    if(field().value!=='stage-two draft')throw Error('SAVE_LOST')
    input(original); click('保存'); await wait(()=>!field(),'RESTORED')
    for(const name of ['检索','问答']) { await home(); manage(); await wait(()=>button(name),'TOOL_MENU'); click(name); await wait(()=>document.querySelector(name==='检索'?'.search-panel':'.chat-panel'),'TOOL_'+name) }
    await home(); manage(); await wait(()=>button('编辑元数据'),'AI_MENU'); click('编辑元数据'); await wait(field,'AI_METADATA'); click('AI 辅助文献整理'); await wait(()=>document.querySelector('.enrichment-panel'),'AI_HISTORY')
    const docs=await window.yorw.documents.list(), id=docs.value.items[0].id
    const layout=await window.yorw.layout.load()
    const kinds=layout.value.layout.tabs.map(t=>t.kind)
    if(!kinds.includes('enrichment')||kinds.includes('resource'))throw Error('LAYOUT_CONTRACT')
    await home()
    window.confirm=()=>false
    manage(); await wait(()=>button('删除文献'),'DELETE_MENU'); click('删除文献')
    if(!(await window.yorw.documents.list()).value.items.some(d=>d.id===id))throw Error('DELETE_CANCEL')
    return {primary,menu,stableToggle:true,draftKept:true,closeProtected:true,saved:true,kinds,deleteCancelled:true}
  })()`)
  for (const width of [1024, 1280, 1440]) {
    window.setSize(width, 900)
    await new Promise(resolve => setTimeout(resolve, 200))
    const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth')
    if (overflow) throw new Error(`MANAGEMENT_OVERFLOW_${width}`)
    await writeFile(join(report, `management-${width}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await new Promise<void>(resolve => {
    window.webContents.once('did-finish-load', () => resolve())
    window.webContents.reload()
  })
  await window.webContents.executeJavaScript(`(async()=>{
    const wait=async(check,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
    await wait(()=>document.querySelectorAll('.workspace-tab').length===6,'LAYOUT_RESTORE')
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
    document.querySelector('nav button').click()
    await wait(()=>button('管理文献'),'RESTORE_HOME')
    button('管理文献').click()
    await wait(()=>button('删除文献'),'RESTORE_MENU')
    window.confirm=()=>true
    button('删除文献').click()
    await wait(()=>!document.querySelector('.document-row'),'DELETE_CONFIRMED')
    await wait(()=>!document.querySelector('.workspace-tab'),'DELETE_TABS')
  })()`)
  return {...result, layoutRestored: true, deletedTabsClosed: true}
}
