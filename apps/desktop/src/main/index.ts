import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { Backend } from './backend'
import { Providers } from './providers'
import { Documents } from './documents'

let backend: Backend
let quitting = false
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Yorw-development'))
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  const root = resolve(__dirname, '../../../..')
  const smokeReport = process.argv.find(arg => arg.startsWith('--report-dir='))?.slice(13)
  const readerSmoke = process.argv.includes('--yorw-smoke') && process.argv.includes('--reader-smoke') && !!smokeReport
  const workspacePath = readerSmoke ? join(smokeReport!, 'workspace') : join(app.getPath('userData'), 'workspace')
  backend = app.isPackaged
    ? new Backend(join(process.resourcesPath, 'backend/yorw-api/yorw-api.exe'), [], process.resourcesPath, workspacePath)
    : new Backend(join(root, 'services/api/.venv/Scripts/python.exe'), ['-m', 'yorw_api'], join(root, 'services/api/src'), workspacePath)
  const window = new BrowserWindow({ show: !process.argv.includes('--yorw-smoke'), width: 1200, height: 800, minWidth: 900, minHeight: 640, title: '知栖 Yorw', webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const allowed = (url: string) => devUrl ? url === devUrl || url === devUrl + '/' : url === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  ipcMain.handle('app:getStatus', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed(event.senderFrame.url)) throw new Error('IPC_DENIED')
    return backend.status
  })
  const providers = new Providers(backend, join(app.getPath('userData'), 'secrets'))
  const providerAction = (action: (input: any) => Promise<unknown>) => async (event: Electron.IpcMainInvokeEvent, input: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed(event.senderFrame.url)) throw new Error('IPC_DENIED')
    try { return { ok: true, value: await action(input) } }
    catch (error) {
      const code = error instanceof Error && ['DOCUMENT_FILE_MISSING', 'INVALID_PAGE', 'PAGE_COUNT_UNAVAILABLE', 'INVALID_INPUT', 'PDF_TOO_LARGE', 'NOT_PDF', 'DOCUMENT_CONFLICT', 'DOCUMENT_NOT_FOUND', 'TASK_RUNNING', 'FILE_CLEANUP_PENDING', 'INVALID_METADATA', 'INVALID_CONFIG', 'CONFIG_CONFLICT', 'KEY_REENTRY_REQUIRED', 'KEY_UNAVAILABLE', 'SECURE_STORAGE_UNAVAILABLE', 'BACKEND_NOT_READY'].includes(error.message) ? error.message : 'OPERATION_FAILED'
      return { ok: false, code }
    }
  }
  const documents = new Documents(backend)
  ipcMain.handle('documents:readPdf', providerAction(input => documents.readPdf(input)))
  ipcMain.handle('documents:savePosition', providerAction(input => documents.savePosition(input)))
  ipcMain.handle('documents:list', providerAction(() => documents.list()))
  ipcMain.handle('documents:importPdf', providerAction(() => documents.importPdf()))
  ipcMain.handle('documents:update', providerAction(input => documents.update(input)))
  ipcMain.handle('documents:remove', providerAction(input => documents.remove(input)))
  ipcMain.handle('tasks:get', providerAction(input => documents.task(input)))
  ipcMain.handle('tasks:cancel', providerAction(input => documents.cancel(input)))
  ipcMain.handle('tasks:retry', providerAction(input => documents.retry(input)))
  ipcMain.handle('providers:list', providerAction(() => providers.list()))
  ipcMain.handle('providers:save', providerAction(input => providers.save(input)))
  ipcMain.handle('providers:test', providerAction(input => providers.test(input)))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
      if (readerSmoke) {
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
      } else {
        await window.webContents.executeJavaScript(`document.querySelectorAll('nav button')[${process.argv.includes('--storage-smoke') ? 0 : 2}].click()` )
      }
      await new Promise(resolve => setTimeout(resolve, 400))
      const probe = await window.webContents.executeJavaScript(`(async () => ({status: await window.yorw.getStatus(), nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined', bridgeKeys: Object.keys(window.yorw), navigation: [...document.querySelectorAll('nav button')].map(x => x.textContent)}))()`)
      await mkdir(reportDir, { recursive: true })
      await writeFile(join(reportDir, 'desktop-smoke.json'), JSON.stringify({ ...probe, secureStorage, readerProof }, null, 2))
      await writeFile(join(reportDir, 'desktop.png'), (await window.webContents.capturePage()).toPNG())
      if (readerSmoke) {
        const layouts = []
        for (const [width, height] of [[1440,1024],[1024,768]]) {
          window.setContentSize(width, height)
          await new Promise(resolve => setTimeout(resolve, 1800))
          const layout = await window.webContents.executeJavaScript(`({ width: innerWidth, toolbarFits: [...document.querySelectorAll('.reader-toolbar button,.reader-toolbar select')].every(x => {const r=x.getBoundingClientRect();return r.left >= 0 && r.right <= innerWidth}), saved: document.querySelector('.reader-feedback')?.textContent })`)
          layouts.push(layout)
          await writeFile(join(reportDir, `reader-${width}.png`), (await window.webContents.capturePage()).toPNG())
        }
        await writeFile(join(reportDir, 'layouts.json'), JSON.stringify(layouts, null, 2))
        if (layouts.some(layout => !layout.toolbarFits)) throw new Error('TOOLBAR_OVERFLOW')
      }
      await backend.stop()
      app.exit(probe.status.state === 'ready' && !probe.nodeExposed ? 0 : 1)
    } catch (error) {
      if (readerSmoke) {
        await mkdir(reportDir, { recursive: true })
        await writeFile(join(reportDir, 'failure.json'), JSON.stringify({ message: error instanceof Error ? error.message : 'SMOKE_FAILED', reader: await window.webContents.executeJavaScript(`({feedback: document.querySelector('.reader-feedback')?.textContent, text: document.querySelector('.textLayer')?.textContent})`) }))
        await writeFile(join(reportDir, 'failure.png'), (await window.webContents.capturePage()).toPNG())
      }
      await backend.stop(); app.exit(1)
    }
  }
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (quitting || !backend) return
  event.preventDefault()
  quitting = true
  void backend.stop().finally(() => app.quit())
})
