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
  setAppPassword: (oldPassword: string, newPassword: string) =>
    ipcRenderer.invoke('app:set-password', oldPassword, newPassword),
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
  setCurrentUser: (userId: string, username: string) => ipcRenderer.send('auth:setCurrentUser', userId, username),
  setStudioName: (name: string) => ipcRenderer.send('auth:setStudioName', name),
  notify: (title: string, body: string) => ipcRenderer.send('notify', title, body),
  /** 群聊广播：弹一个 Windows 置顶窗口，5 秒后自动消失 */
  broadcastPopup: (payload: { title?: string; body?: string }) =>
    ipcRenderer.invoke('broadcast:popup', payload),
});
