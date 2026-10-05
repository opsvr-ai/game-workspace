const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('config:getServerUrl'),
  // 打开/聚焦一个「独立的聊天窗口」（一个联系人一个系统窗口，能最小化到任务栏 —— 老板 2026-10-05）。
  openChatWindow: (payload) => ipcRenderer.invoke('chat:open-window', payload),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  // 「连不上服务器」兜底页上的重新加载按钮用（见 main.js 的 loadAppPage）
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  openFolder: (path) => ipcRenderer.invoke('folder:open', path),
  getSavedCredentials: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (creds) => ipcRenderer.invoke('credentials:save', creds),
  clearSavedCredentials: () => ipcRenderer.invoke('credentials:clear'),
  logout: () => ipcRenderer.invoke('auth:logout'),
});
