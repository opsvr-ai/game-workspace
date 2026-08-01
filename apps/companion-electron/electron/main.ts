import { app, BrowserWindow, ipcMain, Menu, protocol, net, dialog } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { createTray, updateTrayTooltip } from './tray';
import { connectWebSocket, disconnectWebSocket, onWsEvent } from './websocket';
import { showOrderNotification } from './notification';
import { store } from './store';
import { getServerUrl } from './config';
import { httpRequest } from './http';
import { startProcessMonitor, stopProcessMonitor, updateBlacklist } from './process-monitor';
import { killProcess } from './process-killer';
import { showKillNotification, showKilledToast } from './blacklist-notification';
import { shouldNotify } from './notification-prefs';
import { showScreenLock, hideScreenLock, setAppPassword, getAppPasswordForUI } from './screen-lock';
import { showEntertainmentWarning, showEntertainmentForceIdle } from './entertainment-notify';
import { handleRemoteCommand } from './remote-command';
import { checkForUpdates, handleUpdateCommand } from './updater';
import {
  emitStatus,
  isConnected as isWsConnected,
  emitBlacklistReport,
  emitKillResult,
  emitCommandAck,
} from './websocket';
import { logger } from './logger';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: '蠢驴电竞陪玩',
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#0F172A',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload-dist/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Handle page load failures — MUST register before loadURL
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('Page load failed', { errorCode, errorDescription, url: validatedURL });
    // Show a user-visible error instead of blank page
    const errorHtml = `
      <html><head><meta charset="utf-8"><style>
        body { background:#0F172A; color:#e2e8f0; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
        .box { text-align:center; padding:40px; }
        h2 { color:#f87171; } p { color:#94a3b8; font-size:14px; }
      </style></head><body>
        <div class="box">
          <h2>❌ 无法连接到服务器</h2>
          <p>请确认服务器已启动：<code>${validatedURL || '—'}</code></p>
          <p>错误：${errorDescription} (${errorCode})</p>
        </div>
      </body></html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  });

  // Load web app — dev uses Vite, prod loads from server, fallback to local
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const serverUrl = getServerUrl();
    const webUrl = serverUrl.replace(/:3001$/, ':8000');
    logger.info('Loading web app', { webUrl });
    win.loadURL(webUrl);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      const token = store.get('token') as string;
      // If not logged in, just hide (companion logged out, no protection needed)
      if (!token) { win.hide(); return; }
      const pass = (store.get('appPassword') as string) || '123456';
      const { BrowserWindow: BW, ipcMain: ipc } = require('electron');
      const pw = new BW({
        width: 300, height: 180, frame: false, alwaysOnTop: true, resizable: false, parent: win, modal: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, '../preload-dist/preload.js') },
      });
      pw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei",sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;justify-content:center;height:100vh}
h3{margin-bottom:12px;font-size:15px}
input{padding:8px 14px;font-size:14px;border:1px solid #585b70;border-radius:6px;background:#313244;color:#cdd6f4;text-align:center;width:200px;outline:none}
input:focus{border-color:#89b4fa}
.err{color:#f38ba8;font-size:12px;margin-top:6px;display:none}
</style></head><body>
<div style="text-align:center">
<h3>🔒 管理员验证</h3>
<input type="password" id="pw" autofocus placeholder="输入密码退出">
<div class="err" id="err">密码错误</div>
</div>
<script>
var a=0;
document.getElementById('pw').onkeydown=function(e){
if(e.key==='Enter'){
if(e.target.value==='${pass}'){window.electronAPI&&window.electronAPI.storeSet('__exit','true');window.close()}
else{a++;e.target.value='';document.getElementById('err').style.display='block';
if(a>=5){e.target.disabled=true;document.getElementById('err').textContent='已锁定30秒';setTimeout(function(){e.target.disabled=false;a=0;document.getElementById('err').style.display='none'},30000)}}
}
};
</script></body></html>`)}`);
      pw.on('closed', () => {
        if (store.get('__exit') === 'true') {
          store.set('__exit', 'false');
          isQuitting = true;
          win.close();
        } else {
          win.hide();
        }
      });
    }
  });

  return win;
}

// IPC handlers
function setupIPC(): void {
  // Auth: login only needs username + password, server URL from config file
  ipcMain.handle('auth:login', async (_e, { username, password }: { username: string; password: string }) => {
    try {
      const serverUrl = getServerUrl();
      const res = await httpRequest({
        method: 'POST',
        url: `${serverUrl}/api/auth/login`,
        body: { username, password },
      });
      if (res.data?.code === 200 && res.data?.data?.accessToken) {
        store.set('serverUrl', serverUrl);
        store.set('username', username);
        store.set('token', res.data.data.accessToken);

        const meRes = await httpRequest({
          method: 'GET',
          url: `${serverUrl}/api/auth/me`,
          headers: { Authorization: `Bearer ${res.data.data.accessToken}` },
        });
        if (meRes.data?.data) {
          store.set('companionId', meRes.data.data.companionId || '');
          store.set('companionName', meRes.data.data.displayName || meRes.data.data.username || username);
        }

        const companionId = store.get('companionId') as string;
        const token = res.data.data.accessToken;

        // Auto-set status to AVAILABLE on login
        if (companionId) {
          try {
            await httpRequest({
              method: 'PUT',
              url: `${serverUrl}/api/companions/${companionId}/status`,
              headers: { Authorization: `Bearer ${token}` },
              body: { status: 'AVAILABLE' },
            });
            logger.info('Auto-set status to AVAILABLE on login', { companionId });
          } catch (e: any) {
            logger.warn('Failed to auto-set AVAILABLE status', { error: e.message });
          }
        }

        connectWebSocket(serverUrl, token, companionId);
        logger.info('Login success', { username, companionId });

        // Show boot guide after login
        if (mainWindow) {
          mainWindow.webContents.send('nav:bootGuide');
        }

        return { success: true, user: meRes.data?.data };
      }
      return { success: false, message: res.data?.message || '登录失败' };
    } catch (err: any) {
      return { success: false, message: err.message || '网络错误' };
    }
  });

  ipcMain.handle('auth:getToken', () => store.get('token'));
  ipcMain.handle('auth:getServerUrl', () => getServerUrl());
  ipcMain.handle('auth:logout', () => {
    disconnectWebSocket();
    store.set('token', '');
    store.set('companionId', '');
    store.set('companionName', '');
    return { success: true };
  });

  // API proxy
  ipcMain.handle('api:request', async (_e, { method, url, body }: { method: string; url: string; body?: any }) => {
    try {
      const token = store.get('token') as string;
      const serverUrl = getServerUrl();
      const fullUrl = url.startsWith('http') ? url : `${serverUrl}/api${url}`;
      const res = await httpRequest({
        method,
        url: fullUrl,
        headers: { Authorization: `Bearer ${token}` },
        body: method !== 'GET' ? body : undefined,
      });
      return res.data;
    } catch (err: any) {
      return { code: 500, message: err.message || '请求失败' };
    }
  });

  // Store get/set
  ipcMain.handle('store:get', (_e, key: string) => store.get(key));
  ipcMain.handle('store:set', (_e, key: string, value: any) => store.set(key, value));
  ipcMain.handle('app:setPassword', (_e, password: string) => {
    setAppPassword(password);
    return { success: true };
  });
  ipcMain.handle('app:getPassword', () => getAppPasswordForUI());

  // Window controls
  ipcMain.handle('window:show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  ipcMain.handle('window:hide', () => {
    mainWindow?.hide();
  });

  ipcMain.on('nav:orderPool', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('nav:orderPool');
    }
  });

  ipcMain.on('status:changed', (_e, status: string) => {
    store.set('lastStatus', status);
    logger.info('Status changed', { status });
    if (status === 'RESTING') {
      showScreenLock();
    } else {
      hideScreenLock();
    }
    const name = store.get('companionName') as string;
    logger.info('IPC status:changed received', { status, name });
    updateTrayTooltip(`蠢驴电竞 - ${name} (${status})`);
    updateFloatBall(status);
    // Sync to server via WebSocket
    emitStatus(status);
  });

  // Simple status bar trigger — renderer can call directly
  ipcMain.on('show-status-bar', (_e, status: string) => {
    showStatusBar(status);
  });

  // One-click app update: download new app.asar, replace, restart
  ipcMain.handle('update-app', async () => {
    const serverUrl = getServerUrl();
    const downloadUrl = `${serverUrl.replace(/:3001$/, ':8000')}/uploads/app.asar`;
    const tmpAsar = path.join(app.getPath('temp'), 'app.asar.new');
    const installDir = path.dirname(app.getPath('exe'));
    const targetAsar = path.join(installDir, 'resources', 'app.asar');
    const batPath = path.join(app.getPath('temp'), 'chunlv-update.bat');

    try {
      // Download new asar
      logger.info('Downloading update', { url: downloadUrl });
      const http = require('http') as typeof import('http');
      await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(tmpAsar);
        http
          .get(downloadUrl, (res: any) => {
            if (res.statusCode !== 200) {
              file.close();
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          })
          .on('error', reject);
      });

      // Write batch script that replaces file and restarts
      const bat = [
        '@echo off',
        'chcp 65001 >nul',
        'echo 正在更新...',
        `:wait`,
        `tasklist /fi "IMAGENAME eq 蠢驴电竞.exe" 2>nul | find "蠢驴电竞.exe" >nul`,
        `if %errorlevel% equ 0 ( timeout /t 1 /nobreak >nul & goto wait )`,
        `copy /y "${tmpAsar}" "${targetAsar}"`,
        `del "${tmpAsar}"`,
        `start "" "${installDir}\\蠢驴电竞.exe"`,
        `del "%~f0"`,
      ].join('\r\n');
      fs.writeFileSync(batPath, bat, 'utf-8');

      // Spawn detached batch and quit
      logger.info('Update ready, restarting...');
      const { spawn } = require('child_process') as typeof import('child_process');
      spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      app.quit();
      return { success: true };
    } catch (err: any) {
      logger.error('Update failed', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // Remote deploy: execute PsExec script on admin's PC
  ipcMain.handle('deploy:execute', async (_e, script: string) => {
    const scriptPath = path.join(app.getPath('temp'), 'chunlv-remote-deploy.ps1');
    try {
      // Write script to temp file
      fs.writeFileSync(scriptPath, script, 'utf-8');
      logger.info('Remote deploy script written', { path: scriptPath });

      // Execute PowerShell
      return await new Promise<{ success: boolean; output: string }>((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { timeout: 600_000, maxBuffer: 1024 * 1024 },
          (err, stdout, stderr) => {
            // Cleanup
            try {
              fs.unlinkSync(scriptPath);
            } catch {
              /* ignore */
            }
            const output = stdout || stderr || '';
            if (err) {
              logger.warn('Remote deploy finished with error', { error: err.message });
              resolve({ success: false, output: output + '\n' + (err.message || '') });
            } else {
              logger.info('Remote deploy completed successfully');
              resolve({ success: true, output });
            }
          },
        );
      });
    } catch (err: any) {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        /* ignore */
      }
      logger.error('Remote deploy failed', { error: err.message });
      return { success: false, output: err.message || 'Unknown error' };
    }
  });
}

// ── Floating ball ──
let floatWindow: BrowserWindow | null = null;
const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: '空闲',
  BUSY: '接单',
  ENTERTAINMENT: '娱乐',
  RESTING: '休息',
};

function updateFloatBall(status: string): void {
  if (!floatWindow) return;
  const c = STATUS_COLORS[status] || '#9ca3af';
  const l = STATUS_LABELS[status] || status;
  floatWindow.webContents
    .executeJavaScript(
      `try{var b=document.getElementById('fb');if(b){b.style.background='${c}';b.firstChild.textContent='${l}'}}catch(e){}`,
    )
    .catch(() => {});
}

function createFloatBall(): BrowserWindow {
  const { width: sw } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 52,
    height: 52,
    x: sw - 76,
    y: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    type: 'toolbar',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const c = STATUS_COLORS['AVAILABLE'];
  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}body{background:transparent;display:flex;align-items:center;justify-content:center;height:100vh;cursor:pointer}.b{width:44px;height:44px;border-radius:50%;background:${c};box-shadow:0 2px 12px rgba(0,0,0,.3);transition:background .3s;display:flex;align-items:center;justify-content:center}.t{color:#fff;font-size:10px;font-weight:700;user-select:none}</style></head><body><div class="b" id="fb"><span class="t">空闲</span></div><script>document.body.onclick=function(){window.electronAPI?.showWindow()}</script></body></html>`)}`,
  );
  win.setAlwaysOnTop(true, 'floating');
  return win;
}

// ── Status bar animation (injected directly into DOM, bypasses React) ──
const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: '#22c55e',
  BUSY: '#ef4444',
  ENTERTAINMENT: '#eab308',
  RESTING: '#f97316',
};

function showStatusBar(status: string): void {
  const color = STATUS_COLORS[status];
  if (!color || !mainWindow) return;
  mainWindow.webContents
    .executeJavaScript(
      `
    (function() {
      var id = 'esb-native';
      var old = document.getElementById(id);
      if (old) old.remove();
      var bar = document.createElement('div');
      bar.id = id;
      bar.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;height:5px;width:0;background:${color};border-radius:0 3px 3px 0;box-shadow:0 0 10px ${color},0 0 4px ${color};pointer-events:none;transition:width 1s ease-out;';
      document.body.appendChild(bar);
      requestAnimationFrame(function() { bar.style.width = '100%'; });
      setTimeout(function() { bar.style.transition = 'opacity 0.3s'; bar.style.opacity = '0'; }, 1200);
      setTimeout(function() { if (bar.parentNode) bar.remove(); }, 1500);
    })();
  `,
    )
    .catch(() => {});
}

// Setup WebSocket event handlers
function setupWsEvents(): void {
  const notifyOrder = (order: any, isUrgent: boolean) => {
    showOrderNotification(order, isUrgent, () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('nav:orderPool');
      }
    });
  };

  onWsEvent('order:new', (data: any) => {
    // Check notification preferences before showing popup
    const orderType = data.type || data.orderType;
    if (shouldNotify(data)) {
      notifyOrder(data, false);
    }
    mainWindow?.webContents.send('ws:orderNew', data);
  });

  onWsEvent('order:urgent', (data: any) => {
    const orderType = data.type || data.orderType;
    if (shouldNotify(data)) {
      notifyOrder(data, true);
    }
    mainWindow?.webContents.send('ws:orderUrgent', data);
  });

  onWsEvent('order:pool_updated', (data: any) => {
    mainWindow?.webContents.send('ws:poolUpdated', data);
  });

  onWsEvent('status:broadcast', (data: any) => {
    mainWindow?.webContents.send('ws:statusBroadcast', data);
    // Sync local status store for ElectronStatusBar polling
    const cid = store.get('companionId') as string;
    if (cid && data?.companionId === cid && data?.status) {
      store.set('lastStatus', data.status);
      // Direct DOM injection — bypasses React/WebSocket entirely
      showStatusBar(data.status);
    }
  });

  onWsEvent('pc:command', (data: any) => {
    logger.info('Remote command received via WS', { command: data.command });

    // Route update commands to the updater module
    if (data.command === 'update') {
      handleUpdateCommand(data.downloadUrl);
      return;
    }

    handleRemoteCommand(data, (success: boolean) => {
      emitCommandAck(data.command, success);
    });
    mainWindow?.webContents.send('ws:pcCommand', data);
  });

  // Blacklist process management events
  onWsEvent('blacklist:update', (data: any) => {
    const updated = updateBlacklist(data.blacklist || [], data.whitelist || [], data.version || 0);
    if (updated) {
      logger.info('Blacklist updated', { version: data.version });
    }
    mainWindow?.webContents.send('ws:blacklistUpdate', data);
  });

  onWsEvent('blacklist:recheck', () => {
    logger.debug('Blacklist re-check requested');
  });

  // Entertainment balance warnings
  onWsEvent('entertainment:warning', (data: any) => {
    logger.warn('Entertainment balance warning', data);
    mainWindow?.webContents.send('ws:entertainmentWarning', data);
    showEntertainmentWarning(data);
  });

  onWsEvent('entertainment:forceIdle', (data: any) => {
    logger.warn('Entertainment force idle', data);
    mainWindow?.webContents.send('ws:entertainmentForceIdle', data);
    showEntertainmentForceIdle(data);
  });
}

// Register app:// protocol to serve files from asar
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

// App lifecycle
app.whenReady().then(() => {
  // Handle app:// protocol — serves from app root (asar or filesystem)
  protocol.handle('app', (request) => {
    const url = request.url.replace('app://', '');
    const filePath = path.join(__dirname, '..', url);
    return net.fetch('file://' + filePath);
  });
  Menu.setApplicationMenu(null);
  logger.info('Electron app started', { version: app.getVersion() });
  setupIPC();
  setupWsEvents();
  mainWindow = createMainWindow();
  floatWindow = createFloatBall();
  mainWindow.hide();

  createTray({
    onShow: () => {
      mainWindow?.show();
      mainWindow?.focus();
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  const token = store.get('token') as string;
  if (token) {
    connectWebSocket(getServerUrl(), token, store.get('companionId') as string);

    // Start blacklist polling via REST (works even when WS disconnected)
    const pollBlacklist = async () => {
      try {
        const token = store.get('token') as string;
        const serverUrl = getServerUrl();
        const res = await httpRequest({
          method: 'GET',
          url: `${serverUrl}/api/processes/blacklist/my-rules`,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data?.code === 200 && res.data?.data) {
          const { blacklist, whitelist, version } = res.data.data;
          updateBlacklist(blacklist || [], whitelist || [], version || 0);
        }
      } catch {
        /* ignore */
      }
    };
    setInterval(pollBlacklist, 60000); // poll every 60s
    pollBlacklist(); // immediate first fetch

    // Start process monitor (blacklist management - Phase 2/3)
    startProcessMonitor(
      (processes, totalCount) => {
        // Primary: REST (reliable)
        const token = store.get('token') as string;
        const serverUrl = getServerUrl();
        httpRequest({
          method: 'POST',
          url: `${serverUrl}/api/processes/reports`,
          headers: { Authorization: `Bearer ${token}` },
          body: { processes, totalCount },
        }).catch(() => {});
        // Also try WebSocket (real-time bonus)
        logger.debug('Process report', { totalCount });
        emitBlacklistReport(processes, totalCount);
      },
      (process) => {
        showKillNotification({
          processName: process.name,
          onKillNow: async () => {
            const result = await killProcess(process);
            if (result.success) {
              showKilledToast(process.name);
            } else {
              logger.warn('Kill failed', { processName: process.name, reason: result.resultText });
            }
            emitKillResult(result);
            // REST fallback for kill result
            try {
              const token = store.get('token') as string;
              const serverUrl = getServerUrl();
              httpRequest({
                method: 'POST',
                url: `${serverUrl}/api/processes/kill-report`,
                headers: { Authorization: `Bearer ${token}` },
                body: {
                  processName: process.name,
                  pid: process.pid,
                  success: result.success,
                  resultText: result.resultText,
                  triggeredBy: 'PERIODIC',
                },
              }).catch(() => {});
            } catch {
              /* ignore */
            }
          },
        });
      },
    );
  }
});

checkForUpdates();

let isSystemShutdown = false;

try {
  require('electron').powerMonitor.on('shutdown', () => {
    logger.info('System shutdown detected');
    isSystemShutdown = true;
  });
} catch {}

app.on('before-quit', () => {
  logger.info('App quitting');
  isQuitting = true;
  stopProcessMonitor();
  disconnectWebSocket();
});

app.on('window-all-closed', () => {
  // Don't quit on window close (tray app)
});

// ── Auto-silent update: poll server version and reload page on change ──
let lastVersion = '';
const VERSION_POLL_INTERVAL = 30_000; // 30 seconds

const pollVersion = async () => {
  try {
    const { httpRequest } = require('./http');
    const serverUrl = getServerUrl();
    const fullUrl = `${serverUrl}/api/version`;
    const res = await httpRequest({ method: 'GET', url: fullUrl, label: 'version-check' });
    const version = res?.data?.version || '';
    if (version && lastVersion && version !== lastVersion) {
      logger.info('New version detected, reloading page', { old: lastVersion, new: version });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }
    if (version) lastVersion = version;
  } catch {
    /* server might be restarting */
  }
};

// Initial version fetch after window loads
if (mainWindow) {
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(pollVersion, 5000); // initial check after 5s
    setInterval(pollVersion, VERSION_POLL_INTERVAL);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
