import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('yorw', Object.freeze({
  getStatus: () => ipcRenderer.invoke('app:getStatus'),
  documents: Object.freeze({ list: () => ipcRenderer.invoke('documents:list'), importPdf: () => ipcRenderer.invoke('documents:importPdf'), update: (input: unknown) => ipcRenderer.invoke('documents:update', input), remove: (input: unknown) => ipcRenderer.invoke('documents:remove', input) }),
  tasks: Object.freeze({ get: (id: unknown) => ipcRenderer.invoke('tasks:get', id), retry: (id: unknown) => ipcRenderer.invoke('tasks:retry', id), cancel: (id: unknown) => ipcRenderer.invoke('tasks:cancel', id) }),
  providers: Object.freeze({ list: () => ipcRenderer.invoke('providers:list'), save: (input: unknown) => ipcRenderer.invoke('providers:save', input), test: (kind: unknown) => ipcRenderer.invoke('providers:test', kind) })
}))
