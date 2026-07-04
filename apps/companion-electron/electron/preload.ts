import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  login: (params: { username: string; password: string }) =>
    ipcRenderer.invoke('auth:login', params),
  getToken: () => ipcRenderer.invoke('auth:getToken'),
  getServerUrl: () => ipcRenderer.invoke('auth:getServerUrl'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // API proxy
  apiRequest: (params: { method: string; url: string; body?: any }) =>
    ipcRenderer.invoke('api:request', params),

  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),

  // Window
  showWindow: () => ipcRenderer.invoke('window:show'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),

  // Status
  onStatusChanged: (status: string) => ipcRenderer.send('status:changed', status),

  // WebSocket events from main process
  onWsEvent: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = [
      'nav:orderPool',
      'ws:orderNew',
      'ws:orderUrgent',
      'ws:poolUpdated',
      'ws:statusBroadcast',
      'ws:pcCommand',
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },
});
