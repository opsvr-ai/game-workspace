const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
});
