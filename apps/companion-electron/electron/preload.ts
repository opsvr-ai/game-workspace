// craftsman-ignore: TS001,TS003
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pwSubmit: (pass: string) => ipcRenderer.send('pw:submit', pass),
  promptLogoutPassword: () => ipcRenderer.invoke('auth:promptLogoutPassword'),
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  getSavedCredentials: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (creds: { username: string; password: string }) =>
    ipcRenderer.invoke('credentials:save', creds),
  clearSavedCredentials: () => ipcRenderer.invoke('credentials:clear'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  sessionWatch: (sessionId: string) => ipcRenderer.send('session:watch', sessionId),
  sessionWatchStop: () => ipcRenderer.invoke('session:watch-stop'),
  sessionPause: () => ipcRenderer.send('session:pause'),
  sessionResume: () => ipcRenderer.send('session:resume'),
  unlockScreen: (pass: string) => ipcRenderer.invoke('screen:unlock', pass),
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  openFolder: (path: string) => ipcRenderer.invoke('folder:open', path),
  testWatchdog: () => ipcRenderer.invoke('watchdog:test'),
  collectProcesses: (token: string) => ipcRenderer.invoke('processes:collect', token),
  onStatusChanged: (status: string) => ipcRenderer.send('companion:status', status),
  setRole: (role: string) => ipcRenderer.send('auth:setRole', role),
  notify: (title: string, body: string) => ipcRenderer.send('notify', title, body),
});
