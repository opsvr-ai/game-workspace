import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
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
import { emitStatus, isConnected as isWsConnected, emitBlacklistReport, emitKillResult, emitCommandAck } from './websocket';
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load web app — dev mode uses local Vite, prod uses server's web port
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const serverUrl = getServerUrl();
    // Web app served on port 8000 (same host as API server on 3001)
    const webUrl = serverUrl.replace(/:3001$/, ':8000');
    win.loadURL(webUrl);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
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
  ipcMain.handle('app:setPassword', (_e, password: string) => { setAppPassword(password); return { success: true }; });
  ipcMain.handle('app:getPassword', () => getAppPasswordForUI());

  // Window controls
  ipcMain.handle('window:show', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  ipcMain.handle('window:hide', () => { mainWindow?.hide(); });

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
    if (status === 'RESTING') { showScreenLock(); } else { hideScreenLock(); }
    const name = store.get('companionName') as string;
    logger.info('IPC status:changed received', { status, name });
    updateTrayTooltip(`蠢驴电竞 - ${name} (${status})`);
    // Sync to server via WebSocket
    emitStatus(status);
  });
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

// App lifecycle
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  logger.info('Electron app started', { version: app.getVersion() });
  setupIPC();
  setupWsEvents();
  mainWindow = createMainWindow();

  createTray({
    onShow: () => { mainWindow?.show(); mainWindow?.focus(); },
    
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
      } catch { /* ignore */ }
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
        logger.debug("Process report", { totalCount });
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
                body: { processName: process.name, pid: process.pid, success: result.success, resultText: result.resultText, triggeredBy: 'PERIODIC' },
              }).catch(() => {});
            } catch { /* ignore */ }
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


const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}
