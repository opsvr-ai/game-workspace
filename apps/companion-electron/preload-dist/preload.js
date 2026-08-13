"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// craftsman-ignore: TS001,TS003
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    pwSubmit: (pass) => electron_1.ipcRenderer.send('pw:submit', pass),
    promptLogoutPassword: () => electron_1.ipcRenderer.invoke('auth:promptLogoutPassword'),
    storeGet: (key) => electron_1.ipcRenderer.invoke('store:get', key),
    storeSet: (key, value) => electron_1.ipcRenderer.invoke('store:set', key, value),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    sessionWatch: (sessionId) => electron_1.ipcRenderer.send('session:watch', sessionId),
    sessionWatchStop: () => electron_1.ipcRenderer.invoke('session:watch-stop'),
});
