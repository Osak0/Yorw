import { app, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { Backend } from './backend'

let backend: Backend
let quitting = false
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Yorw-development'))
if (!app.requestSingleInstanceLock()) app.quit()
else app.whenReady().then(async () => {
  const root = resolve(__dirname, '../../../..')
  const workspacePath = join(app.getPath('userData'), 'workspace')
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
      const probe = await window.webContents.executeJavaScript(`(async () => ({status: await window.yorw.getStatus(), nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined', bridgeKeys: Object.keys(window.yorw), navigation: [...document.querySelectorAll('nav button')].map(x => x.textContent)}))()`)
      await mkdir(reportDir, { recursive: true })
      await writeFile(join(reportDir, 'desktop-smoke.json'), JSON.stringify(probe, null, 2))
      await writeFile(join(reportDir, 'desktop.png'), (await window.webContents.capturePage()).toPNG())
      await backend.stop()
      app.exit(probe.status.state === 'ready' && !probe.nodeExposed ? 0 : 1)
    } catch { await backend.stop(); app.exit(1) }
  }
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (quitting || !backend) return
  event.preventDefault()
  quitting = true
  void backend.stop().finally(() => app.quit())
})
