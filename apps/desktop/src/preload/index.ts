import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('yorw', Object.freeze({
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  providers: Object.freeze({ list: () => ipcRenderer.invoke('providers:list'), save: (input: unknown) => ipcRenderer.invoke('providers:save', input), test: (kind: unknown) => ipcRenderer.invoke('providers:test', kind) })
}))
