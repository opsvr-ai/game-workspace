// craftsman-ignore: TS001,TS003
import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

// Write startup trace IMMEDIATELY at module load time
try {
  const t0 = path.join(app.getPath('desktop'), 'chunlv-trace.txt');
  fs.appendFileSync(t0, `${new Date().toISOString()} MODULE_LOADED\n`);
} catch {}
import { store } from './store';
import { getServerUrl } from './config';
import { logger } from './logger';
import { connectWebSocket, onWsEvent } from './websocket';
import { handleUpdateCommand, checkForUpdates } from './updater';
import { createTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// ── Trace log on Desktop ──
const TRACE = path.join(app.getPath('desktop'), 'chunlv-trace.txt');
function trace(msg: string) {
  try { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11,23)} ${msg}\n`); } catch {}
}

// ── Utils ──
function getAppPassword(): string {
  return (store.get('appPassword') as string) || '123456';
}

// ── Password prompt ──
let pwResolve: ((ok: boolean) => void) | null = null;

function promptPassword(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    pwResolve = resolve;
    const pwWin = new BrowserWindow({
      width: 360, height: 200,
      parent: mainWindow || undefined,
      modal: true, resizable: false, frame: false,
      transparent: true, alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true, nodeIntegration: false,
        preload: path.join(__dirname, '../preload-dist/preload.js'),
      },
    });
    pwWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0F172A;color:#e2e8f0;font-family:"Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;border:2px solid #00D4FF;border-radius:12px;overflow:hidden}
.box{width:300px;text-align:center}
h3{font-size:14px;margin-bottom:6px;color:#fff}
.sub{font-size:11px;color:#94a3b8;margin-bottom:14px}
input{width:100%;padding:8px 12px;font-size:14px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#fff;text-align:center;outline:none;margin-bottom:10px}
input:focus{border-color:#00D4FF}
.err{color:#f87171;font-size:11px;margin-bottom:8px;display:none}
.btns{display:flex;gap:8px;justify-content:center}
button{padding:6px 20px;font-size:13px;border:none;border-radius:6px;cursor:pointer;font-weight:600}
.btn-ok{background:#00D4FF;color:#000}
.btn-cancel{background:#334155;color:#94a3b8}
button:hover{opacity:0.85}
</style></head><body>
<div class="box"><h3>${title}</h3><div class="sub">请输入管理员密码</div>
<div class="err" id="err">密码错误</div>
<input type="password" id="pw" autofocus>
<div class="btns">
<button class="btn-cancel" onclick="window.close()">取消</button>
<button class="btn-ok" onclick="submit()">确认</button>
</div></div>
<script>
function submit(){window.electronAPI.pwSubmit(document.getElementById('pw').value);}
document.getElementById('pw').addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
window.__onPwResult=function(ok){if(!ok){document.getElementById('err').style.display='block';document.getElementById('pw').value='';document.getElementById('pw').focus();}else{window.close();}};
</script></body></html>`)}`);
    pwWin.on('closed', () => { if (pwResolve) { pwResolve(false); pwResolve = null; } });
  });
}

// ── IPC ──
function setupIPC(): void {
  ipcMain.on('pw:submit', (_e, pass: string) => {
    const ok = pass === getAppPassword();
    if (ok && pwResolve) { pwResolve(true); pwResolve = null; return; }
    _e.sender.executeJavaScript('window.__onPwResult(false)').catch(() => {});
  });
  ipcMain.handle('auth:promptLogoutPassword', async () => {
    const ok = await promptPassword('退出登录');
    if (!ok) throw new Error('密码错误');
    return true;
  });
  ipcMain.handle('store:get', (_e, key: string) => store.get(key));
  ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
    store.set(key, value);
    if (key === 'token' && value) {
      connectWebSocket(getServerUrl(), String(value), (store.get('companionId') || '') as string);
    }
    return { success: true };
  });
  ipcMain.handle('auth:logout', () => {
    store.set('token', ''); store.set('companionId', '');
    return { success: true };
  });
}

// ── Lifecycle ──
app.whenReady().then(() => {
  trace('1-ready');
  Menu.setApplicationMenu(null);
  app.setLoginItemSettings({ openAtLogin: true });
  setupIPC();
  trace('2-ipc');

  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: '蠢驴电竞陪玩', show: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, '../preload-dist/preload.js'),
    },
  });
  trace('3-win');
  mainWindow.loadURL(getServerUrl().replace(/\/$/, '') + '/companion');
  mainWindow.on('close', (e) => {
    trace('CLOSE isQuitting=' + isQuitting + ' stack=' + (new Error().stack || '').slice(0,200));
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); trace('CLOSE-hidden'); }
  });
  mainWindow.webContents.on('did-finish-load', () => trace('4-loaded'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    trace('FAIL-' + code + '-' + desc);
  });

  createTray({
    onShow: () => { mainWindow?.show(); mainWindow?.focus(); },
    onQuit: async () => {
      // Password-protected graceful exit
      try {
        const ok = await promptPassword('退出确认');
        if (!ok) return;
      } catch { return; }
      isQuitting = true;
      app.quit();
    },
  });
  trace('5-tray');

  // Auto-relaunch when any child process (renderer/GPU) is killed
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    trace('RENDER-GONE ' + details.reason);
    app.relaunch();
    app.quit();
  });
  app.on('child-process-gone', (_e, details) => {
    trace('CHILD-GONE ' + details.type + ' ' + details.reason);
    app.relaunch();
    app.quit();
  });

  onWsEvent('pc:command', (data: any) => {
    if (data.command === 'update') handleUpdateCommand(data.downloadUrl);
  });
  const token = store.get('token') as string;
  if (token) connectWebSocket(getServerUrl(), token, (store.get('companionId') || '') as string);

  trace('6-done');
  checkForUpdates();

  trace('6-done');
});

app.on('before-quit', () => { trace('quit'); });
app.on('window-all-closed', () => {});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); }); }
