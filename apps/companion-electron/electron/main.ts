// craftsman-ignore: TS001,TS003
import { app, BrowserWindow, Menu, ipcMain, safeStorage, powerMonitor, Notification, shell, session, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';

// Write startup trace IMMEDIATELY at module load time
try {
  const t0 = path.join(app.getPath('desktop'), 'chunlv-trace.txt');
  fs.appendFileSync(t0, `${new Date().toISOString()} MODULE_LOADED\n`);
} catch {}
import { store } from './store';
import { getServerUrl } from './config';
import { logger } from './logger';
import { connectWebSocket, disconnectWebSocket, emitStatus, onWsEvent, isConnected } from './websocket';
import { handleUpdateCommand, checkForUpdates } from './updater';
import { createTray, updateTrayTooltip } from './tray';
import { startCapture, stopCaptureAndFlush, cleanupStaleCaptures, flushAllPending, pauseCapture, resumeCapture } from './capture';
import { handleStatusChanged, ensureHibernateEnabled, setAppPassword } from './screen-lock';

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

// 主进程未捕获异常兜底：不要让原生 Electron “Error” 弹窗卡住客户端。
// EPIPE 等日志管道错误已经在上层吞掉，这里只记录，不弹窗、不闪退。
process.on('uncaughtException', (err) => {
  try {
    trace(`UNCAUGHT ${err?.stack || err?.message || String(err)}`);
  } catch {}
});

// ── Utils ──
function getAppPassword(): string {
  return (store.get('appPassword') as string) || '123456';
}

/** 清空本地登录状态和“记住账号密码”，避免下次启动自动登录旧账号。 */
function clearAuthState(): void {
  store.set('token', '');
  store.set('refreshToken', '');
  store.set('companionId', '');
  store.set('savedCredentials', '');
  store.set('username', '');
  store.set('companionName', '');
  store.set('lastStatus', '');
  store.set('screenLocked', '');
  disconnectWebSocket();
}

// WebSocket 优先用 7 天有效期的 refreshToken，避免 accessToken 过期后主进程连不上
function getWsToken(): string {
  return (store.get('refreshToken') as string) || (store.get('token') as string) || '';
}

type SavedWindowBounds = {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
};

function getWindowBoundsKey(userId?: string): string {
  return `window.bounds:${userId || 'default'}`;
}

function loadWindowBounds(userId?: string): SavedWindowBounds {
  const key = getWindowBoundsKey(userId);
  try {
    const raw = store.get(key);
    if (raw && typeof raw === 'object') {
      const b = raw as SavedWindowBounds;
      if (Number.isFinite(b.width) && Number.isFinite(b.height)) {
        return b;
      }
    }
  } catch {}
  return { width: 1280, height: 800 };
}

function clampBoundsToDisplay(bounds: SavedWindowBounds): SavedWindowBounds {
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.max(900, Math.min(bounds.width || 1280, work.width));
  const height = Math.max(600, Math.min(bounds.height || 800, work.height));
  const x = bounds.x == null ? undefined : Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
  const y = bounds.y == null ? undefined : Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
  return { width, height, x, y };
}

let saveWindowBoundsTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveWindowBounds(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return;
  if (saveWindowBoundsTimer) clearTimeout(saveWindowBoundsTimer);
  saveWindowBoundsTimer = setTimeout(() => {
    const userId = (store.get('currentUserId') as string) || '';
    if (!userId || !win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    store.set(getWindowBoundsKey(userId), bounds);
  }, 600);
}

// 登录页地址带版本号做 cache-busting，避免 Electron 会话缓存返回旧前端。
function getLoginUrl(): string {
  const base = getServerUrl().replace(/\/$/, '') + '/login';
  // 每次启动都带时间戳，确保即使历史磁盘缓存残留，也一定加载最新 index.html。
  return `${base}?v=${app.getVersion()}&t=${Date.now()}`;
}

/** 陪玩接单中不自动更新，避免更新时退出进程打断服务计时/截图。 */
function maybeCheckUpdates(): void {
  if (currentRole === 'COMPANION' && store.get('lastStatus') === 'BUSY') {
    return;
  }
  void checkForUpdates();
}

// 更新流程是由看门狗把 zip 直接覆盖解压到 C:\Program Files\陪玩管理，
// 不会再跑一次 NSIS 安装器。老机器如果桌面快捷方式还指向旧目录
// （蠢驴电竞 / @chunlvcompanion-electron），更新后快捷方式就会变成空白或消失。
// 因此客户端每次启动时，都在当前用户桌面重建/校正「陪玩管理」快捷方式，
// 确保它永远指向本次正在运行的 exe。
function ensureDesktopShortcut(): void {
  // 开发模式（electron.exe）不创建快捷方式，避免污染开发机桌面。
  if (!app.isPackaged) return;

  let target = '';
  try {
    target = app.getPath('exe');
  } catch {
    return;
  }
  if (!target || !fs.existsSync(target)) return;

  let desktop = '';
  try {
    desktop = app.getPath('desktop');
  } catch {
    return;
  }
  const lnk = path.join(desktop, '陪玩管理.lnk');
  const dir = path.dirname(target);
  // 老版本 perMachine 安装器会把快捷方式放到「公共桌面」，当前用户桌面也会有我们新建的图标；
  // 两个桌面都要清理，否则会同时出现「陪玩管理」和「蠢驴电竞」两个图标。
  let publicDesktop = '';
  try {
    publicDesktop = path.join(path.dirname(app.getPath('home')), 'Public', 'Desktop');
  } catch {
    publicDesktop = '';
  }
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const script = [
    `$ErrorActionPreference='SilentlyContinue'`,
    `$w=New-Object -ComObject WScript.Shell`,
    `$s=$w.CreateShortcut(${q(lnk)})`,
    `$s.TargetPath=${q(target)}`,
    `$s.WorkingDirectory=${q(dir)}`,
    `$s.IconLocation=${q(`${target},0`)}`,
    `$s.Description='陪玩管理'`,
    `$s.Save()`,
    // 清理旧名称/旧目录造成的失效或重复快捷方式，避免桌面出现空白图标或三四个一样的图标。
    // 注意：枚举桌面快捷方式必须用 -Path，不能用 -LiteralPath，否则 *.lnk 不会被展开，
    // 旧快捷方式就一直删不掉，才会出现桌面上两个图标。
    `$desktops = @(${q(desktop)}${publicDesktop ? `,${q(publicDesktop)}` : ''})`,
    `foreach($d in $desktops){`,
    `  Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    if ($_.Name -notmatch '陪玩管理|蠢驴电竞|chunlv') { return }`,
    `    if ($_.FullName -eq ${q(lnk)}) { return }`,
    `    $t=$w.CreateShortcut($_.FullName).TargetPath`,
    `    if (-not $t -or -not (Test-Path -LiteralPath $t) -or ($t -ieq ${q(target)})) { Remove-Item -LiteralPath $_.FullName -Force }`,
    `  }`,
    `}`,
  ].join(';');

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
    (err) => {
      if (err) trace('SHORTCUT-ERR ' + (err?.message || String(err)));
      else trace('SHORTCUT-OK ' + target);
    },
  );
}

// 前端热更：陪玩不需要彻底退出客户端。主进程定时询问服务器最新前端版本，
// 一旦发现变了，只刷新当前页面（webContents.reload），不杀进程、不弹 UAC。
async function checkFrontendVersion(): Promise<void> {
  try {
    const base = getServerUrl().replace(/\/$/, '');
    const res = await fetch(`${base}/api/agent/frontend-version`);
    const json = (await res.json()) as any;
    const version = json?.data?.version;
    if (!version) return;

    const previous = (store.get('webVersion') as string) || '';
    if (!previous) {
      store.set('webVersion', version);
      return;
    }
    if (previous !== version) {
      store.set('webVersion', version);
      logger.info('Frontend version changed, reloading page', { previous, version });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    }
  } catch (err: any) {
    logger.warn('Frontend version check failed (non-fatal)', { error: err?.message });
  }
}

// 每次启动先清一次 HTTP 缓存，确保加载到服务端最新前端。
async function clearSessionCache(): Promise<void> {
  try {
    await session.defaultSession.clearCache();
  } catch {
    // 忽略清理失败，不阻塞启动
  }
}

const STORE_KEYS = new Set([
  'token',
  'refreshToken',
  'companionId',
  'currentUserId',
  'currentUsername',
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

/**
 * 上报一次自动杀进程，服务端「进程黑名单管理」里能看到是谁、什么时候、杀了什么进程。
 * 以前杀完不留痕迹，出现“游戏怎么突然掉了”时根本查不到原因。
 */
function reportAutoKill(processName: string, success: boolean, resultText?: string): void {
  void (async () => {
    try {
      const token = await refreshAccessToken();
      if (!token) return;
      await fetch(`${getServerUrl()}/api/process-blacklist/kill-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ processName, pid: 0, success, resultText, triggeredBy: 'AUTO_IDLE' }),
      });
    } catch {
      /* 上报失败不影响杀进程 */
    }
  })();
}

function startBlacklistGuard(blacklist: Array<{ processName: string; processPath?: string | null }>, whitelist: Array<{ processName: string }>) {
  activeBlacklist = (blacklist || []).map((b) => b.processName).filter(Boolean);
  activeWhitelist = (whitelist || []).map((w) => w.processName).filter(Boolean);
  if (blacklistGuardTimer) clearInterval(blacklistGuardTimer);
  // 以前这里不留任何痕迹，游戏被杀了也查不出是谁干的，这里补上。
  logger.info('Blacklist guard updated', {
    blacklist: activeBlacklist,
    whitelistCount: activeWhitelist.length,
    lastStatus: store.get('lastStatus') || '',
    armed: activeBlacklist.length > 0 && store.get('lastStatus') === 'AVAILABLE',
  });
  if (activeBlacklist.length === 0) return;
  blacklistGuardTimer = setInterval(() => {
    // 只有登录成功且明确处于「空闲」时才执行黑名单杀进程。
    if (!store.get('token')) return;
    // 状态未知（比如刚装好还没选过状态）时一律不动手，
    // 避免把正在玩游戏的人当成空闲直接踢下线。
    const lastStatus = store.get('lastStatus');
    if (lastStatus !== 'AVAILABLE') return;
    for (const name of activeBlacklist) {
      if (activeWhitelist.includes(name)) continue;
      const image = name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`;
      logger.warn('Killing blacklisted process', { processName: name, reason: 'status AVAILABLE' });
      new Notification({ title: '陪玩管理', body: `正在结束黑名单进程：${name}` }).show();
      execFile('taskkill', ['/F', '/IM', image, '/T'], (err) => {
        reportAutoKill(name, !err, err?.message);
      });
    }
  }, 10000);
}

/** 用 7 天有效期的 refreshToken 换一个新的 accessToken，避免采集上传时 token 已过期。 */
async function refreshAccessToken(): Promise<string> {
  const refreshToken = (store.get('refreshToken') as string) || '';
  if (!refreshToken) return (store.get('token') as string) || '';
  try {
    const res = await fetch(`${getServerUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const json = (await res.json()) as any;
    const accessToken = json?.data?.accessToken as string | undefined;
    if (accessToken) {
      store.set('token', accessToken);
      return accessToken;
    }
  } catch {}
  return (store.get('token') as string) || '';
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
  // 同时采集「正在运行的进程」和「已安装软件」，用已安装软件的中文名给运行进程配中文显示名。
  const psCmd = String.raw`$paths = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
$installed = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '更新|Update|Hotfix|补丁|Driver|驱动|Runtime|Redistributable|SDK|Language|语言' } | ForEach-Object {
  $exe = ''
  if ($_.DisplayIcon) { try { $i = ($_.DisplayIcon -split ',')[0]; if ($i -match '\.exe$' -and $i -notmatch '(?i)unins|setup|install') { $exe = [IO.Path]::GetFileName($i) } } catch {} }
  [PSCustomObject]@{ name = $_.DisplayName; exe = $exe }
}
$running = Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $p = $_
  $exe = ''
  try {
    if ($p.Path) { $exe = [IO.Path]::GetFileName($p.Path) }
  } catch {}
  if (-not $exe) {
    $exe = $p.ProcessName
    if ($exe -and $exe -notmatch '(?i)\.exe$') { $exe = "$exe.exe" }
  }
  if ($exe) { [PSCustomObject]@{ name = $exe; exe = $exe } }
} | Sort-Object exe -Unique
[PSCustomObject]@{ running = @($running); installed = @($installed) } | ConvertTo-Json -Depth 4 -Compress`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCmd],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    async (err, stdout) => {
      if (err) return;
      let running: Array<{ name: string; exe: string }> = [];
      let installed: Array<{ name: string; exe: string }> = [];
      try {
        const parsed = JSON.parse(stdout);
        running = (parsed.running || []) as Array<{ name: string; exe: string }>;
        installed = (parsed.installed || []) as Array<{ name: string; exe: string }>;
      } catch {
        return;
      }
      // 建立 exe（小写）→ 中文名的映射
      const nameMap = new Map<string, string>();
      for (const s of installed) {
        const exe = (s.exe || '').trim();
        if (exe) nameMap.set(exe.toLowerCase(), s.name);
      }
      const seen = new Set<string>();
      const processes: Array<{ name: string; exe: string }> = [];
      // 运行中的进程优先（用中文名），匹配不到就用 exe
      for (const r of running) {
        const exe = (r.exe || '').trim();
        if (!exe || seen.has(exe.toLowerCase())) continue;
        seen.add(exe.toLowerCase());
        processes.push({ name: nameMap.get(exe.toLowerCase()) || exe, exe });
      }
      // 再补上已安装但当前没在运行的软件（方便黑名单游戏）
      for (const s of installed) {
        const exe = (s.exe || '').trim();
        if (!exe || seen.has(exe.toLowerCase())) continue;
        seen.add(exe.toLowerCase());
        processes.push({ name: s.name, exe });
      }
      if (processes.length === 0) return;
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

/** 采集本地日志（客户端 + 看门狗）并上报到服务端，用于排查掉线/看门狗问题。 */
async function collectAndReportLogs(token: string): Promise<void> {
  const readTail = (file: string, maxLines = 300): string => {
    try {
      if (!file || !fs.existsSync(file)) return '';
      const raw = fs.readFileSync(file, 'utf-8');
      const lines = raw.split(/\r?\n/);
      return lines.slice(-maxLines).join('\n');
    } catch {
      return '';
    }
  };

  // 诊断信息：即使日志为空也上报，便于定位文件路径/是否存在/进程是否在。
  const diag: Record<string, string> = {};
  try {
    diag.exePath = app.getPath('exe');
    diag.userData = app.getPath('userData');
    const sh = 'C:\\Program Files\\SystemHelper\\service.log';
    diag.systemHelperLogExists = String(fs.existsSync(sh));
    diag.systemHelperLogSize = fs.existsSync(sh) ? String(fs.statSync(sh).size) : '0';
    const userLogDir = path.join(app.getPath('userData'), 'logs');
    diag.userLogDirExists = String(fs.existsSync(userLogDir));
    if (fs.existsSync(userLogDir)) {
      const files = fs.readdirSync(userLogDir).filter((f) => f.endsWith('.log'));
      diag.userLogFiles = JSON.stringify(files);
    }
    // SystemHelper 进程是否在
    try {
      const ps = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process SystemHelper -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count"], { windowsHide: true, timeout: 8000 }).toString().trim();
      diag.systemHelperRunning = ps;
    } catch {}
  } catch {}

  // 客户端日志（只在 userData/logs 一份，logger 已不再往安装目录重复写）
  let userLog = '';
  try {
    const userLogDir = path.join(app.getPath('userData'), 'logs');
    const today = new Date().toISOString().slice(0, 10);
    userLog = readTail(path.join(userLogDir, `companion-${today}.log`));
  } catch {}

  // 看门狗日志
  const systemHelperLog = readTail('C:\\Program Files\\SystemHelper\\service.log');

  const report = async (source: string, lines: string) => {
    if (!lines.trim()) return;
    try {
      await fetch(`${getServerUrl()}/api/agent/logs/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ source, lines }),
      });
    } catch {}
  };

  await report('systemhelper', systemHelperLog);
  await report('client-userdata', userLog);
  // 诊断信息单独上报（含换行，方便检索）
  await report('diag', Object.entries(diag).map(([k, v]) => `${k}=${v}`).join('\n'));
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

// ── 群聊广播弹窗（Windows 置顶窗口，5 秒后自动消失） ──
function escapeHtml(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    return '&quot;';
  });
}

function broadcastPopupHtml(payload: { title?: string; body?: string }): string {
  const title = escapeHtml(payload?.title || '群聊广播');
  const body = escapeHtml(payload?.body || '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;font-family:"Microsoft YaHei",sans-serif;overflow:hidden}
.card{position:relative;display:flex;gap:12px;align-items:flex-start;height:calc(100vh - 8px);margin:4px;padding:14px 16px 16px;background:linear-gradient(135deg,#1E293B,#0F172A);border:1px solid #FF4757;border-left:5px solid #FF4757;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);color:#F8FAFC;overflow:hidden}
.icon{font-size:22px;line-height:1.2}
.t{font-size:14px;font-weight:700;color:#fff}
.b{margin-top:6px;font-size:13px;line-height:1.6;color:#E2E8F0;word-break:break-word;max-height:66px;overflow:hidden}
.bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:#FF4757;transform-origin:left;animation:drain 5s linear forwards}
@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
</style></head><body>
<div class="card"><div class="icon">📢</div><div style="min-width:0;flex:1"><div class="t">${title}</div><div class="b">${body}</div></div><div class="bar"></div></div>
</body></html>`;
}

const broadcastWindows: BrowserWindow[] = [];

/**
 * 弹出广播提示：置顶、不抢焦点、鼠标穿透，5 秒后自己关闭。
 * 陪玩在打游戏或最小化了客户端时，也能在屏幕右下角看到。
 */
function showBroadcastPopup(payload: { title?: string; body?: string }): void {
  const W = 480;
  const H = 150;
  const GAP = 10;
  const MARGIN = 20;
  const area = screen.getPrimaryDisplay().workArea;

  // 同时最多 3 个，超了先关掉最旧的
  while (broadcastWindows.length >= 3) {
    const oldest = broadcastWindows.shift();
    if (oldest && !oldest.isDestroyed()) oldest.destroy();
  }
  const index = broadcastWindows.length;

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: area.x + area.width - W - MARGIN,
    y: area.y + area.height - H - MARGIN - index * (H + GAP),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 鼠标穿透：不挡住陪玩点游戏/点微信
  win.setIgnoreMouseEvents(true, { forward: true });
  broadcastWindows.push(win);
  win.on('closed', () => {
    const i = broadcastWindows.indexOf(win);
    if (i >= 0) broadcastWindows.splice(i, 1);
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.loadURL(
    `data:text/html;charset=utf-8;base64,${Buffer.from(broadcastPopupHtml(payload)).toString('base64')}`,
  );
  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, 5000);
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
      `data:text/html;charset=utf-8;base64,${Buffer.from(`<!DOCTYPE html>
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
</script></body></html>`).toString('base64')}`,
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
  ipcMain.on('auth:setCurrentUser', (_e, userId: string, username: string) => {
    if (typeof userId === 'string' && userId) store.set('currentUserId', userId);
    if (typeof username === 'string' && username) store.set('currentUsername', username);
  });
  ipcMain.on('auth:setRole', (_e, role: string) => {
    if (typeof role === 'string' && role) {
      currentRole = role;
    }
  });
  ipcMain.on('auth:setStudioName', (_e, name: string) => {
    if (typeof name === 'string' && name.trim()) {
      const clean = name.trim();
      mainWindow?.setTitle(`${clean} v${app.getVersion()}`);
      updateTrayTooltip(clean);
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
    clearAuthState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(getLoginUrl());
    }
    return { success: true };
  });
  ipcMain.handle('app:set-password', (_e, oldPassword: string, newPassword: string) => {
    if (oldPassword !== getAppPassword()) {
      return { success: false, message: '旧密码错误' };
    }
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      return { success: false, message: '新密码至少4位' };
    }
    setAppPassword(newPassword);
    return { success: true };
  });
  // 工作记录截图
  ipcMain.on('session:watch', (_e, sessionId: string) => {
    void startCapture(sessionId);
  });
  ipcMain.on('session:pause', () => {
    pauseCapture();
  });
  ipcMain.on('session:resume', () => {
    resumeCapture();
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
  // 系统通知：陪玩端最小化/在打游戏时也能弹出 Windows 通知（搭档邀请、订单提醒等）。
  ipcMain.on('notify', (_e, title: string, body: string) => {
    try {
      new Notification({ title: String(title || '陪玩管理'), body: String(body || '') }).show();
    } catch {}
  });

  // 群聊广播：主进程直接画一个 Windows 置顶窗口（5 秒后自动消失）。
  // 普通系统通知在没装过开机快捷方式的机器上不一定弹得出来，所以这里自己画，
  // 保证"客服喊话陪玩必须看到"。
  ipcMain.handle('broadcast:popup', (event, payload: { title?: string; body?: string }) => {
    if (!isTrustedSender(event)) return { ok: false, reason: 'untrusted-origin' };
    try {
      showBroadcastPopup({ title: payload?.title, body: payload?.body });
      return { ok: true };
    } catch (err: any) {
      logger.warn('Broadcast popup failed, fallback to system notification', {
        error: err?.message || err,
      });
      try {
        new Notification({
          title: String(payload?.title || '群聊广播'),
          body: String(payload?.body || ''),
        }).show();
      } catch {}
      return { ok: false };
    }
  });
}

function setupApplicationMenu(): void {
  // Electron 打包后如果把菜单设为 null，Windows/Linux 上 Ctrl+C/V/X/A
  // 这类剪贴板快捷键也会跟着失效，导致陪玩端截图粘贴框无法响应 Ctrl+V。
  // 这里保留一个隐藏的 Edit 菜单，只提供系统剪贴板快捷键。
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ──
app.whenReady().then(() => {
  trace('1-ready');
  // Windows 通知需要 AppUserModelID，否则右下角系统通知弹不出来（搭档邀请、订单提醒等）。
  app.setAppUserModelId('com.chunlv.companion');
  ensureDesktopShortcut();
  ensureHibernateEnabled();
  setupApplicationMenu();
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

  const currentUserId = (store.get('currentUserId') as string) || '';
  const savedBounds = clampBoundsToDisplay(loadWindowBounds(currentUserId || undefined));
  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    ...(savedBounds.x != null ? { x: savedBounds.x } : {}),
    ...(savedBounds.y != null ? { y: savedBounds.y } : {}),
    minWidth: 900,
    minHeight: 600,
    title: `陪玩管理 v${app.getVersion()}`,
    show: false,
    autoHideMenuBar: true,
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
  void clearSessionCache().then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(getLoginUrl());
    }
  });
  mainWindow.on('resize', () => scheduleSaveWindowBounds(mainWindow!));
  mainWindow.on('move', () => scheduleSaveWindowBounds(mainWindow!));
  mainWindow.on('close', (e) => {
    trace('CLOSE isQuitting=' + isQuitting + ' stack=' + (new Error().stack || '').slice(0, 200));
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      trace('CLOSE-hidden');
    }
  });
  mainWindow.webContents.on('did-finish-load', () => trace('4-loaded'));
  // 只在「登录页自己加载失败」时重试。以前是窗口里任何一次加载失败都会把整个
  // 窗口强行 loadURL 回登录页，陪玩/客服正用着会突然掉到登录界面。
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    trace('FAIL-' + code + '-' + desc + '-' + (isMainFrame ? 'main' : 'sub'));
    if (!isMainFrame) return;
    if (code === -3 || isQuitting) return;
    const loginPath = getLoginUrl().split('?')[0];
    if (!String(failedUrl || '').startsWith(loginPath)) return;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !isQuitting && !mainWindow.webContents.isLoading()) {
        mainWindow.loadURL(getLoginUrl());
      }
    }, 3000);
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
      // 只有陪玩需要密码退出；客服/店长/老板直接退出。
      // 但所有角色退出时都要通知看门狗，否则看门狗会把程序自动拉起来（管理端不该被保活）。
      if (currentRole === 'COMPANION') {
        try {
          const ok = await promptPassword('退出确认');
          if (!ok) return;
          // 这里就是用户说的“退出账号”：验证管理密码后，必须把记住的账号密码一并清掉。
          // 否则下次双击快捷方式，登录页会自动用旧账号登录。
          clearAuthState();
        } catch {
          return;
        }
      }
      await signalAuthorizedExit();
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
    else if (data.command === 'collect_processes') {
      (async () => {
        const fresh = await refreshAccessToken();
        if (fresh) await collectAndReportProcesses(fresh);
      })();
    }
    else if (data.command === 'collect_logs') {
      (async () => {
        const fresh = await refreshAccessToken();
        if (fresh) await collectAndReportLogs(fresh);
      })();
    }
    else if (data.command === 'kick') {
      // 被管理员踢出/离职：清空本地登录并回到登录页，避免下次开机自动登录。
      clearAuthState();
      if (mainWindow) mainWindow.loadURL(getLoginUrl());
    }
    else if (data.command === 'shutdown') {
      execFile('shutdown', ['/s', '/t', '0'], () => {});
    }
  });
  onWsEvent('blacklist:update', (data: any) => {
    if (currentRole !== 'COMPANION') return;
    if (data?.status) {
      const local = store.get('lastStatus');
      const localOffDuty = local === 'ENTERTAINMENT' || local === 'RESTING';
      // 服务端在连接/心跳时只是按「在线 = 空闲」补推一次，那只是猜测（authoritative=false）。
      // 不能让猜出来的空闲覆盖陪玩自己选的娱乐中/休息，
      // 否则一覆盖客户端就会立刻开始杀游戏进程。
      if (data.authoritative === true || !(localOffDuty && data.status === 'AVAILABLE')) {
        store.set('lastStatus', data.status);
      } else {
        logger.warn('Ignored non-authoritative AVAILABLE status (kept local off-duty status)', {
          local,
          pushed: data.status,
        });
      }
    }
    startBlacklistGuard(data?.blacklist || [], data?.whitelist || []);
  });
  const token = getWsToken();
  if (token) connectWebSocket(getServerUrl(), token, (store.get('companionId') || '') as string);

  // 掉线自愈：服务器重启后，socket.io 偶尔会卡在 connect_error（进程没死、看门狗不拉起）。
  // 这里每 90 秒检查一次，若已登录却仍未连上，就强制重建一次 WebSocket，避免一直掉线。
  setInterval(() => {
    try {
      if (store.get('token') && !isConnected()) {
        logger.warn('WS reconnect watchdog: forcing reconnect');
        connectWebSocket(getServerUrl(), getWsToken(), (store.get('companionId') || '') as string);
      }
    } catch {}
  }, 90 * 1000);

  trace('6-done');
  maybeCheckUpdates();
  // 前端版本热更检查：启动先记录一次，之后每 5 分钟查一次。
  // 以前是 60 秒一次：一个纯版本号查询，20 个客户端一天能打出近 3 万次请求，
  // 电脑也白跑一天。改 5 分钟后，仍然满足「发布后 5 分钟内自动更新」这条承诺。
  void checkFrontendVersion();
  setInterval(() => {
    void checkFrontendVersion();
  }, 5 * 60 * 1000);
  // 登录或未登录都每 30 分钟检查一次更新（原来是 5 分钟，一天 288 次没有必要；
  // 紧急更新仍然可以用后台「推送更新」立即下发）。
  setInterval(() => {
    maybeCheckUpdates();
  }, 30 * 60 * 1000);
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
