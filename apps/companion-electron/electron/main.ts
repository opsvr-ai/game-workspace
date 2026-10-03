// craftsman-ignore: TS001,TS003
import { app, BrowserWindow, Menu, ipcMain, safeStorage, powerMonitor, Notification, shell, session, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync, spawn } from 'child_process';

import { store } from './store';
import { getServerUrl } from './config';
import { logger } from './logger';
import { connectWebSocket, disconnectWebSocket, emitStatus, onWsEvent, isConnected } from './websocket';
import { handleUpdateCommand, checkForUpdates } from './updater';
import { createTray, updateTrayTooltip } from './tray';
import { startCapture, stopCaptureAndFlush, cleanupStaleCaptures, flushAllPending, pauseCapture, resumeCapture } from './capture';
import { handleStatusChanged, ensureHibernateEnabled, setAppPassword, getAppPassword } from './screen-lock';

// 机器台账 / 远程一键诊断：把这块电脑报给服务端，并领远程任务回来执行。
// 说明见 electron/machine-agent.js（和客服端同一套实现）。
const { createMachineAgent } = require('./machine-agent');

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let currentRole = 'COMPANION';
// 托盘实例：托盘没建起来（返回 null）时不能走「关窗口=隐藏」，否则窗口再也叫不回来。
let companionTray: ReturnType<typeof createTray> = null;

// 允许局域网 http 地址使用麦克风/媒体接口
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', getServerUrl().replace(/\/$/, ''));

// 主进程未捕获异常兜底：不要让原生 Electron “Error” 弹窗卡住客户端。
// EPIPE 等日志管道错误已经在上层吞掉，这里只记录，不弹窗、不闪退。
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in main process', {
    error: String(err?.stack || err?.message || err),
  });
});

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

/**
 * 陪玩接单中不自动更新，避免更新时退出进程打断服务计时/截图。
 * 但别再像以前那样「接单中直接跳过整轮检查」：开机时正好在接单的话，这一轮就不查了，
 * 得再等 30 分钟（老板 2026-10-03 要「每次开机都能更新成功」）。
 * 现在照样发起检查，performUpdate 里的 waitUntilIdle 会等这单结束再动手。
 */
function maybeCheckUpdates(): void {
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
      if (err) logger.warn('Desktop shortcut failed', { target, error: err?.message || String(err) });
    },
  );
}

// 看门狗更新完会等客户端自报「我起来了」（C:\ProgramData\chunlv\client-healthy.json）：
// 等不到就整目录回滚到更新前那一版。这个是「这次更新到底有没有把客户端搞坏」的判据，
// 所以只要主进程起来了就写，之后每分钟刷新一次时间戳。
function writeHealthMarker(): void {
  try {
    const dir = 'C:\\ProgramData\\chunlv';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'client-healthy.json'),
      JSON.stringify({ version: app.getVersion(), exePath: app.getPath('exe'), at: Date.now() }),
      'utf-8',
    );
  } catch {
    // 写不了就算了：没见过这个标记的机器上，看门狗不会按它回滚，只是少一层保护。
  }
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
  // 启动器「杀了就立刻拉起」时，事件监听会一秒内连着命中好几次，这里按进程名限流。
  const now = Date.now();
  if (now - (killReportAt.get(processName) || 0) < KILL_REPORT_COOLDOWN_MS) return;
  killReportAt.set(processName, now);
  void (async () => {
    try {
      const token = await refreshAccessToken();
      if (!token) return;
      // 路径必须是 /api/processes/kill-report：服务端那个控制器是 @Controller('processes')，
      // 这里以前写成 /api/process-blacklist/kill-report（404），于是杀进程日志一条都没记上
      // —— 老板 2026-10-03 报「杀了查不出来」就是这个。web 端一直用的是 /processes/reports，是对的。
      await fetch(`${getServerUrl()}/api/processes/kill-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ processName, pid: 0, success, resultText, triggeredBy: 'AUTO_IDLE' }),
      });
    } catch {
      /* 上报失败不影响杀进程 */
    }
  })();
}

/**
 * 黑名单杀进程的提示。
 *
 * 老板 2026-10-03 报「杀的时候右下角怎么没提示」：以前这里走 Electron 系统通知
 * （new Notification），Windows 的「专注助手」/ 通知总开关一关就什么都看不见，
 * 全屏打游戏时更是直接被系统吞掉。改成陪玩端已有的右下角置顶小窗
 * （跟群聊广播、新单提醒同一套，全屏游戏里也压在最上层），保证「看得见」。
 *
 * 老板再报「右下角还是一直弹提示」：老版本（1.0.20261003）每 10 秒弹一次，完全没去重；
 * 上一版改成按「进程名」去重也不对 —— 进程名从头到尾都没变，怎么限流都会重复弹。
 * 现在按「进程实例」（PID）去重：一个实例只杀一次、只提示一次；
 * 进程被启动器重新拉起来（新 PID）才算新的一次，这时才再杀、再提示。
 *
 * 老板要的「杀进程倒计时提示」也在这里：每次真要动手前，先在右下角弹一个
 * 5 秒倒计时小窗（进度条走完就杀）；杀成功不再补弹第二个窗，
 * 所以「一次启动」＝「一次杀 + 一次提示」。
 */
/** 提示冷却：同一进程名的提示别挤在一起（启动器一秒拉起好几次时兜底）。 */
const killNoticeAt = new Map<string, number>();
const KILL_NOTICE_COOLDOWN_MS = 60 * 1000;
/** 处理过的进程实例：processName -> 处理过的 PID 集合（按实例去重的关键）。 */
const handledPids = new Map<string, Set<number>>();
/** 正有一个实例在倒计时/执行中的进程名，别让事件和兜底扫描同时安排两次。 */
const handlingNames = new Set<string>();
/** 杀之前的倒计时秒数（右下角进度条正好走完）。 */
const KILL_COUNTDOWN_SECONDS = 5;
/** 杀进程上报也要限流：启动器「杀了又拉起」时一秒能刷出好几条日志。 */
const killReportAt = new Map<string, number>();
const KILL_REPORT_COOLDOWN_MS = 30 * 1000;
/** 兜底扫描间隔：监听器好用就 60 秒，起不来就退回 3 秒快扫（见 scheduleProcessWatcherRestart）。 */
let blacklistSweepIntervalMs = 60_000;
/** 守卫还在跑上一轮（tasklist / taskkill 没回来）时，别叠加下一轮。 */
let blacklistGuardRunning = false;
/** 进程启动监听器（常驻 PowerShell 子进程）的状态。 */
let processWatcher: ReturnType<typeof spawn> | null = null;
let processWatcherReady = false;
let processWatcherFailures = 0;
let processWatcherRestart: ReturnType<typeof setTimeout> | null = null;
let processWatcherOut = '';

function popupNotice(title: string, body: string, icon: string, hint?: string, seconds = 8): void {
  try {
    showBroadcastPopup({ title, body, icon, hint, seconds });
  } catch (err) {
    // 弹窗失败也别让陪玩两头都看不到：退回系统通知。
    logger.warn('Kill notice popup failed, fallback to system notification', {
      error: (err as Error)?.message,
    });
    try {
      new Notification({ title: '陪玩管理', body }).show();
    } catch {}
  }
}

/** 这个进程名现在该不该弹提示（按进程名限流，见 KILL_NOTICE_COOLDOWN_MS）。 */
function shouldNotice(processName: string): boolean {
  const now = Date.now();
  if (now - (killNoticeAt.get(processName) || 0) < KILL_NOTICE_COOLDOWN_MS) return false;
  killNoticeAt.set(processName, now);
  return true;
}

function startBlacklistGuard(blacklist: Array<{ processName: string; processPath?: string | null }>, whitelist: Array<{ processName: string }>) {
  activeBlacklist = (blacklist || []).map((b) => b.processName).filter(Boolean);
  activeWhitelist = (whitelist || []).map((w) => w.processName).filter(Boolean);
  // 名单变了：只清掉「已经不在黑名单里」的实例记录，名单没变就别重置，
  // 否则服务端重推一次 blacklist:update，同一次启动就会被再杀一遍、再弹一次。
  for (const name of Array.from(handledPids.keys())) {
    if (!activeBlacklist.includes(name)) handledPids.delete(name);
  }
  // 以前这里不留任何痕迹，游戏被杀了也查不出是谁干的，这里补上。
  logger.info('Blacklist guard updated', {
    blacklist: activeBlacklist,
    whitelistCount: activeWhitelist.length,
    lastStatus: store.get('lastStatus') || '',
    armed: activeBlacklist.length > 0 && store.get('lastStatus') === 'AVAILABLE',
  });
  if (activeBlacklist.length === 0) {
    stopProcessWatcher();
    if (blacklistGuardTimer) {
      clearInterval(blacklistGuardTimer);
      blacklistGuardTimer = null;
    }
    return;
  }
  // 主力：常驻监听进程启动事件；兜底：低频扫描（监听器起不来时自动变成 3 秒快扫）。
  ensureProcessWatcher();
  setBlacklistSweepInterval(blacklistSweepIntervalMs);
  // 名单刚变（比如刚从接单切成空闲）时立刻扫一次，已经在跑的游戏不用等下一个周期。
  void runBlacklistGuard();
}

/**
 * 这个进程现在有哪些 PID 在跑。
 * 黑名单里存的是进程名，但「去重」必须按实例（PID）来 —— 进程名从头到尾不变，
 * 只按进程名限流就会出现老板报的「一直弹」。
 */
function listRunningPids(image: string): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV'], (err, stdout) => {
      if (err) return resolve([]);
      const pids: number[] = [];
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m && m[1].toLowerCase() === image.toLowerCase()) pids.push(Number(m[2]));
      }
      resolve(pids);
    });
  });
}

/** 黑名单里存的是进程名，统一补成 xxx.exe 再比对。 */
function toImageName(name: string): string {
  const trimmed = (name || '').trim();
  return trimmed.toLowerCase().endsWith('.exe') ? trimmed : `${trimmed}.exe`;
}

/** 只有登录成功、且明确处于「空闲」时才动手；接单/娱乐/休息中一律不碰。 */
function guardArmed(): boolean {
  if (!store.get('token')) return false;
  // 状态未知（比如刚装好还没选过状态）时一律不动手，
  // 避免把正在玩游戏的人当成空闲直接踢下线。
  return store.get('lastStatus') === 'AVAILABLE';
}

/**
 * 黑名单进程被发现了（进程启动事件，或兜底扫描扫到）。
 *
 * 「启动一次杀一次、一次提示」都在这里：
 *   1) 先看这台机器上这个进程有哪些 PID，只处理「没见过的新实例」，处理过的直接跳过；
 *   2) 真要动手前先弹 5 秒倒计时（老板要的“倒计时提示”），到点再杀；
 *   3) 杀成功不再补弹第二个窗，所以一次启动就只有这一次提示。
 */
async function handleBlacklistedProcess(name: string): Promise<void> {
  // 事件和兜底扫描可能同时到：同一个进程名只让一个流程在跑。
  if (handlingNames.has(name)) return;
  const image = toImageName(name);
  const running = await listRunningPids(image);
  if (running.length === 0) return;
  const handled = handledPids.get(name) || new Set<number>();
  const fresh = running.filter((pid) => !handled.has(pid));
  if (fresh.length === 0) return; // 这批实例处理过了：不重复杀、不重复弹
  for (const pid of fresh) handled.add(pid);
  handledPids.set(name, handled);
  handlingNames.add(name);
  try {
    // 提示按进程名限流：启动器一秒拉起好几次时只弹第一条，但每一条都照杀。
    const notice = shouldNotice(name);
    if (notice) {
      logger.info('Blacklist countdown started', { processName: name, pids: Array.from(fresh) });
      popupNotice(
        '黑名单进程即将结束',
        `检测到「${name}」，${KILL_COUNTDOWN_SECONDS} 秒后自动结束。`,
        '🛡️',
        '倒计时走完会自动结束，无需手动操作',
        KILL_COUNTDOWN_SECONDS,
      );
      await new Promise((r) => setTimeout(r, KILL_COUNTDOWN_SECONDS * 1000));
    }
    // 倒计时这几秒里它可能自己退了：退过就不再动手，也不弹失败提示。
    if ((await listRunningPids(image)).length === 0) return;
    logger.warn('Killing blacklisted process', {
      processName: name,
      pids: Array.from(fresh),
      reason: 'process start detected',
    });
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/F', '/IM', image, '/T'], (err) => {
        if (err) logger.warn('Kill blacklisted process failed', { processName: name, error: err.message });
        reportAutoKill(name, !err, err?.message);
        // 成功时倒计时小窗已经把话说清楚了；只有失败才补一条，别弹两次。
        if (err) popupNotice('黑名单执行失败', `没能结束「${name}」（${err.message}）`, '⚠️');
        resolve();
      });
    });
  } finally {
    handlingNames.delete(name);
  }
}

/** 兜底扫描：只有登录成功且明确处于「空闲」时才动手（启动事件没抓到的靠它补）。 */
async function runBlacklistGuard(): Promise<void> {
  if (!guardArmed()) return;
  if (blacklistGuardRunning) return;
  blacklistGuardRunning = true;
  try {
    for (const name of activeBlacklist) {
      if (activeWhitelist.includes(name)) continue;
      await handleBlacklistedProcess(name);
    }
  } finally {
    blacklistGuardRunning = false;
  }
}

/** 换兜底扫描的频率（监听器起来/挂掉时都要换）。 */
function setBlacklistSweepInterval(ms: number): void {
  if (blacklistGuardTimer && blacklistSweepIntervalMs === ms) return;
  blacklistSweepIntervalMs = ms;
  if (blacklistGuardTimer) clearInterval(blacklistGuardTimer);
  blacklistGuardTimer = setInterval(() => {
    void runBlacklistGuard();
  }, ms);
}

/**
 * 进程启动监听：老板 2026-10-03「不要每 10 秒杀一次，检测到启动了再杀」。
 *
 * 以前每 10 秒 tasklist 全表扫一遍：游戏被启动器重新拉起来后最多能跑 10 秒
 * （人都进到登录界面了），而且这一轮杀完下一轮又扫到，提示也跟着刷。
 * 现在改成一个常驻 PowerShell 子进程订阅 WMI 的进程创建事件，事件一到就 taskkill：
 *   1) Win32_ProcessStartTrace —— 内核事件，谁启动的进程都能立刻看到（要管理员权限）；
 *   2) 拿不到就退到 __InstanceCreationEvent(WITHIN 1) —— 同样是 WMI 在 C++ 那边等，
 *      不用我们自己反复起进程；
 *   3) 两个都订阅不上（普通用户权限受限最常见）才退回 3 秒一次的 tasklist 快扫。
 */
const PROCESS_WATCH_SCRIPT = `
$ErrorActionPreference = 'Continue'
$mode = ''
try {
  Register-WmiEvent -Class Win32_ProcessStartTrace -SourceIdentifier chunlvProcStart -ErrorAction Stop | Out-Null
  $mode = 'TRACE'
} catch {
  Write-Output ('ERR trace-subscribe-failed: ' + $_.Exception.Message)
}
if (-not $mode) {
  try {
    $q = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process'"
    Register-WmiEvent -Query $q -SourceIdentifier chunlvProcStart -ErrorAction Stop | Out-Null
    $mode = 'POLL1S'
  } catch {
    Write-Output ('ERR poll-subscribe-failed: ' + $_.Exception.Message)
  }
}
if (-not $mode) { exit 3 }
Write-Output ('READY ' + $mode)
[Console]::Out.Flush()
while ($true) {
  $ev = $null
  try { $ev = Wait-Event -SourceIdentifier chunlvProcStart -Timeout 60 -ErrorAction Stop } catch {
    Write-Output ('ERR wait-failed: ' + $_.Exception.Message)
    exit 4
  }
  if ($null -eq $ev) { Write-Output 'PING'; [Console]::Out.Flush(); continue }
  foreach ($e in @($ev)) {
    $n = ''
    try { $n = $e.SourceEventArgs.NewEvent.ProcessName } catch {}
    if (-not $n) { try { $n = $e.SourceEventArgs.NewEvent.TargetInstance.Name } catch {} }
    if ($n) { Write-Output ('START ' + $n) }
    Remove-Event -EventIdentifier $e.EventIdentifier -ErrorAction SilentlyContinue
  }
  [Console]::Out.Flush()
}
`;

/** 监听器吐出来的一行：READY/START/PING/ERR。 */
function handleProcessWatcherLine(line: string): void {
  if (line.startsWith('READY ')) {
    processWatcherReady = true;
    processWatcherFailures = 0;
    setBlacklistSweepInterval(60_000);
    logger.info('Process-start watcher ready', { mode: line.slice(6).trim(), blacklist: activeBlacklist });
    return;
  }
  if (line.startsWith('START ')) {
    const name = line.slice(6).trim();
    if (!name || !guardArmed()) return;
    if (activeWhitelist.some((w) => w.toLowerCase() === name.toLowerCase())) return;
    const hit = activeBlacklist.find((b) => toImageName(b).toLowerCase() === name.toLowerCase());
    if (!hit) return;
    logger.info('Blacklisted process start detected', { processName: name });
    void handleBlacklistedProcess(hit);
    return;
  }
  if (line.startsWith('ERR ')) {
    logger.warn('Process-start watcher reported error', { line: line.slice(0, 300) });
    return;
  }
  if (line && line !== 'PING') logger.info('Process-start watcher line', { line: line.slice(0, 200) });
}

/** 关掉监听器（黑名单清空了、或者客户端要退出）。 */
function stopProcessWatcher(): void {
  if (processWatcherRestart) {
    clearTimeout(processWatcherRestart);
    processWatcherRestart = null;
  }
  const child = processWatcher;
  processWatcher = null;
  processWatcherReady = false;
  processWatcherOut = '';
  if (child) {
    try { child.kill(); } catch { /* ignore */ }
    logger.info('Process-start watcher stopped');
  }
}

/** 监听器挂了：退避重启；连着起不来就先退到 3 秒快扫，保证「还能杀」。 */
function scheduleProcessWatcherRestart(): void {
  if (processWatcherRestart) return;
  if (activeBlacklist.length === 0) return;
  processWatcherFailures += 1;
  // 连着 3 次起不来（多半是普通用户权限订阅不了 WMI）：别每 5 秒重试一次，
  // 先退到 3 秒快扫，监听器 10 分钟后再试一次。
  const degraded = processWatcherFailures >= 3;
  if (degraded) setBlacklistSweepInterval(3_000);
  const delay = degraded ? 10 * 60 * 1000 : Math.min(5_000 * processWatcherFailures, 60_000);
  logger.warn('Process-start watcher restart scheduled', { delayMs: delay, failures: processWatcherFailures });
  processWatcherRestart = setTimeout(() => {
    processWatcherRestart = null;
    ensureProcessWatcher();
  }, delay);
}

/** 起监听器（已经在跑就什么都不做）。 */
function ensureProcessWatcher(): void {
  if (activeBlacklist.length === 0) {
    stopProcessWatcher();
    return;
  }
  if (processWatcher || processWatcherRestart) return;
  let child: ReturnType<typeof spawn>;
  try {
    // 以前这里用 -EncodedCommand（base64）传脚本，结果在装了安全软件（360 等）的机器上
    // 会被直接拦掉：powershell 立刻退出、退出码 0xFFFFFFFF、一个字都不输出
    // —— 老板 2026-10-03 报「王甲振那台一直不按新逻辑走」就是它（详见 CHANGELOG）。
    // 改成把脚本落地成 .ps1 再用 -File 跑，同一份脚本在所有机器上都能起来。
    const scriptPath = path.join(app.getPath('userData'), 'process-watch.ps1');
    try {
      // 加 BOM：PowerShell 5.1 没 BOM 时会按 GBK 读，脚本里的中文/特殊字符会乱掉。
      fs.writeFileSync(scriptPath, `\uFEFF${PROCESS_WATCH_SCRIPT}`, 'utf8');
    } catch (werr: any) {
      logger.warn('Failed to write process watcher script', { error: werr?.message || werr });
    }
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err: any) {
    logger.warn('Failed to start process-start watcher', { error: err?.message || err });
    scheduleProcessWatcherRestart();
    return;
  }
  processWatcher = child;
  processWatcherReady = false;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    processWatcherOut += chunk;
    let idx = processWatcherOut.indexOf('\n');
    while (idx >= 0) {
      const raw = processWatcherOut.slice(0, idx);
      processWatcherOut = processWatcherOut.slice(idx + 1);
      const line = raw.replace(/\r$/, '').trim();
      if (line) handleProcessWatcherLine(line);
      idx = processWatcherOut.indexOf('\n');
    }
    // 万一脚本一直不换行，别让缓冲无限涨。
    if (processWatcherOut.length > 8192) processWatcherOut = '';
  });
  child.stderr?.on('data', (chunk: any) => {
    const text = String(chunk || '').trim();
    if (text) logger.warn('Process-start watcher stderr', { text: text.slice(0, 300) });
  });
  child.on('error', (err) => {
    logger.warn('Process-start watcher error', { error: err?.message });
  });
  child.on('exit', (code) => {
    processWatcher = null;
    processWatcherReady = false;
    logger.warn('Process-start watcher exited', { code, blacklistCount: activeBlacklist.length });
    scheduleProcessWatcherRestart();
  });
  logger.info('Process-start watcher starting', { blacklist: activeBlacklist });
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

// WebSocket 被服务端拒绝（accessToken 15 分钟过期最典型）时：换新令牌再连。
// 之前主进程只会傻重连，拿着过期令牌连一天都连不上，弹窗也就一整天收不到。
let wsReloginAt = 0;
async function refreshWsTokenAndReconnect(): Promise<void> {
  const now = Date.now();
  // 换令牌要打接口，失败时不要死循环狂刷
  if (now - wsReloginAt < 30_000) return;
  wsReloginAt = now;
  const next = await refreshAccessToken();
  if (!next) return;
  logger.warn('WS reconnecting with refreshed token');
  connectWebSocket(getServerUrl(), next, (store.get('companionId') || '') as string, refreshWsTokenAndReconnect);
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

function broadcastPopupHtml(payload: {
  title?: string;
  body?: string;
  icon?: string;
  seconds?: number;
  orderId?: string;
  hint?: string;
  action?: string;
  actionPayload?: any;
}): string {
  const title = escapeHtml(payload?.title || '群聊广播');
  const body = escapeHtml(payload?.body || '');
  const icon = escapeHtml(payload?.icon || '📢');
  const seconds = Number(payload?.seconds) > 0 ? Number(payload.seconds) : 5;
  const orderId = String(payload?.orderId || '');
  const action = String(payload?.action || '');
  const hint = escapeHtml(payload?.hint || '');
  // 可点 = 带订单号（点了跳抢单池）或带动作（打开搭档邀请 / 转让 / 会话等）。
  // 老板 2026-10-03：所有提醒统一成这张能点的横幅，不再用「点了没反应」的系统通知。
  const clickable = (orderId.length > 0 && hint.length > 0) || action.length > 0;
  const bodyMax = hint ? 40 : 66;
  const clickCss = clickable ? '.card{cursor:pointer}' : '';
  const hintHtml = hint ? `<div class="hint">${hint}</div>` : '';
  const jsLiteral = (v: unknown) => JSON.stringify(v ?? null).split('<').join('\\u003c');
  const clickCall = action
    ? `api.bannerAction(${jsLiteral(action)}, ${jsLiteral(payload?.actionPayload)});`
    : `api.orderBannerClick(${JSON.stringify(orderId)});`;
  const script = clickable
    ? `<script>
(function(){
  var api = window.electronAPI; if (!api || !api.orderBannerHover) return;
  var over = false;
  document.addEventListener('mousemove', function(e){
    var t = e.target;
    var hit = !!(t && t.closest && t.closest('.card'));
    if (hit !== over) { over = hit; try { api.orderBannerHover(hit); } catch(_){} }
  });
  document.addEventListener('click', function(){
    try { ${clickCall} } catch(_){}
  });
})();
</script>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;font-family:"Microsoft YaHei",sans-serif;overflow:hidden}
.card{position:relative;display:flex;gap:12px;align-items:flex-start;height:calc(100vh - 8px);margin:4px;padding:14px 16px 16px;background:linear-gradient(135deg,#1E293B,#0F172A);border:1px solid #FF4757;border-left:5px solid #FF4757;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);color:#F8FAFC;overflow:hidden}
.icon{font-size:22px;line-height:1.2}
.t{font-size:14px;font-weight:700;color:#fff}
.b{margin-top:6px;font-size:13px;line-height:1.6;color:#E2E8F0;word-break:break-word;max-height:${bodyMax}px;overflow:hidden}
.hint{margin-top:8px;font-size:12px;font-weight:600;color:#FFD166}
.bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:#FF4757;transform-origin:left;animation:drain ${seconds}s linear forwards}
${clickCss}
@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
</style></head><body>
<div class="card"><div class="icon">${icon}</div><div style="min-width:0;flex:1"><div class="t">${title}</div><div class="b">${body}</div>${hintHtml}</div><div class="bar"></div></div>
${script}
</body></html>`;
}

const broadcastWindows: BrowserWindow[] = [];

/**
 * 弹出广播提示：置顶、不抢焦点、鼠标穿透，默认 5 秒后自己关闭。
 * 陪玩在打游戏或最小化了客户端时，也能在屏幕右下角看到。
 * 新单提醒会带上自己的停留时长（服务端 _popupSeconds，默认 20 秒），比群聊广播停久一点。
 */
function showBroadcastPopup(payload: {
  title?: string;
  body?: string;
  seconds?: number;
  icon?: string;
  orderId?: string;
  hint?: string;
  action?: string;
  actionPayload?: any;
}): void {
  const W = 480;
  const H = 150;
  const GAP = 10;
  const MARGIN = 20;
  const seconds = Number(payload?.seconds) > 0 ? Number(payload.seconds) : 5;
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
    // 挂上 preload：横幅里那小块要能把「鼠标在卡片上/点了一下」告诉主进程。
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload-dist/preload.js'),
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 默认鼠标穿透：不挡住陪玩点游戏/点微信；
  // 只有鼠标移到卡片上时，横幅里那段脚本会叫我们把穿透关掉（见 order-banner:hover）。
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
  }, seconds * 1000);
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
      connectWebSocket(getServerUrl(), getWsToken(), (store.get('companionId') || '') as string, refreshWsTokenAndReconnect);
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
  // 新单横幅：鼠标在卡片上才「可点」（其余时候穿透，不挡玩游戏）。
  ipcMain.on('order-banner:hover', (event, over: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      try {
        win.setIgnoreMouseEvents(!over, { forward: true });
      } catch { /* 窗口正在关掉 */ }
    }
  });
  // 点横幅 = 把客户端拉到最前 + 跳到抢单池并把这一单标出来（老板 2026-10-01：「跳转进池子再抢」）。
  ipcMain.on('order-banner:click', (_event, orderId: string) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('order-pool-focus', { orderId: String(orderId || '') });
      }
    } catch (err: any) {
      logger.warn('Order banner click failed', { error: err?.message || err });
    }
  });
  // 点横幅上的「动作」：把客户端拉到最前，再让界面去打开对应的东西
  // （搭档邀请 / 订单转让 / 接单记录 / 会话……）。老板 2026-10-03：
  // 王甲振点 Windows 弹窗没跳转 —— 那些提醒原来走系统通知，点了本来就不跳，
  // 现在统一改成这张横幅 + 这个动作回执。
  ipcMain.on('banner:action', (_event, action: string, payload: unknown) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('banner-action', {
          action: String(action || ''),
          payload: payload ?? null,
        });
      }
    } catch (err: any) {
      logger.warn('Banner action failed', { error: err?.message || err });
    }
  });
  ipcMain.handle('broadcast:popup', (event, payload: Record<string, unknown>) => {
    if (!isTrustedSender(event)) return { ok: false, reason: 'untrusted-origin' };
    try {
      const p = payload as any;
      showBroadcastPopup({
        title: p?.title,
        body: p?.body,
        icon: p?.icon,
        seconds: p?.seconds,
        hint: p?.hint,
        orderId: p?.orderId,
        action: p?.action,
        actionPayload: p?.actionPayload,
      });
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
const machineAgent = createMachineAgent({
  app,
  clientType: 'COMPANION',
  getServerUrl,
  getLoginUser: () => {
    const username = (store.get('currentUsername') as string) || '';
    return username ? { username, role: 'COMPANION' } : null;
  },
  log: (msg: string) => logger.info(`[machine-agent] ${msg}`),
});

app.whenReady().then(() => {
  // Windows 通知需要 AppUserModelID，否则右下角系统通知弹不出来（搭档邀请、订单提醒等）。
  app.setAppUserModelId('com.chunlv.companion');
  ensureDesktopShortcut();
  writeHealthMarker();
  setInterval(writeHealthMarker, 60 * 1000);
  ensureHibernateEnabled();
  setupApplicationMenu();
  app.setLoginItemSettings({ openAtLogin: true });
  cleanupStaleCaptures();
  setupIPC();

  // 每 5 分钟上报机器信息 + 每 60 秒领一次远程任务（一键诊断 / 指令 / 开通远程管理）
  machineAgent.start();

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
    if (!isQuitting && companionTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  // 只在「登录页自己加载失败」时重试。以前是窗口里任何一次加载失败都会把整个
  // 窗口强行 loadURL 回登录页，陪玩/客服正用着会突然掉到登录界面。
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    logger.warn('Page failed to load', { code, desc, failedUrl });
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
    logger.info('System resumed, reloading renderer');
    if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
      mainWindow.reload();
    }
  });

  companionTray = createTray({
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

  // Auto-relaunch when any child process (renderer/GPU) is killed
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.warn('Renderer process gone, relaunching', { reason: details.reason });
    app.relaunch();
    app.exit(0);
  });
  app.on('child-process-gone', (_e, details) => {
    logger.warn('Child process gone, relaunching', { type: details.type, reason: details.reason });
    app.relaunch();
    app.exit(0);
  });

  onWsEvent('pc:command', (data: any) => {
    if (data.command === 'update') handleUpdateCommand(data.downloadUrl, data.version);
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
  // 新单弹窗（老板 2026-09-22 报「发广播单所有人都没弹窗提示」）：
  // 主进程这条 WebSocket 以前收到 order:urgent 直接丢掉，而界面里那张右下角卡片
  // 在窗口被游戏挡住 / 缩到托盘时根本看不见，一单就这样错过了。
  // 现在：窗口就在眼前只闪任务栏（不打扰玩游戏的）；窗口不在前面，就自己画一个置顶小窗。
  onWsEvent('order:urgent', (data: any) => {
    if (currentRole !== 'COMPANION') return;
    try {
      // 老板 2026-10-01：新单统一只弹 Windows 横幅（窗口在前面也照弹，
      // 软件里那张右下角卡片不再弹）；顺手闪一下任务栏也不误事。
      const facing =
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
      if (facing) mainWindow!.flashFrame(true);
      const title = data?._direct
        ? '🎯 客服指定给你接单'
        : data?._bridged
          ? `🌉 桥接工作室发单！${data?._createdBy || '系统'} 发布`
          : `⚡ 新订单！${data?._createdBy || '系统'} 发布`;
      const body = `${data?.gameName || '新订单'} · ¥${Number(data?.amount || 0).toFixed(0)} · ${
        data?.duration || 1
      }h · 去订单管理抢单`;
      showBroadcastPopup({
        title,
        body,
        icon: '⚡',
        seconds: Number(data?._popupSeconds) > 0 ? Number(data._popupSeconds) : 15,
        // 带上订单号 + 提示：横幅就可点，点了跳到抢单池并标出这一单（再点一下「抢单」）。
        orderId: data?.id || data?.orderId,
        hint: '点这里 → 去抢单池看这单（再点一下「抢单」）',
      });
    } catch (err: any) {
      logger.warn('Urgent order popup failed', { error: err?.message || err });
    }
  });
  const token = getWsToken();
  if (token) connectWebSocket(getServerUrl(), token, (store.get('companionId') || '') as string, refreshWsTokenAndReconnect);

  // 掉线自愈：服务器重启后，socket.io 偶尔会卡在 connect_error（进程没死、看门狗不拉起）。
  // 这里每 90 秒检查一次，若已登录却仍未连上，就强制重建一次 WebSocket，避免一直掉线。
  setInterval(() => {
    try {
      if (store.get('token') && !isConnected()) {
        logger.warn('WS reconnect watchdog: forcing reconnect');
        connectWebSocket(getServerUrl(), getWsToken(), (store.get('companionId') || '') as string, refreshWsTokenAndReconnect);
      }
    } catch {}
  }, 90 * 1000);

  maybeCheckUpdates();
  // 前端版本热更检查：启动先记录一次，之后每 5 分钟查一次。
  // 以前是 60 秒一次：一个纯版本号查询，20 个客户端一天能打出近 3 万次请求，
  // 电脑也白跑一天。改 5 分钟后，仍然满足「发布后 5 分钟内自动更新」这条承诺。
  void checkFrontendVersion();
  setInterval(() => {
    void checkFrontendVersion();
  }, 5 * 60 * 1000);
  // 登录或未登录都每 15 分钟检查一次更新（原来是 5 分钟，一天 288 次没有必要；
  // 紧急更新仍然可以用后台「推送更新」立即下发）。
  // 15 分钟是为了「开机没赶上、之后也要能补上」：更新名额全网只有一个（约 3 分钟一台），
  // 机器多的时候一轮铺完要个把小时，间隔太长会让排在后面的机器等太久。
  setInterval(() => {
    maybeCheckUpdates();
  }, 15 * 60 * 1000);
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
