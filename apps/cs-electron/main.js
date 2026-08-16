const { app, BrowserWindow, session, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// 低配电脑无独显/驱动老旧时，关闭硬件加速避免黑屏
app.disableHardwareAcceleration();
// 允许局域网 http 地址使用麦克风/媒体接口
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', getServerUrl().replace(/\/$/, ''));

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

function checkForUpdates() {
  try {
    const serverUrl = getServerUrl().replace(/\/$/, '');
    fetch(`${serverUrl}/api/agent/cs-version`)
      .then((res) => res.json())
      .then((json) => {
        const latest = json?.data?.version;
        const downloadUrl = json?.data?.downloadUrl;
        if (!latest || !downloadUrl || latest === app.getVersion()) return;
        const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${serverUrl}${downloadUrl}`;
        const out = path.join(app.getPath('temp'), `Chunlv-CS-Setup-${latest}.exe`);
        const ps = [
          `$ProgressPreference='SilentlyContinue'`,
          `if (!(Test-Path '${out}')) { Invoke-WebRequest -Uri '${fullUrl}' -OutFile '${out}' }`,
          `Start-Process -FilePath '${out}' -ArgumentList '/S' -Wait`,
          `Remove-Item '${out}' -Force`,
        ].join('; ');
        const { spawn } = require('child_process');
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        setTimeout(() => app.quit(), 1500);
      })
      .catch(() => {});
  } catch {}
}

function credentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function loadCredentials() {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    if (!raw || !safeStorage.isEncryptionAvailable()) return null;
    const json = safeStorage.decryptString(Buffer.from(raw, 'base64'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function saveCredentials(creds) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { success: false, message: '系统不支持安全存储' };
    if (!creds || !creds.username || !creds.password) {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
      return { success: true };
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(creds)).toString('base64');
    fs.writeFileSync(credentialsPath(), encrypted, 'utf8');
    return { success: true };
  } catch {
    return { success: false, message: '保存失败' };
  }
}

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
  ipcMain.handle('credentials:get', () => loadCredentials());
  ipcMain.handle('credentials:save', (_e, creds) => saveCredentials(creds));
  ipcMain.handle('credentials:clear', () => {
    try {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
      return { success: true };
    } catch {
      return { success: false };
    }
  });
  ipcMain.handle('auth:logout', () => {
    try {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
    } catch {}
    return { success: true };
  });
  createWindow();
  // 随机错峰，避免多台客服机同时下载 74MB 安装包。
  setTimeout(checkForUpdates, 20000 + Math.floor(Math.random() * 120000));
  setInterval(checkForUpdates, 5 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
