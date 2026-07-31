"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Auth
  login: (params) => import_electron.ipcRenderer.invoke("auth:login", params),
  getToken: () => import_electron.ipcRenderer.invoke("auth:getToken"),
  getServerUrl: () => import_electron.ipcRenderer.invoke("auth:getServerUrl"),
  logout: () => import_electron.ipcRenderer.invoke("auth:logout"),
  // API proxy
  apiRequest: (params) => import_electron.ipcRenderer.invoke("api:request", params),
  // Store
  storeGet: (key) => import_electron.ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => import_electron.ipcRenderer.invoke("store:set", key, value),
  // Window
  showWindow: () => import_electron.ipcRenderer.invoke("window:show"),
  hideWindow: () => import_electron.ipcRenderer.invoke("window:hide"),
  // Status
  onStatusChanged: (status) => import_electron.ipcRenderer.send("status:changed", status),
  // WebSocket events from main process
  onWsEvent: (channel, callback) => {
    const validChannels = [
      "nav:orderPool",
      "ws:orderNew",
      "ws:orderUrgent",
      "ws:poolUpdated",
      "ws:statusBroadcast",
      "ws:pcCommand",
      "ws:blacklistUpdate",
      "ws:blacklistRecheck",
      "ws:entertainmentWarning",
      "ws:entertainmentForceIdle",
      "fileDropped"
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      import_electron.ipcRenderer.on(channel, subscription);
      return () => import_electron.ipcRenderer.removeListener(channel, subscription);
    }
    return () => {
    };
  },
  // Remote deploy — execute PsExec script from admin's PC
  executeRemoteDeploy: (script) => import_electron.ipcRenderer.invoke("deploy:execute", script),
  // Status bar animation — call directly from renderer
  showStatusBar: (status) => import_electron.ipcRenderer.send("show-status-bar", status),
  // One-click app update — download + replace + restart
  updateApp: () => import_electron.ipcRenderer.invoke("update-app")
});
