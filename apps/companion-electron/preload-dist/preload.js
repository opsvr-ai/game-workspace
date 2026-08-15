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
    sessionWatch: (sessionId) => electron_1.ipcRenderer.send('session:watch', sessionId),
    sessionWatchStop: () => electron_1.ipcRenderer.invoke('session:watch-stop'),
    unlockScreen: (pass) => electron_1.ipcRenderer.invoke('screen:unlock', pass),
    getServerUrl: () => electron_1.ipcRenderer.invoke('config:getServerUrl'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
    testWatchdog: () => electron_1.ipcRenderer.invoke('watchdog:test'),
    onStatusChanged: (status) => electron_1.ipcRenderer.send('companion:status', status),
});
