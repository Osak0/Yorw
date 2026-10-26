import type { BrowserWindow } from 'electron'
import type { Backend } from './backend'

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
    setValue(control('input[aria-label="新专题名称"]'), 'Topic Alpha')
    await waitFor(() => !button('创建专题').disabled, 'CREATE_ALPHA')
    button('创建专题').click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Topic Alpha'), 'ALPHA_OPEN')
    setValue(control('[aria-label="Wiki 生成要求"]'), 'alpha instruction')

    documentTab().click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'DOC_A_BACK')
    const documentAQuery = control('input[aria-label="文献内检索"]').value
    const documentAPage = control('input[aria-label="物理页码"]').value
    const documentASelected = documentTab().getAttribute('aria-selected') === 'true'

    alphaTab().click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Topic Alpha'), 'ALPHA_BACK')
    const topicAInstruction = control('[aria-label="Wiki 生成要求"]').value
    const topicASelected = alphaTab().getAttribute('aria-selected') === 'true'

    nav('Garden').click()
    await waitFor(() => document.querySelector('.garden-content')?.textContent.includes('专题目录'), 'GARDEN_HOME_B')
    setValue(control('input[aria-label="新专题名称"]'), 'Topic Beta')
    await waitFor(() => !button('创建专题').disabled, 'CREATE_BETA')
    button('创建专题').click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Topic Beta'), 'BETA_OPEN')
    setValue(control('[aria-label="Wiki 生成要求"]'), 'beta instruction')
    setValue(control('input[aria-label="专题名称"]'), 'Topic Beta Renamed')
    await waitFor(() => !button('保存目录信息').disabled, 'META_ENABLED')
    button('保存目录信息').click()
    await waitFor(() => tabs().some(tab => tab.textContent.includes('Topic Beta Renamed')), 'TOPIC_TITLE_UPDATED')
    const topicTitleUpdated = tabs().some(tab => tab.textContent.includes('Topic Beta Renamed'))

    alphaTab().click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Topic Alpha'), 'ALPHA_AGAIN')
    const topicAInstructionBack = control('[aria-label="Wiki 生成要求"]').value
    betaTab().click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Topic Beta'), 'BETA_AGAIN')
    const topicBInstruction = control('[aria-label="Wiki 生成要求"]').value
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
      topicAInstruction,
      topicAInstructionBack,
      topicBInstruction,
      topicTitleUpdated,
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
    await waitFor(()=>document.querySelector('.garden-editor h2')?.textContent.includes('Topic Alpha'),'NEXT_TOPIC')
    return {tabs:tabs().length,active:document.querySelector('.workspace-tab[aria-selected="true"]')?.textContent??'',dialogGone:!document.querySelector('.close-dialog')}
  })()`)
  await window.webContents.executeJavaScript(`(async()=>{${helpers}
    item('Topic Beta').querySelector('.workspace-tab').click()
    await waitFor(()=>document.querySelector('.garden-editor h2')?.textContent.includes('Topic Beta'),'BETA_EDITOR')
    document.querySelector('.garden-editor .cm-content').focus()
  })()`)
  await window.webContents.insertText('Unsaved wiki draft ')
  const closedOthers = await window.webContents.executeJavaScript(`(async()=>{${helpers}
    await waitFor(()=>item('Topic Beta')?.querySelector('.workspace-tab-dirty'),'DIRTY_WIKI')
    item('Topic Alpha').querySelector('.workspace-tab').click()
    await waitFor(()=>document.querySelector('.garden-editor h2')?.textContent.includes('Topic Alpha'),'ALPHA_ACTIVE')
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
