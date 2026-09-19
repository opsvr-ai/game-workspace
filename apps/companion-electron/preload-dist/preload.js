"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  pwSubmit: (pass) => import_electron.ipcRenderer.send("pw:submit", pass),
  promptLogoutPassword: () => import_electron.ipcRenderer.invoke("auth:promptLogoutPassword"),
  storeGet: (key) => import_electron.ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => import_electron.ipcRenderer.invoke("store:set", key, value),
  getSavedCredentials: () => import_electron.ipcRenderer.invoke("credentials:get"),
  saveCredentials: (creds) => import_electron.ipcRenderer.invoke("credentials:save", creds),
  clearSavedCredentials: () => import_electron.ipcRenderer.invoke("credentials:clear"),
  logout: () => import_electron.ipcRenderer.invoke("auth:logout"),
  setAppPassword: (oldPassword, newPassword) => import_electron.ipcRenderer.invoke("app:set-password", oldPassword, newPassword),
  sessionWatch: (sessionId) => import_electron.ipcRenderer.send("session:watch", sessionId),
  sessionWatchStop: () => import_electron.ipcRenderer.invoke("session:watch-stop"),
  sessionPause: () => import_electron.ipcRenderer.send("session:pause"),
  sessionResume: () => import_electron.ipcRenderer.send("session:resume"),
  unlockScreen: (pass) => import_electron.ipcRenderer.invoke("screen:unlock", pass),
  getServerUrl: () => import_electron.ipcRenderer.invoke("config:getServerUrl"),
  getAppVersion: () => import_electron.ipcRenderer.invoke("app:getVersion"),
  openFolder: (path) => import_electron.ipcRenderer.invoke("folder:open", path),
  testWatchdog: () => import_electron.ipcRenderer.invoke("watchdog:test"),
  collectProcesses: (token) => import_electron.ipcRenderer.invoke("processes:collect", token),
  onStatusChanged: (status) => import_electron.ipcRenderer.send("companion:status", status),
  setRole: (role) => import_electron.ipcRenderer.send("auth:setRole", role),
  setCurrentUser: (userId, username) => import_electron.ipcRenderer.send("auth:setCurrentUser", userId, username),
  setStudioName: (name) => import_electron.ipcRenderer.send("auth:setStudioName", name),
  notify: (title, body) => import_electron.ipcRenderer.send("notify", title, body),
  /** 群聊广播：弹一个 Windows 置顶窗口，5 秒后自动消失 */
  broadcastPopup: (payload) => import_electron.ipcRenderer.invoke("broadcast:popup", payload)
});
