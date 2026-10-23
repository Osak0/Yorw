/** Native regression harness. All data stays in the explicitly supplied smoke workspace. */
import type { BrowserWindow } from 'electron'
import type { Backend } from './backend'
import type { DocumentRecord, NoteRecord } from '../shared/status'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const fixtureBody = '# Yorw note fixture\n\n这是可复现的人工笔记。\n\n**Saved evidence check**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![no request](https://example.com/never-load.png)\n\n<script>window.__unsafeNote = true</script>'
const helpers = `const wait = async (predicate) => { const end = Date.now()+20000; while(Date.now()<end) { if(predicate()) return; await new Promise(r=>setTimeout(r,100)) }; throw new Error('NOTES_TIMEOUT') }; const button = text => [...document.querySelectorAll('button')].find(b=>b.textContent===text);`

export async function runNotesSmoke(window: BrowserWindow, backend: Backend, reportDir: string, blocked: () => number) {
  const run = async (body: string) => {
    await writeFile(join(reportDir, 'notes-stage.txt'), body)
    return window.webContents.executeJavaScript(`(async () => { ${helpers} ${body} })()`)
  }
  const documents = await backend.request('/v1/documents') as {items: DocumentRecord[]}
  const document = documents.items[0]
  const endpoint = `/v1/notes?document_id=${document.id}`
  const existing = (await backend.request(endpoint) as {items: NoteRecord[]}).items
  await run(`if(!document.querySelector('.notes-panel')) button('笔记').click(); await wait(()=>button('新建笔记') && !button('新建笔记').disabled)`)
  if (existing.length) {
    await run(`await wait(()=>document.querySelector('.cm-content')?.textContent.includes('Saved evidence check'));`)
    if (existing[0].body_md !== fixtureBody) throw new Error('RESTART_BODY_MISMATCH')
  } else {
    await run(`button('新建笔记').click(); await wait(()=>document.querySelector('.cm-content')); document.querySelector('.cm-content').focus()`)
    await window.webContents.insertText(fixtureBody)
    await run(`await wait(()=>document.querySelector('.note-status')?.textContent.includes('未保存')); button('保存笔记').click(); await wait(()=>document.querySelector('.note-status')?.textContent.startsWith('已保存'))`)
  }
  await run(`button('预览').click(); await wait(()=>document.querySelector('.markdown-preview h1')); if(document.querySelector('.markdown-preview img,.markdown-preview script,.markdown-preview a[href]') || window.__unsafeNote) throw new Error('UNSAFE_PREVIEW')`)
  await run(`button('编辑').click(); await wait(()=>!document.querySelector('.note-editor-view').hidden && !document.querySelector('.markdown-preview')); document.querySelector('.cm-content').focus()`)
  await window.webContents.insertText('\nDRAFT retained across navigation')
  await run(`await wait(()=>document.querySelector('.note-status')?.textContent.includes('未保存')); button('返回文献库').click(); await wait(()=>button('打开阅读')); button('打开阅读').click(); await wait(()=>document.querySelector('.cm-content')?.textContent.includes('DRAFT retained')); button('House').click(); button('Storage').click(); if(!document.querySelector('.cm-content')?.textContent.includes('DRAFT retained')) throw new Error('NAVIGATION_DRAFT_LOST')`)
  const before = blocked()
  const closeProbe = await run(`const event = new Event('beforeunload', { cancelable: true }); const allowed = window.dispatchEvent(event); return {allowed, status:document.querySelector('.note-status')?.textContent}`)
  await writeFile(join(reportDir, 'close-probe.json'), JSON.stringify(closeProbe))
  if (closeProbe.allowed) throw new Error('DRAFT_NOT_MARKED_UNSAVED')
  window.close()
  await new Promise(resolve => setTimeout(resolve, 500))
  if (window.isDestroyed() || blocked() <= before || backend.status.state !== 'ready') throw new Error('CLOSE_PROTECTION_FAILED')
  // Deliberately update the saved version through the real backend to force a conflict.
  const saved = (await backend.request(endpoint) as {items: NoteRecord[]}).items[0]
  await backend.request(`/v1/notes/${saved.id}`, 'PATCH', { body_md: fixtureBody, version: saved.version })
  await run(`button('保存笔记').click(); await wait(()=>document.querySelector('.note-status')?.textContent.includes('冲突')); if(!document.querySelector('.cm-content').textContent.includes('DRAFT retained')) throw new Error('CONFLICT_DRAFT_LOST'); button('查看已保存版本').click(); await wait(()=>document.querySelector('.note-conflict pre')); button('保留我的草稿，基于此版本继续').click(); await wait(()=>!button('保存笔记').disabled); button('保存笔记').click(); await wait(()=>document.querySelector('.note-status')?.textContent.startsWith('已保存'))`)
  // Return to the exact fixture body for the next full process restart.
  await run(`document.querySelector('.cm-content').focus()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['control'] })
  await window.webContents.insertText(fixtureBody)
  await run(`await wait(()=>document.querySelector('.note-status')?.textContent.includes('未保存')); button('保存笔记').click(); await wait(()=>document.querySelector('.note-status')?.textContent.startsWith('已保存')); button('预览').click()`)
  const final = (await backend.request(endpoint) as {items: NoteRecord[]}).items[0]
  if (final.body_md !== fixtureBody) throw new Error('FINAL_BODY_MISMATCH')
  const layouts = []
  for (const [width, height] of [[1440, 1024], [1024, 768]]) {
    window.setContentSize(width, height)
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (width === 1024) await run(`await wait(()=>document.querySelector('dialog[open]'))`)
    const layout = await run(`const scope = document.querySelector('dialog[open]') || document.querySelector('.notes-sidebar'); const rect=scope.getBoundingClientRect(); return {width:innerWidth,panelFits:rect.left>=0 && rect.right<=innerWidth+1,modal:!!document.querySelector('dialog[open]'),heading:scope.querySelector('h2')?.textContent}`)
    layouts.push(layout)
    await writeFile(join(reportDir, `notes-${width}.png`), (await window.webContents.capturePage()).toPNG())
  }
  // Escape closes the narrow overlay, restores focus, and leaves the saved note available.
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await run(`await wait(()=>!document.querySelector('dialog[open]')); await wait(()=>document.activeElement === document.querySelector('.note-toggle'))`)
  if (layouts.some(layout => !layout.panelFits)) throw new Error('NOTES_PANEL_OVERFLOW')
  return { restoredFromPreviousProcess: existing.length > 0, savedVersion: final.version, draftSurvivedNavigation: true, conflictProtected: true, blockedClose: true, layouts }
}
