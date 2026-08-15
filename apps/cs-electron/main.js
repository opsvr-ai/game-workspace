const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function getServerUrl() {
  const candidates = [
    path.join(process.resourcesPath, 'config.json'),
    path.join(__dirname, 'config.json'),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cfg && cfg.serverUrl) return cfg.serverUrl;
    } catch {
      // ignore and try next
    }
  }
  return 'http://192.168.0.106:3001';
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: '蠢驴电竞·客服端',
    backgroundColor: '#0B1024',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const serverUrl = getServerUrl().replace(/\/$/, '');
  mainWindow.loadURL(`${serverUrl}/login`);
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code !== -3) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`${serverUrl}/login`);
        }
      }, 2000);
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });
  ipcMain.handle('config:getServerUrl', () => getServerUrl());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
