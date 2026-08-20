// craftsman-ignore: TS001,TS003
import { app, BrowserWindow, Menu, ipcMain, safeStorage, powerMonitor, Notification, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

// Write startup trace IMMEDIATELY at module load time
try {
  const t0 = path.join(app.getPath('desktop'), 'chunlv-trace.txt');
  fs.appendFileSync(t0, `${new Date().toISOString()} MODULE_LOADED\n`);
} catch {}
import { store } from './store';
import { getServerUrl } from './config';
import { logger } from './logger';
import { connectWebSocket, disconnectWebSocket, emitStatus, onWsEvent } from './websocket';
import { handleUpdateCommand, checkForUpdates } from './updater';
import { createTray } from './tray';
import { startCapture, stopCaptureAndFlush, cleanupStaleCaptures, flushAllPending } from './capture';
import { handleStatusChanged } from './screen-lock';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let currentRole = 'COMPANION';

// 允许局域网 http 地址使用麦克风/媒体接口
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', getServerUrl().replace(/\/$/, ''));

// ── Trace log on Desktop ──
const TRACE = path.join(app.getPath('desktop'), 'chunlv-trace.txt');
function trace(msg: string) {
  try {
    fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 23)} ${msg}\n`);
  } catch {}
}

// ── Utils ──
function getAppPassword(): string {
  return (store.get('appPassword') as string) || '123456';
}

// WebSocket 优先用 7 天有效期的 refreshToken，避免 accessToken 过期后主进程连不上
function getWsToken(): string {
  return (store.get('refreshToken') as string) || (store.get('token') as string) || '';
}

const STORE_KEYS = new Set([
  'token',
  'refreshToken',
  'companionId',
  'appPassword',
  'notificationPrefs',
  'notifSound',
  'notifVolume',
  'screenLocked',
  'lastStatus',
  'username',
  'companionName',
]);

let blacklistGuardTimer: ReturnType<typeof setInterval> | null = null;
let activeBlacklist: string[] = [];
let activeWhitelist: string[] = [];

function startBlacklistGuard(blacklist: Array<{ processName: string; processPath?: string | null }>, whitelist: Array<{ processName: string }>) {
  activeBlacklist = (blacklist || []).map((b) => b.processName).filter(Boolean);
  activeWhitelist = (whitelist || []).map((w) => w.processName).filter(Boolean);
  if (blacklistGuardTimer) clearInterval(blacklistGuardTimer);
  if (activeBlacklist.length === 0) return;
  blacklistGuardTimer = setInterval(() => {
    // 只有登录成功且当前状态为“空闲”时才执行黑名单杀进程。
    if (!store.get('token')) return;
    if (store.get('lastStatus') !== 'AVAILABLE') return;
    for (const name of activeBlacklist) {
      if (activeWhitelist.includes(name)) continue;
      new Notification({ title: '蠢驴电竞', body: `正在结束黑名单进程：${name}` }).show();
      execFile('taskkill', ['/F', '/IM', name, '/T'], () => {});
    }
  }, 10000);
}

let lastCollectAt = 0;
async function collectAndReportProcesses(tokenOverride?: string) {
  const token = tokenOverride || (store.get('token') as string);
  if (!token) return;
  // 页面里多个 useSocket 实例都会收到 pc:command，这里在 IPC 汇聚点做 5 秒去重，
  // 避免同一指令被重复上报。token 校验放在去重之前，防止无 token 的空调用误占去重位。
  const collectNow = Date.now();
  if (collectNow - lastCollectAt < 5000) return;
  lastCollectAt = collectNow;
  // 采集“已安装软件”（从 Windows 卸载注册表读取），带上 DisplayName、主程序 exe、发行商、安装时间、安装目录。
  const psCmd = String.raw`$paths = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '更新|Update|Hotfix|补丁|Driver|驱动|Runtime|Redistributable|SDK|Language|语言' } | ForEach-Object {
  $exe = ''
  if ($_.DisplayIcon) { try { $i = ($_.DisplayIcon -split ',')[0]; if ($i -match '\.exe$' -and $i -notmatch '(?i)unins|setup|install') { $exe = [IO.Path]::GetFileName($i) } } catch {} }
  [PSCustomObject]@{ name = $_.DisplayName; exe = $exe; publisher = $_.Publisher; installDate = $_.InstallDate; location = $_.InstallLocation }
} | ConvertTo-Json -Compress`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCmd],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    async (err, stdout) => {
      if (err) return;
      let processes: Array<{ name: string; exe?: string; publisher?: string; installDate?: string; location?: string }> = [];
      try {
        const parsed = JSON.parse(stdout);
        processes = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      } catch {
        return;
      }
      if (processes.length === 0) return;
      // 安装时间倒序（最近的排最前），无安装时间的排最后
      processes.sort((a, b) => {
        const da = a.installDate || '';
        const db = b.installDate || '';
        return db.localeCompare(da);
      });
      try {
        await fetch(`${getServerUrl()}/api/processes/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ processes, totalCount: processes.length }),
        });
      } catch {}
    },
  );
}

type SavedCredentials = { username?: string; password?: string };

function isTrustedSender(event: any): boolean {
  try {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return new URL(url).origin === new URL(getServerUrl()).origin;
  } catch {
    return false;
  }
}

function decryptSavedCredentials(): SavedCredentials | null {
  const raw = store.get('savedCredentials');
  if (!raw || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const json = safeStorage.decryptString(Buffer.from(String(raw), 'base64'));
    const parsed = JSON.parse(json) as SavedCredentials;
    return parsed?.username ? parsed : null;
  } catch {
    return null;
  }
}

// ── Password prompt ──
let pwResolve: ((ok: boolean) => void) | null = null;

// Signal the watchdog that this is an administrator-authorized exit.
// The watchdog consumes the signal and stops relaunching until reboot.
function signalAuthorizedExit(): Promise<void> {
  return new Promise((resolve) => {
    const script = '[System.Threading.EventWaitHandle]::OpenExisting("Global\\ChunlvExitRequested").Set()';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000, windowsHide: true },
      () => resolve(),
    );
  });
}

function promptPassword(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    pwResolve = resolve;
    const pwWin = new BrowserWindow({
      width: 360,
      height: 200,
      parent: mainWindow || undefined,
      modal: true,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../preload-dist/preload.js'),
      },
    });
    pwWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
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
</script></body></html>`)}`,
    );
    pwWin.on('closed', () => {
      if (pwResolve) {
        pwResolve(false);
        pwResolve = null;
      }
    });
  });
}

// ── IPC ──
function setupIPC(): void {
  ipcMain.on('pw:submit', (_e, pass: string) => {
    const ok = pass === getAppPassword();
    if (ok && pwResolve) {
      pwResolve(true);
      pwResolve = null;
      return;
    }
    _e.sender.executeJavaScript('window.__onPwResult(false)').catch(() => {});
  });
  ipcMain.handle('auth:promptLogoutPassword', async () => {
    const ok = await promptPassword('退出登录');
    if (!ok) throw new Error('密码错误');
    return true;
  });
  ipcMain.handle('store:get', (_e, key: string) => {
    return STORE_KEYS.has(key) ? store.get(key) : undefined;
  });
  ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
    if (!STORE_KEYS.has(key)) return { success: false };
    store.set(key, value);
    if ((key === 'token' || key === 'refreshToken') && value) {
      connectWebSocket(getServerUrl(), getWsToken(), (store.get('companionId') || '') as string);
    }
    return { success: true };
  });
  ipcMain.handle('credentials:get', (event) => {
    if (!isTrustedSender(event)) return null;
    return decryptSavedCredentials();
  });
  ipcMain.handle('credentials:save', (event, creds: { username?: unknown; password?: unknown }) => {
    if (!isTrustedSender(event)) return { success: false, reason: 'untrusted-origin' };
    const username = typeof creds?.username === 'string' ? creds.username.trim() : '';
    const password = typeof creds?.password === 'string' ? creds.password : '';
    if (!username || !password) {
      store.set('savedCredentials', '');
      return { success: true };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, reason: 'safe-storage-unavailable' };
    }
    try {
      const encrypted = safeStorage
        .encryptString(JSON.stringify({ username, password }))
        .toString('base64');
      store.set('savedCredentials', encrypted);
      return { success: true };
    } catch {
      return { success: false, reason: 'encrypt-failed' };
    }
  });
  ipcMain.handle('credentials:clear', (event) => {
    if (!isTrustedSender(event)) return { success: false };
    store.set('savedCredentials', '');
    return { success: true };
  });
  ipcMain.handle('config:getServerUrl', () => getServerUrl());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.on('auth:setRole', (_e, role: string) => {
    if (typeof role === 'string' && role) {
      currentRole = role;
    }
  });
  ipcMain.handle('folder:open', (_e, path: string) => {
    if (typeof path !== 'string' || !path.trim()) return { success: false };
    return shell.openPath(path.trim()).then(() => ({ success: true })).catch((err) => ({ success: false, error: String(err) }));
  });
  ipcMain.handle('watchdog:test', () => {
    trace('TEST-WATCHDOG');
    app.exit(0);
  });
  ipcMain.handle('screen:unlock', (_e, pass: string) => {
    if (pass !== getAppPassword()) return false;
    store.set('screenLocked', 'unlocked');
    return true;
  });
  ipcMain.on('companion:status', (_e, status: string) => {
    if (typeof status !== 'string') return;
    emitStatus(status);
    if (currentRole === 'COMPANION') handleStatusChanged(status);
  });
  ipcMain.handle('auth:logout', () => {
    store.set('token', '');
    store.set('companionId', '');
    disconnectWebSocket();
    return { success: true };
  });
  // 工作记录截图
  ipcMain.on('session:watch', (_e, sessionId: string) => {
    void startCapture(sessionId);
  });
  // 停止并等待全部截图上传完成
  ipcMain.handle('session:watch-stop', async () => {
    await stopCaptureAndFlush();
    return { success: true };
  });
  ipcMain.handle('processes:collect', async (_e, token?: string) => {
    await collectAndReportProcesses(token);
    return { success: true };
  });
}

// ── Lifecycle ──
app.whenReady().then(() => {
  trace('1-ready');
  Menu.setApplicationMenu(null);
  app.setLoginItemSettings({ openAtLogin: true });
  cleanupStaleCaptures();
  setupIPC();
  trace('2-ipc');

  // 开机/联网后补传未上传的截图（token 存在时）
  if (store.get('token')) {
    (async () => {
      await flushAllPending();
    })();
  }
  // 每 10 分钟重试一次补传（覆盖断网恢复场景，服务中会跳过）
  setInterval(
    () => {
      if (store.get('token')) {
        (async () => {
          await flushAllPending();
        })();
      }
    },
    10 * 60 * 1000,
  );

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: `蠢驴电竞 v${app.getVersion()}`,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload-dist/preload.js'),
    },
  });
  trace('3-win');
  const allowedOrigin = new URL(getServerUrl()).origin;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === allowedOrigin) return { action: 'allow' };
    } catch {
      // deny invalid or external URLs
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    // 允许语音通话所需的麦克风权限，以及系统通知和剪贴板权限
    callback(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });
  mainWindow.loadURL(getServerUrl().replace(/\/$/, '') + '/login');
  mainWindow.on('close', (e) => {
    trace('CLOSE isQuitting=' + isQuitting + ' stack=' + (new Error().stack || '').slice(0, 200));
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      trace('CLOSE-hidden');
    }
  });
  mainWindow.webContents.on('did-finish-load', () => trace('4-loaded'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    trace('FAIL-' + code + '-' + desc);
    if (code !== -3 && !isQuitting) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
          mainWindow.loadURL(getServerUrl().replace(/\/$/, '') + '/login');
        }
      }, 3000);
    }
  });

  // 系统唤醒后重新加载页面，避免唤醒后白屏
  powerMonitor.on('resume', () => {
    trace('POWER-RESUME');
    if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
      mainWindow.reload();
    }
  });

  createTray({
    onShow: () => {
      mainWindow?.show();
      mainWindow?.focus();
    },
    onQuit: async () => {
      // Password-protected graceful exit
      try {
        const ok = await promptPassword('退出确认');
        if (!ok) return;
        await signalAuthorizedExit();
      } catch {
        return;
      }
      isQuitting = true;
      app.quit();
    },
  });
  trace('5-tray');

  // Auto-relaunch when any child process (renderer/GPU) is killed
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    trace('RENDER-GONE ' + details.reason);
    app.relaunch();
    app.exit(0);
  });
  app.on('child-process-gone', (_e, details) => {
    trace('CHILD-GONE ' + details.type + ' ' + details.reason);
    app.relaunch();
    app.exit(0);
  });

  onWsEvent('pc:command', (data: any) => {
    if (data.command === 'update') handleUpdateCommand(data.downloadUrl);
    else if (data.command === 'test_watchdog') app.exit(0);
    else if (data.command === 'shutdown') {
      execFile('shutdown', ['/s', '/t', '0'], () => {});
    }
  });
  onWsEvent('blacklist:update', (data: any) => {
    if (currentRole !== 'COMPANION') return;
    startBlacklistGuard(data?.blacklist || [], data?.whitelist || []);
  });
  const token = getWsToken();
  if (token) connectWebSocket(getServerUrl(), token, (store.get('companionId') || '') as string);

  trace('6-done');
  checkForUpdates();
  // 登录或未登录都每 5 分钟检查一次更新，避免只能靠重启或手动推送才能更新。
  setInterval(() => {
    void checkForUpdates();
  }, 5 * 60 * 1000);
});

app.on('before-quit', () => {
  trace('quit');
});
app.on('window-all-closed', () => {});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}
