import { app, BrowserWindow, ipcMain } from 'electron';
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
import { emitStatus, isConnected as isWsConnected, emitBlacklistReport, emitKillResult } from './websocket';
import { logger } from './logger';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
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

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
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

        connectWebSocket(serverUrl, res.data.data.accessToken, store.get('companionId'));

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
    notifyOrder(data, false);
    mainWindow?.webContents.send('ws:orderNew', data);
  });

  onWsEvent('order:urgent', (data: any) => {
    notifyOrder(data, true);
    mainWindow?.webContents.send('ws:orderUrgent', data);
  });

  onWsEvent('order:pool_updated', (data: any) => {
    mainWindow?.webContents.send('ws:poolUpdated', data);
  });

  onWsEvent('status:broadcast', (data: any) => {
    mainWindow?.webContents.send('ws:statusBroadcast', data);
  });

  onWsEvent('pc:command', (data: any) => {
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
}

// App lifecycle
app.whenReady().then(() => {
  setupIPC();
  setupWsEvents();
  mainWindow = createMainWindow();

  createTray({
    onShow: () => { mainWindow?.show(); mainWindow?.focus(); },
    onQuit: () => { isQuitting = true; disconnectWebSocket(); app.quit(); },
  });

  const token = store.get('token') as string;
  if (token) {
    connectWebSocket(getServerUrl(), token, store.get('companionId') as string);

    // Start process monitor (blacklist management - Phase 2/3)
    startProcessMonitor(
      (processes, totalCount) => {
        emitBlacklistReport(processes, totalCount);
      },
      (process) => {
        showKillNotification({
          processName: process.name,
          onKillNow: async () => {
            const result = await killProcess(process);
            showKilledToast(process.name);
            emitKillResult(result);
          },
        });
      },
    );
  }
});

app.on('before-quit', () => {
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
