import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { Backend } from './backend'
import { Providers } from './providers'
import { Documents } from './documents'
import { Notes } from './notes'
import { Search } from './search'
import { Chat } from './chat'
import { Garden } from './garden'
import { Suggestions } from './suggestions'
import { Workspace } from './workspace'
import { Layout } from './layout'
import { Intelligence } from './intelligence'
import { Resources } from './resources'
import {runAiWorkflowSmoke,resumeAiWorkflowSmoke} from './ai-workflow-smoke'
import {runResourceRelationsSmoke,runWorkspaceChatSmoke,runWorkspaceCitationSmoke,runWorkspaceLayoutSmoke,runWorkspaceTabsCloseSmoke,runWorkspaceTabsFaultSmoke,runWorkspaceTabsResumeSmoke,runWorkspaceTabsSmoke,runWorkspaceTabsToolResumeSmoke} from './workspace-tabs-smoke'

let backend: Backend
let quitting = false
const smokeProfile = process.argv.includes('--yorw-smoke') ? process.argv.find(arg=>arg.startsWith('--report-dir='))?.slice(13) : undefined
if(smokeProfile){const profile=join(resolve(smokeProfile),'electron-profile');mkdirSync(profile,{recursive:true});app.setPath('userData',profile)}
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Yorw-development'))
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  const root = resolve(__dirname, '../../../..')
  const smokeReport = process.argv.find(arg => arg.startsWith('--report-dir='))?.slice(13)
  const readerSmoke = process.argv.includes('--yorw-smoke') && process.argv.includes('--reader-smoke') && !!smokeReport
  const workspacePath = readerSmoke ? join(smokeReport!, 'workspace') : join(app.getPath('userData'), 'workspace')
  backend = app.isPackaged
    ? new Backend(join(process.resourcesPath, 'backend/yorw-api/yorw-api.exe'), [], process.resourcesPath, workspacePath)
    : new Backend(join(root, 'services/api/.venv/Scripts/python.exe'), ['-m', 'yorw_api'], join(root, 'services/api/src'), workspacePath)
  const window = new BrowserWindow({ show: !process.argv.includes('--yorw-smoke'), width: 1200, height: 800, minWidth: 900, minHeight: 640, title: '知栖 Yorw', webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: !!smokeProfile } })
  if (readerSmoke) window.webContents.on('render-process-gone', (_event, details) => { void writeFile(join(smokeReport!, 'renderer-exit.json'), JSON.stringify(details)) })
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const allowed = (url: string) => devUrl ? url === devUrl || url === devUrl + '/' : url === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  ipcMain.handle('app:getStatus', event => {
    if (window.isDestroyed()) return backend.status
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed(event.senderFrame.url)) throw new Error('IPC_DENIED')
    return backend.status
  })
  const providers = new Providers(backend, join(readerSmoke ? smokeReport! : app.getPath('userData'), 'secrets'))
  const providerAction = (action: (input: any) => Promise<unknown>) => async (event: Electron.IpcMainInvokeEvent, input: unknown) => {
    if (window.isDestroyed()) throw new Error('WINDOW_CLOSED')
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed(event.senderFrame.url)) throw new Error('IPC_DENIED')
    try { return { ok: true, value: await action(input) } }
    catch (error) {
      const code = error instanceof Error && ['INVALID_CITATION','SUGGESTION_DECIDED','SUGGESTION_NOT_READY','INVALID_EXPORT_SELECTION','EXPORT_TOO_LARGE','EXPORT_UNAVAILABLE','EXPORT_DESTINATION_PROTECTED','SUGGESTION_NOT_FOUND', 'MATERIAL_CHANGED', 'MATERIAL_TOO_LARGE_OR_EMPTY', 'CONTEXT_TOO_LARGE', 'DUPLICATE_MATERIAL', 'SUGGESTION_RUNNING', 'REQUEST_CONFLICT', 'TOPIC_NOT_FOUND', 'TOPIC_CONFLICT', 'TOPIC_CYCLE', 'REVISION_CONFLICT', 'CONFIG_MISSING', 'CHAT_RUNNING', 'MESSAGE_NOT_FOUND', 'ANSWER_NOT_COMPLETE', 'TEXT_NOT_READY', 'CONFIG_CHANGED', 'KEY_MISSING', 'INDEX_TOO_LARGE', 'INDEX_SOURCE_CHANGED', 'NOTE_CONFLICT', 'NOTE_NOT_FOUND', 'DOCUMENT_FILE_MISSING', 'INVALID_PAGE', 'PAGE_COUNT_UNAVAILABLE', 'INVALID_INPUT', 'INVALID_LAYOUT', 'PDF_TOO_LARGE', 'NOT_PDF', 'DOCUMENT_CONFLICT', 'DOCUMENT_NOT_FOUND', 'TASK_RUNNING', 'FILE_CLEANUP_PENDING', 'INVALID_METADATA', 'RELATION_SELF', 'SEARCH_HISTORY_NOT_FOUND', 'SCOPE_CHANGED', 'NO_SCOPED_MATERIALS', 'INVALID_CONFIG', 'CONFIG_CONFLICT', 'KEY_REENTRY_REQUIRED', 'KEY_UNAVAILABLE', 'SECURE_STORAGE_UNAVAILABLE', 'BACKEND_NOT_READY'].includes(error.message) ? error.message : 'OPERATION_FAILED'
      return { ok: false, code }
    }
  }
  const suggestions = new Suggestions(backend,providers)
  const intelligence = new Intelligence(backend,providers)
  const layout = new Layout(readerSmoke ? smokeReport! : app.getPath('userData'))
  ipcMain.handle('layout:load',providerAction(()=>layout.load()))
  ipcMain.handle('layout:save',providerAction(input=>layout.save(input)))
  ipcMain.handle('ai:preferences',providerAction(()=>intelligence.preferences()))
  ipcMain.handle('ai:savePreferences',providerAction(input=>intelligence.savePreferences(input)))
  ipcMain.handle('ai:run',providerAction(input=>intelligence.run(input)))
  ipcMain.handle('ai:get',providerAction(input=>intelligence.get(input)))
  ipcMain.handle('ai:latest',providerAction(input=>intelligence.latest(input)))
  ipcMain.handle('ai:cancel',providerAction(input=>intelligence.cancel(input)))
  ipcMain.handle('suggestions:catalog',providerAction(()=>suggestions.catalog()))
  ipcMain.handle('suggestions:preview',providerAction(input=>suggestions.preview(input)))
  ipcMain.handle('suggestions:generate',providerAction(input=>suggestions.generate(input)))
  ipcMain.handle('suggestions:list',providerAction(input=>suggestions.list(input)))
  ipcMain.handle('suggestions:cancel',providerAction(input=>suggestions.cancel(input)))
  const workspace = new Workspace(backend,workspacePath,readerSmoke ? smokeReport! : app.getPath('userData'))
  ipcMain.handle('workspace:info',providerAction(()=>workspace.info()))
  ipcMain.handle('workspace:catalog',providerAction(()=>workspace.catalog()))
  ipcMain.handle('workspace:create',providerAction(input=>workspace.create(input)))
  ipcMain.handle('workspace:save',providerAction(input=>workspace.save(input)))
  const garden = new Garden(backend)
  ipcMain.handle('garden:accept',providerAction(input=>garden.accept(input)))
  ipcMain.handle('garden:reject',providerAction(input=>garden.reject(input)))
  ipcMain.handle('garden:restore',providerAction(input=>garden.restore(input)))
  ipcMain.handle('garden:list',providerAction(()=>garden.list()))
  ipcMain.handle('garden:get',providerAction(input=>garden.get(input)))
  ipcMain.handle('garden:create',providerAction(input=>garden.create(input)))
  ipcMain.handle('garden:update',providerAction(input=>garden.update(input)))
  ipcMain.handle('garden:save',providerAction(input=>garden.save(input)))
  ipcMain.handle('garden:history',providerAction(input=>garden.history(input)))
  const documents = new Documents(backend)
  const notes = new Notes(backend)
  const resources = new Resources(backend)
  ipcMain.handle('resources:resource', providerAction(input => resources.resource(input)))
  ipcMain.handle('resources:searchHistory', providerAction(input => resources.searchHistory(input)))
  ipcMain.handle('resources:deleteSearchHistory', providerAction(input => resources.deleteSearchHistory(input)))
  ipcMain.handle('resources:clearSearchHistory', providerAction(input => resources.clearSearchHistory(input)))
  ipcMain.handle('resources:candidates', providerAction(input => resources.candidates(input)))
  ipcMain.handle('resources:searchDocuments', providerAction(input => resources.searchDocuments(input)))
  ipcMain.handle('resources:relations', providerAction(input => resources.relations(input)))
  ipcMain.handle('resources:addRelation', providerAction(input => resources.addRelation(input)))
  ipcMain.handle('resources:removeRelation', providerAction(input => resources.removeRelation(input)))
  ipcMain.handle('resources:documentTopics', providerAction(input => resources.documentTopics(input)))
  ipcMain.handle('resources:addDocumentTopic', providerAction(input => resources.addDocumentTopic(input)))
  ipcMain.handle('resources:removeDocumentTopic', providerAction(input => resources.removeDocumentTopic(input)))
  ipcMain.handle('resources:topicMaterials', providerAction(input => resources.topicMaterials(input)))
  ipcMain.handle('resources:addTopicDocument', providerAction(input => resources.addTopicDocument(input)))
  ipcMain.handle('resources:removeTopicDocument', providerAction(input => resources.removeTopicDocument(input)))
  const chat = new Chat(backend, providers)
  ipcMain.handle('chat:list', providerAction(input => chat.list(input)))
  ipcMain.handle('chat:ask', providerAction(input => chat.ask(input)))
  ipcMain.handle('chat:cancel', providerAction(input => chat.cancel(input)))
  ipcMain.handle('chat:note', providerAction(input => chat.note(input)))
  const search = new Search(backend, providers)
  ipcMain.handle('search:status', providerAction(input => search.status(input)))
  ipcMain.handle('search:index', providerAction(input => search.index(input)))
  ipcMain.handle('search:query', providerAction(input => search.query(input)))
  ipcMain.handle('search:cancel', providerAction(input => search.cancel(input)))
  ipcMain.handle('notes:list', providerAction(input => notes.list(input)))
  ipcMain.handle('notes:save', providerAction(input => notes.save(input)))
  ipcMain.handle('documents:readPdf', providerAction(input => documents.readPdf(input)))
  ipcMain.handle('documents:savePosition', providerAction(input => documents.savePosition(input)))
  ipcMain.handle('documents:list', providerAction(() => documents.list()))
  ipcMain.handle('documents:importPdf', providerAction(() => documents.importPdf()))
  ipcMain.handle('documents:importPdfs', providerAction(() => documents.importPdfs()))
  ipcMain.handle('documents:update', providerAction(input => documents.update(input)))
  ipcMain.handle('documents:remove', providerAction(input => documents.remove(input)))
  ipcMain.handle('tasks:get', providerAction(input => documents.task(input)))
  ipcMain.handle('tasks:cancel', providerAction(input => documents.cancel(input)))
  ipcMain.handle('tasks:retry', providerAction(input => documents.retry(input)))
  ipcMain.handle('providers:list', providerAction(() => providers.list()))
  ipcMain.handle('providers:save', providerAction(input => providers.save(input)))
  ipcMain.handle('providers:test', providerAction(input => providers.test(input)))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'warning', title: '内容尚未保存', message: '有未保存的笔记、专题正文或正在保存的内容。', detail: '继续编辑以保存；放弃后关闭或重新加载会丢失本次草稿。', buttons: ['继续编辑', '放弃草稿并继续'], defaultId: 0, cancelId: 0, noLink: true })
    if (choice === 1) event.preventDefault()
  })
  window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  await backend.start()
  if (process.argv.includes('--yorw-smoke')) {
    const reportDir = process.argv.find(arg => arg.startsWith('--report-dir='))?.slice(13)
    if (!reportDir) { app.exit(2); return }
    try {
      await new Promise(resolve => setTimeout(resolve, 1100))
      const secureStorage = await safeStorage.isAsyncEncryptionAvailable() && (await safeStorage.decryptStringAsync(await safeStorage.encryptStringAsync('yorw-fixture'))).result === 'yorw-fixture'
      let readerProof: unknown = null
      if (readerSmoke && !process.argv.includes('--mvp-resume-smoke')&&!process.argv.includes('--ai-resume-smoke')&&!process.argv.includes('--tabs-resume-smoke')&&!process.argv.includes('--tabs-close-smoke')&&!process.argv.includes('--tabs-fault-smoke')&&!process.argv.includes('--tabs-citation-smoke')&&!process.argv.includes('--tabs-tool-resume-smoke')&&!process.argv.includes('--tabs-chat-smoke')) {
        const fixture = await readFile(join(reportDir, 'fixture.pdf'))
        const upload = new FormData()
        upload.append('file', new Blob([fixture]), 'Reader fixture.pdf')
        await backend.request('/v1/documents/import', 'POST', upload)
        readerProof = await window.webContents.executeJavaScript(`(async () => {
          const waitFor = async (predicate) => { const end = Date.now() + 20000; while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 100)) }; throw new Error('READER_TIMEOUT') }
          const button = text => [...document.querySelectorAll('button')].find(x => x.textContent === text)
          await waitFor(() => button('打开阅读'))
          button('打开阅读').click()
          await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存'))
          const next = document.querySelector('[aria-label="下一页"]')
          if (!next.disabled) next.click()
          await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'))
          const before = document.querySelector('.pdf-page canvas').width
          const select = document.querySelector('select[aria-label="缩放"]')
          select.value = '1.5'; select.dispatchEvent(new Event('change', { bubbles: true }))
          await waitFor(() => document.querySelector('.pdf-page canvas').width !== before && document.querySelector('.reader-feedback')?.textContent.includes('已保存'))
          button('返回文献库').click()
          await waitFor(() => button('打开阅读'))
          await new Promise(r => setTimeout(r, 1300))
          button('打开阅读').click()
          await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'))
          await new Promise(r => setTimeout(r, 1000))
          await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'))
          const text = document.querySelector('.textLayer').textContent
          if (text !== 'Yorw fixed English fixture evidence.') throw new Error('TEXT_LAYER_MISMATCH')
          const canvas = document.querySelector('.pdf-page canvas')
          const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
          let dark = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150 && pixels[i+1] < 150 && pixels[i+2] < 150 && pixels[i+3] > 0) dark++
          if (!dark) throw new Error('EMPTY_CANVAS')
          return { restoredPage: 2, darkPixels: dark, text: document.querySelector('.textLayer').textContent }
        })()`)
      } else if(!readerSmoke) {
        await window.webContents.executeJavaScript(`document.querySelectorAll('nav button')[${process.argv.includes('--storage-smoke') ? 0 : 2}].click()` )
      }
      await new Promise(resolve => setTimeout(resolve, 400))
      if (readerSmoke && (process.argv.includes('--tabs-smoke') || process.argv.includes('--tabs-resource-smoke'))) {
        const second = await readFile(join(reportDir, 'fixture2.pdf'))
        const upload = new FormData()
        upload.append('file', new Blob([second]), 'SyntheticStudyB.pdf')
        await backend.request('/v1/documents/import', 'POST', upload)
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
          const documents = await backend.request('/v1/documents')
          if (documents.items.some((item: { original_name: string }) => item.original_name === 'SyntheticStudyB.pdf')) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      const tabProof = readerSmoke && process.argv.includes('--tabs-smoke') ? await runWorkspaceTabsSmoke(window) : null
      const tabResumeProof = readerSmoke && process.argv.includes('--tabs-resume-smoke') ? await runWorkspaceTabsResumeSmoke(window) : null
      const citationProof = readerSmoke && process.argv.includes('--tabs-citation-smoke') ? await runWorkspaceCitationSmoke(window,providers) : null
      const chatProof = readerSmoke && process.argv.includes('--tabs-chat-smoke') ? await runWorkspaceChatSmoke(window,providers) : null
      const toolResumeProof = readerSmoke && process.argv.includes('--tabs-tool-resume-smoke') ? await runWorkspaceTabsToolResumeSmoke(window) : null
      const resourceProof = readerSmoke && process.argv.includes('--tabs-resource-smoke') ? await runResourceRelationsSmoke(window, backend) : null
      const tabCloseProof = readerSmoke && process.argv.includes('--tabs-close-smoke') ? await runWorkspaceTabsCloseSmoke(window) : null
      if (tabCloseProof) {
        const documents = await backend.request('/v1/documents')
        const reader = documents.items.find((item: { title?: string }) => item.title === 'Reader fixture')
        const notes = reader ? await backend.request(`/v1/notes?document_id=${reader.id}`) : { items: [] }
        if (!notes.items.some((note: { body_md: string }) => note.body_md.includes('Unsaved note draft'))) throw new Error('CLOSE_SAVE_NOTE_MISSING')
      }
      let faultObserved=false
      const tabFaultProof = readerSmoke && process.argv.includes('--tabs-fault-smoke') ? await runWorkspaceTabsFaultSmoke(window,backend) : null
      if(tabFaultProof)faultObserved=true
      if(readerSmoke&&process.argv.includes('--ai-workflow-smoke'))faultObserved=await runAiWorkflowSmoke(window,backend,providers,reportDir,process.argv.includes('--ai-fault-smoke'))
      if(readerSmoke&&process.argv.includes('--ai-resume-smoke'))await resumeAiWorkflowSmoke(window,backend,reportDir)
      if(readerSmoke && process.argv.includes('--mvp-smoke')) faultObserved=await runAiWorkflowSmoke(window,backend,providers,reportDir,true)
      if(readerSmoke && process.argv.includes('--mvp-resume-smoke')) await resumeAiWorkflowSmoke(window,backend,reportDir)
      const probe = await window.webContents.executeJavaScript(`(async () => ({status: await window.yorw.getStatus(), nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined', bridgeKeys: Object.keys(window.yorw), navigation: [...document.querySelectorAll('nav button')].map(x => x.textContent)}))()`)
      await mkdir(reportDir, { recursive: true })
      await writeFile(join(reportDir, 'desktop-smoke.json'), JSON.stringify({ ...probe, secureStorage, readerProof, tabProof, tabResumeProof, citationProof, chatProof, toolResumeProof, resourceProof, tabCloseProof, tabFaultProof }, null, 2))
      await writeFile(join(reportDir, 'desktop.png'), (await window.webContents.capturePage()).toPNG())
      if (resourceProof) {
        const layouts = []
        const openView = async (kind: string, title: string, selector: string) => {
          const opened = await window.webContents.executeJavaScript(`(async () => {
            const wait = async predicate => { const end = Date.now() + 8000; while (Date.now() < end) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 100)) } return false }
            const tab = [...document.querySelectorAll('.workspace-tab')].find(item => item.querySelector('.workspace-tab-kind')?.textContent === ${JSON.stringify(kind)} && item.textContent.includes(${JSON.stringify(title)}))
            if (!tab) return false
            tab.click()
            return await wait(() => !!document.querySelector(${JSON.stringify(selector)}))
          })()`)
          return opened === true
        }
        for (const [width, height] of [[1280, 720], [1440, 900]]) {
          window.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 500))
          const resourceOpened = await openView('文献资料', 'Reader fixture', '.document-resource-view')
          const resourceLayout = resourceOpened ? await window.webContents.executeJavaScript(`(() => {
            const view = document.querySelector('.document-resource-view')
            const rect = view?.getBoundingClientRect()
            return { view: 'resource', width: innerWidth, height: innerHeight,
              visible: !!rect && rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              viewOverflow: view ? view.scrollWidth > view.clientWidth + 1 : null }
          })()`) : { view: 'resource', opened: false }
          layouts.push(resourceLayout)
          await writeFile(join(reportDir, `resource-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
          const materialsOpened = await openView('关联材料', 'Resource Topic', '.topic-materials-view')
          const materialsLayout = materialsOpened ? await window.webContents.executeJavaScript(`(() => {
            const view = document.querySelector('.topic-materials-view')
            const rect = view?.getBoundingClientRect()
            return { view: 'materials', width: innerWidth, height: innerHeight,
              visible: !!rect && rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              viewOverflow: view ? view.scrollWidth > view.clientWidth + 1 : null }
          })()`) : { view: 'materials', opened: false }
          layouts.push(materialsLayout)
          await writeFile(join(reportDir, `materials-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
        }
        await writeFile(join(reportDir, 'resource-relations-layouts.json'), JSON.stringify(layouts, null, 2))
        if (layouts.some(layout => layout.opened === false || layout.visible !== true || layout.horizontalOverflow || layout.viewOverflow)) throw new Error('RESOURCE_LAYOUT_OVERFLOW')
      }
      if (readerSmoke && !process.argv.includes('--tabs-close-smoke') && !process.argv.includes('--tabs-fault-smoke')) {
        const layouts = []
        for (const [width, height] of [[1440,1024],[1024,768],[1280,720],[1440,900]]) {
          window.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 1800))
          const layout = await window.webContents.executeJavaScript(`(() => {
            const inside = element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
            const chat = document.querySelector('[aria-label="研究问题"]')
            const search = document.querySelector('.search-panel')
            return {
              width: innerWidth,
              height: innerHeight,
              toolbarFits: [...document.querySelectorAll('.reader-toolbar button,.reader-toolbar select')].every(x => {const r=x.getBoundingClientRect();return r.left >= 0 && r.right <= innerWidth}),
              toolbarVisible: [...document.querySelectorAll('.reader-toolbar')].every(inside),
              headerVisible: [...document.querySelectorAll('.app-header,.workspace-tabbar')].every(inside),
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              chatInputVisible: !chat || inside(chat),
              searchVisible: !search || inside(search),
              saved: document.querySelector('.reader-feedback')?.textContent
            }
          })()`)
          layouts.push(layout)
          const name = width === 1440 && height === 1024 ? `reader-${width}.png` : width === 1024 && height === 768 ? `reader-${width}.png` : `reader-${width}x${height}.png`
          await writeFile(join(reportDir, name), (await window.webContents.capturePage()).toPNG())
        }
        await writeFile(join(reportDir, 'layouts.json'), JSON.stringify(layouts, null, 2))
        if (layouts.some(layout => !layout.toolbarFits || !layout.toolbarVisible || !layout.headerVisible || layout.horizontalOverflow || !layout.chatInputVisible || !layout.searchVisible)) throw new Error('LAYOUT_OVERFLOW')
      }
      if (readerSmoke && process.argv.includes('--layout-smoke')) await runWorkspaceLayoutSmoke(window, reportDir)
      await backend.stop()
      app.exit((probe.status.state === 'ready'||faultObserved) && !probe.nodeExposed ? 0 : 1)
    } catch (error) {
      try { if (readerSmoke) {
        await mkdir(reportDir, { recursive: true })
        const reader = window.isDestroyed() ? null : await window.webContents.executeJavaScript(`({feedback: document.querySelector('.reader-feedback')?.textContent, text: document.querySelector('.textLayer')?.textContent, note: document.querySelector('.note-status')?.textContent, workspace:document.querySelector('.workspace-panel')?.textContent})`).catch(() => null)
        await writeFile(join(reportDir, 'failure.json'), JSON.stringify({ message: error instanceof Error ? error.message : 'SMOKE_FAILED', reader }))
        if (!window.isDestroyed()) await writeFile(join(reportDir, 'failure.png'), (await window.webContents.capturePage()).toPNG())
      } } finally { await backend.stop(); app.exit(1) }
    }
  }
})
app.on('window-all-closed', () => app.quit())
// Wait until windows accept their beforeunload checks before stopping the service.
app.on('will-quit', event => {
  if (quitting || !backend) return
  event.preventDefault()
  quitting = true
  void backend.stop().finally(() => app.quit())
})
