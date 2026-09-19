"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// craftsman-ignore: TS001,TS003
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    pwSubmit: (pass) => electron_1.ipcRenderer.send('pw:submit', pass),
    promptLogoutPassword: () => electron_1.ipcRenderer.invoke('auth:promptLogoutPassword'),
    storeGet: (key) => electron_1.ipcRenderer.invoke('store:get', key),
    storeSet: (key, value) => electron_1.ipcRenderer.invoke('store:set', key, value),
    getSavedCredentials: () => electron_1.ipcRenderer.invoke('credentials:get'),
    saveCredentials: (creds) => electron_1.ipcRenderer.invoke('credentials:save', creds),
    clearSavedCredentials: () => electron_1.ipcRenderer.invoke('credentials:clear'),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    setAppPassword: (oldPassword, newPassword) => electron_1.ipcRenderer.invoke('app:set-password', oldPassword, newPassword),
    sessionWatch: (sessionId) => electron_1.ipcRenderer.send('session:watch', sessionId),
    sessionWatchStop: () => electron_1.ipcRenderer.invoke('session:watch-stop'),
    sessionPause: () => electron_1.ipcRenderer.send('session:pause'),
    sessionResume: () => electron_1.ipcRenderer.send('session:resume'),
    unlockScreen: (pass) => electron_1.ipcRenderer.invoke('screen:unlock', pass),
    getServerUrl: () => electron_1.ipcRenderer.invoke('config:getServerUrl'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    openFolder: (path) => electron_1.ipcRenderer.invoke('folder:open', path),
    testWatchdog: () => electron_1.ipcRenderer.invoke('watchdog:test'),
    collectProcesses: (token) => electron_1.ipcRenderer.invoke('processes:collect', token),
    onStatusChanged: (status) => electron_1.ipcRenderer.send('companion:status', status),
    setRole: (role) => electron_1.ipcRenderer.send('auth:setRole', role),
    setCurrentUser: (userId, username) => electron_1.ipcRenderer.send('auth:setCurrentUser', userId, username),
    setStudioName: (name) => electron_1.ipcRenderer.send('auth:setStudioName', name),
    notify: (title, body) => electron_1.ipcRenderer.send('notify', title, body),
    /** 群聊广播：弹一个 Windows 置顶窗口，5 秒后自动消失 */
    broadcastPopup: (payload) => electron_1.ipcRenderer.invoke('broadcast:popup', payload),
});
