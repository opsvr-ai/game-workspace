const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getSavedCredentials: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (creds) => ipcRenderer.invoke('credentials:save', creds),
  clearSavedCredentials: () => ipcRenderer.invoke('credentials:clear'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onLoggedIn: () => ipcRenderer.send('auth:logged-in'),
});
