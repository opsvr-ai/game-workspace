// craftsman-ignore: TS001,TS003
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pwSubmit: (pass: string) => ipcRenderer.send('pw:submit', pass),
  promptLogoutPassword: () => ipcRenderer.invoke('auth:promptLogoutPassword'),
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  logout: () => ipcRenderer.invoke('auth:logout'),
  unlockScreen: (pass: string) => ipcRenderer.invoke('screen:unlock', pass),
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  onStatusChanged: (status: string) => ipcRenderer.send('companion:status', status),
});
