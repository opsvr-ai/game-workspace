const { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, safeStorage, shell } = require('electron');
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
let tray = null;
let isQuitting = false;

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const https = require('https');
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        resolve(downloadFile(new URL(res.headers.location, url).toString(), dest));
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    req.on('error', (err) => {
      file.close();
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
      reject(err);
    });
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error('download timeout'));
    });
  });
}

function checkForUpdates() {
  try {
    const serverUrl = getServerUrl().replace(/\/$/, '');
    fetch(`${serverUrl}/api/agent/cs-version`)
      .then((res) => res.json())
      .then((json) => {
        const latest = json?.data?.version;
        const downloadUrl = json?.data?.downloadUrl;
        if (!latest || !downloadUrl) return;
        // 只有服务器版本严格更新时才更新；本地已是最新/更新时不触发，
        // 避免字符串不等（===）导致反复下载安装并退出（闪退）。
        if (compareVersions(latest, app.getVersion()) <= 0) return;
        const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${serverUrl}${downloadUrl}`;
        const out = path.join(app.getPath('temp'), `Chunlv-CS-Setup-${latest}.exe`);
        // 先在主进程把安装包完整下载下来，再退出安装；避免之前用后台 PowerShell
        // 下载时应用一退出就把下载进程一起杀掉，导致永远装不上。
        downloadFile(fullUrl, out)
          .then(() => {
            const ps = `Start-Process -FilePath '${out}' -ArgumentList '/S' -Verb RunAs -Wait; Remove-Item '${out}' -Force -ErrorAction SilentlyContinue`;
            const { spawn } = require('child_process');
            spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
              detached: true,
              stdio: 'ignore',
            }).unref();
            app.quit();
          })
          .catch(() => {
            // 下载失败时保持应用运行，避免闪退死循环。
          });
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
  // 点 ❌ 最小化到托盘，不退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(process.resourcesPath, 'donkey.ico');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('蠢驴电竞·客服端');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });
  ipcMain.handle('config:getServerUrl', () => getServerUrl());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('folder:open', (_e, path) => {
    if (typeof path !== 'string' || !path.trim()) return { success: false };
    return shell.openPath(path.trim()).then(() => ({ success: true })).catch((err) => ({ success: false, error: String(err) }));
  });
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
  createTray();
  // 随机错峰，避免多台客服机同时下载 74MB 安装包。
  setTimeout(checkForUpdates, 20000 + Math.floor(Math.random() * 120000));
  setInterval(checkForUpdates, 5 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 隐藏到托盘时不退出；只有托盘“退出”才真正退出
});
