import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Backend } from './backend'
import type { Providers } from './providers'

/** Drives the real renderer through the stage-1/2 tab flow in an isolated smoke workspace. */
export async function runWorkspaceTabsSmoke(window: BrowserWindow): Promise<unknown> {
  return window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const end = Date.now() + 20000
      while (Date.now() < end) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('TABS_TIMEOUT_' + label)
    }
    const button = text => [...document.querySelectorAll('button')].find(element => element.textContent === text)
    const nav = name => [...document.querySelectorAll('.module-nav button')].find(element => element.textContent === name)
    const tabs = () => [...document.querySelectorAll('.workspace-tab')]
    const control = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error('CONTROL_MISSING:' + selector)
      return element
    }
    const setValue = (element, value) => {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const documentTab = () => tabs().find(tab => tab.textContent.includes('Reader fixture'))
    const alphaTab = () => tabs().find(tab => tab.textContent.includes('Topic Alpha'))
    const betaTab = () => tabs().find(tab => tab.textContent.includes('Topic Beta'))
    const documentBTab = () => tabs().find(tab => /synthetic study b/i.test(tab.textContent))

    button('检索').click()
    await waitFor(() => document.querySelector('input[aria-label="文献内检索"]'), 'SEARCH_A')
    setValue(control('input[aria-label="文献内检索"]'), 'evidence')

    nav('Garden').click()
    await waitFor(() => document.querySelector('.garden-content')?.textContent.includes('专题目录'), 'GARDEN_HOME_A')
    button('新建').click()
    await waitFor(() => document.querySelector('input[aria-label="新专题名称"]'), 'CREATE_FORM_A')
    setValue(control('input[aria-label="新专题名称"]'), 'Topic Alpha')
    await waitFor(() => !button('创建专题').disabled, 'CREATE_ALPHA')
    button('创建专题').click()
    await waitFor(() => document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Alpha'), 'ALPHA_OPEN')

    documentTab().click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'DOC_A_BACK')
    const documentAQuery = control('input[aria-label="文献内检索"]').value
    const documentAPage = control('input[aria-label="物理页码"]').value
    const documentASelected = documentTab().getAttribute('aria-selected') === 'true'

    alphaTab().click()
    await waitFor(() => document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Alpha'), 'ALPHA_BACK')
    const topicASelected = alphaTab().getAttribute('aria-selected') === 'true'

    nav('Garden').click()
    await waitFor(() => document.querySelector('.garden-content')?.textContent.includes('专题目录'), 'GARDEN_HOME_B')
    button('新建').click()
    await waitFor(() => document.querySelector('input[aria-label="新专题名称"]'), 'CREATE_FORM_B')
    setValue(control('input[aria-label="新专题名称"]'), 'Topic Beta')
    await waitFor(() => !button('创建专题').disabled, 'CREATE_BETA')
    button('创建专题').click()
    await waitFor(() => document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Beta'), 'BETA_OPEN')
    setValue(control('input[aria-label="专题名称"]'), 'Topic Beta Renamed')
    await waitFor(() => !button('保存目录信息').disabled, 'META_ENABLED')
    button('保存目录信息').click()
    await waitFor(() => tabs().some(tab => tab.textContent.includes('Topic Beta Renamed')), 'TOPIC_TITLE_UPDATED')
    const topicTitleUpdated = tabs().some(tab => tab.textContent.includes('Topic Beta Renamed'))

    alphaTab().click()
    await waitFor(() => document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Alpha'), 'ALPHA_AGAIN')
    betaTab().click()
    await waitFor(() => document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Beta'), 'BETA_AGAIN')
    const topicBSelected = betaTab().getAttribute('aria-selected') === 'true'

    nav('Storage').click()
    await waitFor(() => button('导入 PDF'), 'LIBRARY')
    const documentBRow = [...document.querySelectorAll('.document-row')].find(row => /synthetic study b/i.test(row.textContent))
    if (!documentBRow) throw new Error('DOCUMENT_B_MISSING')
    ;[...documentBRow.querySelectorAll('button')].find(element => element.textContent === '打开阅读').click()
    await waitFor(() => tabs().length === 4, 'DOC_B_OPEN')
    await waitFor(() => documentBTab()?.getAttribute('aria-selected') === 'true', 'DOC_B_SELECTED')
    await waitFor(() => document.querySelector('input[aria-label="物理页码"]'), 'DOC_B_READER')
    button('检索').click()
    await waitFor(() => document.querySelector('input[aria-label="文献内检索"]'), 'SEARCH_B')
    setValue(control('input[aria-label="文献内检索"]'), 'beta')
    await new Promise(resolve => setTimeout(resolve, 100))

    documentTab().click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'DOC_A_AGAIN')
    const documentAQueryBack = control('input[aria-label="文献内检索"]').value
    const documentAPageBack = control('input[aria-label="物理页码"]').value

    documentBTab().click()
    await waitFor(() => document.querySelector('input[aria-label="文献内检索"]')?.value === 'beta', 'DOC_B_RESTORED')
    const documentBQuery = control('input[aria-label="文献内检索"]').value

    documentTab().click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'FINAL_READER')
    const toolTab = kind => tabs().find(tab => tab.textContent.includes('Reader fixture') && tab.querySelector('.workspace-tab-kind')?.textContent === kind)
    const documentTabCount = () => tabs().filter(tab => tab.querySelector('.workspace-tab-kind')?.textContent === '文献' && tab.textContent.includes('Reader fixture')).length

    button('展开为标签').click()
    await waitFor(() => tabs().length === 5 && document.querySelector('.document-tool-view input[aria-label="文献内检索"]'), 'SEARCH_TOOL')
    const searchToolTab = toolTab('检索')
    const searchToolQuery = document.querySelector('.document-tool-view input[aria-label="文献内检索"]')?.value
    button('返回阅读侧栏').click()
    await waitFor(() => tabs().length === 4 && document.querySelector('.notes-sidebar input[aria-label="文献内检索"]'), 'SEARCH_BACK')
    const searchBackQuery = document.querySelector('.notes-sidebar input[aria-label="文献内检索"]')?.value
    const searchReturned = searchBackQuery === 'evidence'

    button('笔记').click()
    await waitFor(() => document.querySelector('.notes-sidebar .notes-panel'), 'NOTES_SIDEBAR')
    button('展开为标签').click()
    await waitFor(() => tabs().length === 5 && document.querySelector('.document-tool-view .notes-panel'), 'NOTES_TOOL')
    const notesToolTab = toolTab('笔记')
    button('返回阅读侧栏').click()
    await waitFor(() => tabs().length === 4 && document.querySelector('.notes-sidebar .notes-panel'), 'NOTES_BACK')
    const notesReturned = !!document.querySelector('.notes-sidebar .notes-panel')

    button('问答').click()
    await waitFor(() => document.querySelector('.notes-sidebar .chat-panel'), 'CHAT_SIDEBAR')
    button('展开为标签').click()
    await waitFor(() => tabs().length === 5 && document.querySelector('.document-tool-view .chat-panel'), 'CHAT_TOOL')
    const chatToolTab = toolTab('问答')
    const chatToolInput = !!document.querySelector('.document-tool-view [aria-label="研究问题"]')
    button('返回阅读侧栏').click()
    await waitFor(() => tabs().length === 4 && document.querySelector('.notes-sidebar .chat-panel'), 'CHAT_BACK')
    const chatReturned = !!document.querySelector('.notes-sidebar .chat-panel')

    const toolHosts = {
      search: { tabOpened: !!searchToolTab, sharedQuery: searchToolQuery, returned: searchReturned },
      notes: { tabOpened: !!notesToolTab, returned: notesReturned },
      chat: { tabOpened: !!chatToolTab, inputVisible: chatToolInput, returned: chatReturned },
      tabsAfterReturn: tabs().length,
      documentTabCount: documentTabCount()
    }
    const semanticTab = document.querySelector('.workspace-tab[aria-selected="true"]')
    const tablist = document.querySelector('[role="tablist"]')
    const panel = document.querySelector('[role="tabpanel"]')
    const closeLabel = documentTab()?.parentElement?.querySelector('.workspace-tab-close')?.getAttribute('aria-label') ?? ''
    semanticTab.focus()
    semanticTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const afterKey = document.querySelector('.workspace-tab[aria-selected="true"]')
    const keyboardMoved = afterKey !== semanticTab && document.activeElement === afterKey
    documentTab().click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'READER_AFTER_KEYBOARD')

    return {
      tabCount: tabs().length,
      titles: tabs().map(tab => tab.textContent),
      documentSelected: documentTab().getAttribute('aria-selected') === 'true',
      topicASelected,
      topicBSelected,
      documentAQuery,
      documentAPage,
      documentASelected,
      topicTitleUpdated,
      toolHosts,
      documentBQuery,
      documentAQueryBack,
      documentAPageBack,
      moduleAfterDocumentTab: nav('Storage')?.getAttribute('aria-current'),
      documentBTitle: documentBTab()?.textContent ?? '',
      semantics: { tablist: !!tablist, tab: !!semanticTab, panel: !!panel, closeLabel, keyboardMoved }
    }
  })()`)
}

/** Exercises unsaved-close, save-and-close, close-others and final close through the real UI. */
export async function runWorkspaceTabsCloseSmoke(window: BrowserWindow): Promise<unknown> {
  const waitFor = `const waitFor=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('TABS_CLOSE_TIMEOUT_'+label)}`
  const helpers = `${waitFor};const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text);const tabs=()=>[...document.querySelectorAll('.workspace-tab')];const item=text=>[...document.querySelectorAll('.workspace-tab-item')].find(element=>element.textContent.includes(text));`
  await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>tabs().length===4,'RESTORE')
    await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'READER')
    button('笔记').click()
    await waitFor(()=>document.querySelector('.notes-panel'),'NOTES')
    await waitFor(()=>!button('新建笔记').disabled,'NOTES_LOADED')
    button('新建笔记').click()
    await waitFor(()=>document.querySelector('.note-editor-view .cm-content'),'NOTE_EDITOR')
    document.querySelector('.note-editor-view .cm-content').focus()
  })()`)
  await window.webContents.insertText('Unsaved note draft ')
  const cancelled = await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>item('Reader fixture')?.querySelector('.workspace-tab-dirty'),'DIRTY_NOTE')
    item('Reader fixture').querySelector('.workspace-tab-close').click()
    await waitFor(()=>document.querySelector('.close-dialog'),'CLOSE_DIALOG')
    const title=document.querySelector('.close-dialog')?.textContent??''
    button('取消').click()
    await waitFor(()=>!document.querySelector('.close-dialog'),'CANCEL_DIALOG')
    await new Promise(resolve=>setTimeout(resolve,150))
    return {title,tabs:tabs().length,documentStillOpen:!!item('Reader fixture')}
  })()`)
  const saved = await window.webContents.executeJavaScript(`(async()=>{${helpers}
    item('Reader fixture').querySelector('.workspace-tab-close').click()
    await waitFor(()=>document.querySelector('.close-dialog'),'SAVE_DIALOG')
    button('保存并关闭').click()
    await waitFor(()=>tabs().length===3,'SAVED_CLOSE')
    await waitFor(()=>document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Alpha'),'NEXT_TOPIC')
    return {tabs:tabs().length,active:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent??'',dialogGone:!document.querySelector('.close-dialog')}
  })()`)
  await window.webContents.executeJavaScript(`(async()=>{${helpers}
    item('Topic Beta').querySelector('.workspace-tab').click()
    await waitFor(()=>document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Beta'),'BETA_EDITOR')
    document.querySelector('.topic-body-view .cm-content').focus()
  })()`)
  await window.webContents.insertText('Unsaved wiki draft ')
  const closedOthers = await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>item('Topic Beta')?.querySelector('.workspace-tab-dirty'),'DIRTY_WIKI')
    item('Topic Alpha').querySelector('.workspace-tab').click()
    await waitFor(()=>document.querySelector('.topic-body-view h2')?.textContent.includes('Topic Alpha'),'ALPHA_ACTIVE')
    button('关闭其他').click()
    await waitFor(()=>document.querySelector('.close-dialog')?.textContent.includes('Topic Beta'),'OTHERS_DIALOG')
    button('取消').click()
    await waitFor(()=>!document.querySelector('.close-dialog'),'OTHERS_CANCEL')
    await new Promise(resolve=>setTimeout(resolve,150))
    const afterCancel=tabs().length
    button('关闭其他').click()
    await waitFor(()=>document.querySelector('.close-dialog')?.textContent.includes('Topic Beta'),'OTHERS_DIALOG_2')
    button('放弃并关闭').click()
    await waitFor(()=>tabs().length===1,'OTHERS_CLOSED')
    return {afterCancel,afterDiscard:tabs().length,active:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent??''}
  })()`)
  const finished = await window.webContents.executeJavaScript(`(async()=>{${helpers}
    item('Topic Alpha').querySelector('.workspace-tab-close').click()
    await waitFor(()=>tabs().length===0,'CLOSE_LAST')
    await waitFor(()=>document.querySelector('.workspace-tab-empty'),'EMPTY_TABS')
    return {tabs:tabs().length,emptyHint:!!document.querySelector('.workspace-tab-empty'),dialog:!!document.querySelector('.close-dialog')}
  })()`)
  return { cancelled, saved, closedOthers, finished }
}

/** A failed save after backend loss must keep the tab open with its dirty indicator. */
export async function runWorkspaceTabsFaultSmoke(window: BrowserWindow, backend: Backend): Promise<unknown> {
  const helpers = `const waitFor=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('TABS_FAULT_TIMEOUT_'+label)};const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text);const tabs=()=>[...document.querySelectorAll('.workspace-tab')];const item=text=>[...document.querySelectorAll('.workspace-tab-item')].find(element=>element.textContent.includes(text));`
  await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>tabs().length===4,'RESTORE')
    await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'READER')
    button('笔记').click()
    await waitFor(()=>document.querySelector('.notes-panel'),'NOTES')
    await waitFor(()=>!button('新建笔记').disabled,'NOTES_LOADED')
    button('新建笔记').click()
    await waitFor(()=>document.querySelector('.note-editor-view .cm-content'),'NOTE_EDITOR')
    document.querySelector('.note-editor-view .cm-content').focus()
  })()`)
  await window.webContents.insertText('Unsaved fault note ')
  await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>item('Reader fixture')?.querySelector('.workspace-tab-dirty'),'DIRTY')
  })()`)
  if (!backend.processId) throw new Error('BACKEND_PROCESS_MISSING')
  process.kill(backend.processId)
  return window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>document.querySelector('.app-status.failed')?.textContent.includes('本地服务已退出'),'BACKEND_EXIT')
    item('Reader fixture').querySelector('.workspace-tab-close').click()
    await waitFor(()=>document.querySelector('.close-dialog'),'FAULT_DIALOG')
    button('保存并关闭').click()
    await waitFor(()=>!document.querySelector('.close-dialog'),'FAULT_DIALOG_CLOSED')
    await new Promise(resolve=>setTimeout(resolve,600))
    return {
      tabs: tabs().length,
      stillOpen: !!item('Reader fixture'),
      dirtyStillShown: !!item('Reader fixture')?.querySelector('.workspace-tab-dirty'),
      notice: document.querySelector('.app-notice')?.textContent ?? '',
      status: document.querySelector('.app-status.failed')?.textContent ?? ''
    }
  })()`)
}

/** Uses owned loopback models to verify a tool-tab citation opens the correct reading tab and page. */
export async function runWorkspaceCitationSmoke(window: BrowserWindow, providers: Providers): Promise<unknown> {
  const calls: Array<{ path: string; body: unknown }> = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', part => raw += part)
    req.on('end', () => {
      const body = JSON.parse(raw)
      calls.push({ path: req.url ?? '', body })
      if (req.url?.endsWith('/embeddings')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: body.input.map((_text: string, index: number) => ({ index, embedding: [1, 0] })) }))
        return
      }
      const system = body.messages[0].content, data = JSON.parse(body.messages[1].content)
      let text: string
      if (system.includes('筛选器')) {
        const parsed = JSON.parse(data.question)
        text = JSON.stringify({ items: parsed.candidates.map((item: { id: string }) => ({ id: item.id, sentence: 0 })) })
      } else if (system.includes('改写')) text = JSON.stringify({ query: 'English evidence' })
      else text = 'English fixture evidence [S1].'
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const kind of ['chat', 'embedding'] as const) {
      const old = (await providers.list()).find(config => config.kind === kind)
      await providers.save({ kind, version: old?.version ?? 0, base_url: url, model: 'local-tabs-fixture', key: `${kind}-tabs-key` })
    }
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const waitFor=async(predicate,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('CITATION_TIMEOUT_'+label)}
      const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text)
      const tabs=()=>[...document.querySelectorAll('.workspace-tab')]
      const kind=tab=>tab.querySelector('.workspace-tab-kind')?.textContent
      const setValue=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))}
      const readingTab=()=>tabs().find(tab=>tab.textContent.includes('Reader fixture')&&kind(tab)==='文献')
      const searchToolTab=()=>tabs().find(tab=>tab.textContent.includes('Reader fixture')&&kind(tab)==='检索')
      await waitFor(()=>tabs().length===4,'RESTORE')
      await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'READER')
      const previous=document.querySelector('[aria-label="上一页"]')
      if(previous&&!previous.disabled){previous.click();await waitFor(()=>document.querySelector('input[aria-label="物理页码"]')?.value==='1','PAGE_ONE')}
      const startPage=document.querySelector('input[aria-label="物理页码"]')?.value
      button('检索').click()
      await waitFor(()=>document.querySelector('.notes-sidebar input[aria-label="文献内检索"]'),'SEARCH')
      setValue(document.querySelector('.notes-sidebar input[aria-label="文献内检索"]'),'English evidence')
      await waitFor(()=>!button('搜索').disabled,'SEARCH_ENABLED')
      button('搜索').click()
      await waitFor(()=>document.querySelector('.search-hit'),'HIT')
      const hitPage=Number(document.querySelector('.search-hit small')?.textContent.match(/\\d+/)?.[0])
      button('展开为标签').click()
      await waitFor(()=>tabs().length===5&&document.querySelector('.document-tool-view .search-hit'),'TOOL')
      const toolHits=document.querySelectorAll('.document-tool-view .search-hit').length
      document.querySelector('.document-tool-view .search-hit button:last-child').click()
      await waitFor(()=>readingTab()?.getAttribute('aria-selected')==='true'&&document.querySelector('input[aria-label="物理页码"]')?.value===String(hitPage),'JUMP')
      const jumpPage=document.querySelector('input[aria-label="物理页码"]')?.value
      readingTab().parentElement.querySelector('.workspace-tab-close').click()
      await waitFor(()=>tabs().length===4,'CLOSE_READING')
      searchToolTab().click()
      await waitFor(()=>document.querySelector('.document-tool-view .search-hit'),'TOOL_AGAIN')
      document.querySelector('.document-tool-view .search-hit button:last-child').click()
      await waitFor(()=>tabs().length===5,'CREATE_READING')
      await waitFor(()=>readingTab()?.getAttribute('aria-selected')==='true'&&document.querySelector('input[aria-label="物理页码"]')?.value===String(hitPage),'JUMP_CREATED')
      return {
        startPage,
        hitPage,
        toolHits,
        jumpPage,
        readingSelectedAfterJump:true,
        readingRecreated:!!readingTab(),
        searchToolKept:!!searchToolTab(),
        tabCountAfterCreate:tabs().length,
        otherDocumentKept:tabs().some(tab=>/synthetic study b/i.test(tab.textContent))
      }
    })()`)
    return { ...(result as Record<string, unknown>), modelRequests: calls.length }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

/** Checks chat input and Garden directory/editor fit at the two requested workstation sizes. */
export async function runWorkspaceLayoutSmoke(window: BrowserWindow, reportDir: string): Promise<unknown> {
  const ui = (code: string) => window.webContents.executeJavaScript(`(async()=>{
    const wait=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('LAYOUT_SMOKE_TIMEOUT_'+label)}
    const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text)
    ${code}
  })()`)
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const sizes: Array<[number, number]> = [[1280, 720], [1440, 900]]
  const result: { chat: unknown[]; garden: unknown[]; narrow?: unknown; tool?: unknown[]; directoryCollapsed?: unknown; toolBack?: unknown } = { chat: [], garden: [] }
  await ui(`document.querySelector('.chat-toggle').click();await wait(()=>document.querySelector('[aria-label="研究问题"]'),'CHAT')`)
  for (const [width, height] of sizes) {
    window.setContentSize(width, height)
    await pause(800)
    const check = await window.webContents.executeJavaScript(`(() => {
      const inside = element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
      const input = document.querySelector('[aria-label="研究问题"]')
      const panel = document.querySelector('.chat-panel')
      return { width: innerWidth, height: innerHeight, inputVisible: !!input && inside(input), panelVisible: !!panel && inside(panel), horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
    })()`)
    result.chat.push(check)
    await writeFile(join(reportDir, `chat-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await ui(`document.querySelector('.module-nav button:nth-child(2)').click();await wait(()=>document.querySelector('[data-topic-id]'),'GARDEN');document.querySelector('[data-topic-id]').click();await wait(()=>document.querySelector('.topic-body-view'),'EDITOR')`)
  const normalContentWidth = await window.webContents.executeJavaScript(`document.querySelector('.garden-content')?.getBoundingClientRect().width??0`)
  await ui(`button('收起目录').click();await wait(()=>!document.querySelector('.garden-directory'),'COLLAPSE')`)
  const collapsed = await window.webContents.executeJavaScript(`(() => { const content=document.querySelector('.garden-content'); return { directoryGone: !document.querySelector('.garden-directory'), expandVisible: document.querySelector('.garden-content-bar button')?.textContent === '展开目录', contentWidth: content?.getBoundingClientRect().width ?? 0 } })()`)
  await writeFile(join(reportDir, 'garden-collapsed.png'), (await window.webContents.capturePage()).toPNG())
  await ui(`button('展开目录').click();await wait(()=>document.querySelector('.garden-directory'),'EXPAND')`)
  result.directoryCollapsed = { ...collapsed, normalContentWidth, wider: collapsed.contentWidth > normalContentWidth }
  for (const [width, height] of sizes) {
    window.setContentSize(width, height)
    await pause(800)
    const check = await window.webContents.executeJavaScript(`(() => {
      const inside = element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
      const workspace = document.querySelector('.garden-workspace')
      const directory = document.querySelector('.garden-directory')
      const content = document.querySelector('.garden-content')
      return { width: innerWidth, height: innerHeight, workspaceVisible: !!workspace && inside(workspace), directoryVisible: !!directory && inside(directory), contentVisible: !!content && inside(content), editor: !!document.querySelector('.topic-body-view'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
    })()`)
    result.garden.push(check)
    await writeFile(join(reportDir, `garden-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await ui(`const docTab=[...document.querySelectorAll('.workspace-tab')].find(tab=>tab.textContent.includes('Reader fixture'));docTab.click();await wait(()=>document.querySelector('.reader-feedback'),'DOC')`)
  window.setContentSize(1024, 768)
  await pause(800)
  await ui(`await wait(()=>document.querySelector('.notes-overlay[open]'),'OVERLAY')`)
  const narrow = await window.webContents.executeJavaScript(`(() => {
    const inside = element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
    const overlay = document.querySelector('.notes-overlay[open]')
    const input = document.querySelector('.notes-overlay [aria-label="研究问题"]')
    return { width: innerWidth, height: innerHeight, overlayVisible: !!overlay && inside(overlay), inputVisible: !!input && inside(input), horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
  })()`)
  await writeFile(join(reportDir, 'narrow-1024x768.png'), (await window.webContents.capturePage()).toPNG())
  await ui(`const close=[...document.querySelectorAll('.notes-overlay button')].find(button=>button.textContent==='关闭');close.click();await wait(()=>!document.querySelector('.notes-overlay'),'OVERLAY_CLOSE');await new Promise(resolve=>setTimeout(resolve,150))`)
  const focusReturned = await window.webContents.executeJavaScript(`document.activeElement?.classList.contains('chat-toggle') ?? false`)
  result.narrow = { ...narrow, focusReturned }
  await ui(`document.querySelector('.chat-toggle').click();await wait(()=>document.querySelector('.notes-heading-actions'),'SIDEBAR');[...document.querySelectorAll('.notes-heading-actions button')].find(button=>button.title==='展开为标签').click();await wait(()=>document.querySelector('.document-tool-view .chat-panel'),'TOOL')`)
  result.tool = []
  for (const [width, height] of sizes) {
    window.setContentSize(width, height)
    await pause(800)
    const check = await window.webContents.executeJavaScript(`(() => {
      const inside = element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
      const tool = document.querySelector('.document-tool-view')
      const header = document.querySelector('.document-tool-header')
      const body = document.querySelector('.document-tool-body')
      const input = document.querySelector('.document-tool-view [aria-label="研究问题"]')
      return { width: innerWidth, height: innerHeight, toolVisible: !!tool && inside(tool), headerVisible: !!header && inside(header), bodyVisible: !!body && inside(body), inputVisible: !!input && inside(input), horizontalOverflow: document.documentElement.scrollWidth > innerWidth }
    })()`)
    ;(result.tool as unknown[]).push(check)
    await writeFile(join(reportDir, `tool-chat-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
  }
  const toolBack = await window.webContents.executeJavaScript(`(async()=>{
    const back=[...document.querySelectorAll('button')].find(element=>element.textContent==='返回阅读侧栏')
    if(!back)return {button:false}
    back.click()
    await new Promise(resolve=>setTimeout(resolve,500))
    return {button:true,sidebar:!!document.querySelector('.notes-sidebar'),chat:!!document.querySelector('.notes-sidebar .chat-panel'),reader:!!document.querySelector('.reader-feedback'),active:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent??''}
  })()`)
  result.toolBack = toolBack
  if (!(toolBack as any).chat) throw new Error('TOOL_BACK_FAILED:'+JSON.stringify(toolBack))
  await writeFile(join(reportDir, 'layout-panels.json'), JSON.stringify(result, null, 2))
  const chatOk = result.chat.every((item: any) => item.inputVisible && item.panelVisible && !item.horizontalOverflow)
  const gardenOk = result.garden.every((item: any) => item.workspaceVisible && item.directoryVisible && item.contentVisible && item.editor && !item.horizontalOverflow)
  const narrowOk = (result.narrow as any).overlayVisible && (result.narrow as any).inputVisible && !(result.narrow as any).horizontalOverflow && focusReturned
  const toolOk = (result.tool as any[]).every(item => item.toolVisible && item.headerVisible && item.bodyVisible && item.inputVisible && !item.horizontalOverflow)
  const directoryOk = (result.directoryCollapsed as any).directoryGone && (result.directoryCollapsed as any).expandVisible && (result.directoryCollapsed as any).wider
  if (!chatOk || !gardenOk || !narrowOk || !toolOk || !directoryOk) throw new Error('PANEL_LAYOUT_FAILED')
  return result
}

/** Streams a long answer through the real chat layout and verifies scroll, stop, retry and note actions. */
export async function runWorkspaceChatSmoke(window: BrowserWindow, providers: Providers): Promise<unknown> {
  const calls: Array<{ path: string; body: unknown }> = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', part => raw += part)
    req.on('end', () => {
      const body = JSON.parse(raw)
      calls.push({ path: req.url ?? '', body })
      if (req.url?.endsWith('/embeddings')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: body.input.map((_text: string, index: number) => ({ index, embedding: [1, 0] })) }))
        return
      }
      const system = body.messages[0].content, data = JSON.parse(body.messages[1].content)
      if (system.includes('筛选器') || system.includes('改写')) {
        const text = system.includes('筛选器')
          ? JSON.stringify({ items: JSON.parse(data.question).candidates.map((item: { id: string }) => ({ id: item.id, sentence: 0 })) })
          : JSON.stringify({ query: 'English evidence' })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunks = ['Long answer [S1]. ', ...Array.from({ length: 60 }, (_value, index) => `Segment ${index + 1} keeps the response growing. `)]
      let index = 0
      const timer = setInterval(() => {
        if (res.writableEnded) return
        if (index < chunks.length) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[index] } }] }) + '\n\n')
          index++
        } else {
          clearInterval(timer)
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
          res.end()
        }
      }, 100)
      res.on('close', () => clearInterval(timer))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const kind of ['chat', 'embedding'] as const) {
      const old = (await providers.list()).find(config => config.kind === kind)
      await providers.save({ kind, version: old?.version ?? 0, base_url: url, model: 'local-tabs-chat', key: `${kind}-tabs-chat-key` })
    }
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const waitFor=async(predicate,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('CHAT_SMOKE_TIMEOUT_'+label)}
      const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text)
      const messages=()=>document.querySelectorAll('.chat-message')
      const setValue=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))}
      const inside=element=>{const r=element.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}
      await waitFor(()=>document.querySelectorAll('.workspace-tab').length===4,'RESTORE')
      await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'READER')
      button('问答').click()
      await waitFor(()=>document.querySelector('.chat-panel [aria-label="研究问题"]'),'CHAT')
      const input=document.querySelector('.chat-panel [aria-label="研究问题"]'),history=document.querySelector('.chat-history')
      const inputBelowHistory=input.getBoundingClientRect().top>=history.getBoundingClientRect().bottom-1
      setValue(input,'Explain the evidence')
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))
      await waitFor(()=>messages().length===1,'MESSAGE')
      await waitFor(()=>document.querySelector('.chat-answer .markdown-preview')?.textContent.length>1000,'STREAM')
      const firstLength=document.querySelector('.chat-answer .markdown-preview')?.textContent.length??0
      await waitFor(()=>document.querySelector('.chat-answer .markdown-preview')?.textContent.length>firstLength,'STREAM_GROWTH')
      const secondLength=document.querySelector('.chat-answer .markdown-preview')?.textContent.length??0
      history.scrollTop=0
      history.dispatchEvent(new Event('scroll',{bubbles:true}))
      await waitFor(()=>document.querySelector('.chat-latest'),'LATEST')
      const latestVisible=!!document.querySelector('.chat-latest')
      document.querySelector('.chat-latest').click()
      await waitFor(()=>!document.querySelector('.chat-latest'),'LATEST_CLICK')
      const latestDismissed=!document.querySelector('.chat-latest')
      await waitFor(()=>button('停止'),'STOP')
      button('停止').click()
      await waitFor(()=>!button('停止'),'STOPPED')
      const partial=document.querySelector('.chat-answer .markdown-preview')?.textContent.length??0
      const stoppedCount=messages().length
      await waitFor(()=>button('重新回答'),'RETRY')
      button('重新回答').click()
      await waitFor(()=>messages().length===2,'RETRY_MESSAGE')
      await waitFor(()=>messages()[1]?.querySelector('.markdown-preview')?.textContent.length>50,'RETRY_STREAM')
      await waitFor(()=>!button('停止'),'RETRY_DONE')
      const preview=document.querySelector('.chat-answer .markdown-preview')
      const previewStyle=preview?getComputedStyle(preview):null
      const answerOverflow=previewStyle?.overflowY??null
      const answerMaxHeight=previewStyle?.maxHeight??null
      const retryLength=messages()[1]?.querySelector('.markdown-preview')?.textContent.length??0
      const retriedMessages=messages().length
      const imeStartCount=messages().length
      setValue(input,'IME question')
      input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))
      await new Promise(resolve=>setTimeout(resolve,300))
      const imeBlocked=messages().length===imeStartCount
      input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))
      await waitFor(()=>messages().length===imeStartCount+1,'IME_SEND')
      const imeSent=messages().length===imeStartCount+1
      const imeMessages=messages().length
      const inputVisible=inside(input)
      await waitFor(()=>button('保存到笔记'),'NOTE_BUTTON')
      button('保存到笔记').click()
      await waitFor(()=>document.querySelector('.notes-panel'),'NOTE_OPEN')
      return {
        inputBelowHistory,
        streamed:secondLength>firstLength,
        latestVisible,
        latestDismissed,
        partialLength:partial,
        stoppedMessageCount:stoppedCount,
        retriedMessages,
        retryLength,
        imeBlocked,
        imeSent,
        imeMessages,
        answerOverflow,
        answerMaxHeight,
        inputVisible,
        noteOpened:!!document.querySelector('.notes-panel')
      }
    })()`)
    return { ...(result as Record<string, unknown>), modelRequests: calls.length }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

/** Checks a restored search tool tab can render and return to the reader. */
export async function runWorkspaceTabsToolResumeSmoke(window: BrowserWindow): Promise<unknown> {
  return window.webContents.executeJavaScript(`(async()=>{
    const waitFor=async(predicate,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('TOOL_RESUME_TIMEOUT_'+label)}
    const tabs=()=>[...document.querySelectorAll('.workspace-tab')]
    const kind=tab=>tab.querySelector('.workspace-tab-kind')?.textContent
    const findTab=value=>tabs().find(tab=>tab.textContent.includes('Reader fixture')&&kind(tab)===value)
    await waitFor(()=>findTab('文献')?.getAttribute('aria-selected')==='true','ACTIVE')
    await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'READER')
    const tabCount=tabs().length
    const titles=tabs().map(tab=>tab.textContent)
    findTab('检索').click()
    await waitFor(()=>document.querySelector('.document-tool-view .search-panel'),'TOOL')
    const toolHeader=document.querySelector('.document-tool-view')?.textContent??''
    findTab('文献').click()
    await waitFor(()=>document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'),'RETURN')
    return {tabCount,titles,searchToolRestored:!!findTab('检索'),toolOpened:!!toolHeader,readerPage:document.querySelector('input[aria-label="物理页码"]')?.value??'',active:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent??''}
  })()`)
}

/** Checks the layout restored from the previous run in the same isolated workspace. */
export async function runWorkspaceTabsResumeSmoke(window: BrowserWindow): Promise<unknown> {
  return window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const end = Date.now() + 20000
      while (Date.now() < end) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('TABS_RESUME_TIMEOUT_' + label)
    }
    await waitFor(() => document.querySelectorAll('.workspace-tab').length === 4, 'TABS')
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'READER')
    const tabs = [...document.querySelectorAll('.workspace-tab')]
    return {
      tabCount: tabs.length,
      titles: tabs.map(tab => tab.textContent),
      activeTitle: document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent ?? '',
      module: document.querySelector('.module-nav button[aria-current="page"]')?.textContent ?? '',
      page: document.querySelector('input[aria-label="物理页码"]')?.value ?? '',
      sidebar: [...document.querySelectorAll('.workspace-panel-tabs button')].find(button => button.getAttribute('aria-pressed') === 'true')?.textContent ?? ''
    }
  })()`)
}
