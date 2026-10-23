import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('yorw', Object.freeze({ getStatus: () => ipcRenderer.invoke('app:getStatus') }))
