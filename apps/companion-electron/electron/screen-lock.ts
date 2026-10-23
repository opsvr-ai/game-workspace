import { BrowserWindow, app, screen } from 'electron';
import { createHash } from 'crypto';
import { store } from './store';
import { logger } from './logger';
import { emitStatus } from './websocket';
import { execFile } from 'child_process';

let lockWindow: BrowserWindow | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT = 3 * 60 * 1000;

/** 应用密码（锁屏 / 退出登录校验用），统一由服务端下发 SHA-256，未设置时默认 123456 */
export function hashAppPassword(password: string): string {
  return createHash('sha256').update(String(password || '')).digest('hex');
}

export function getAppPasswordHash(): string {
  return (store.get('appPasswordHash') as string) || hashAppPassword('123456');
}

export function verifyAppPassword(password: string): boolean {
  return hashAppPassword(password) === getAppPasswordHash();
}

export function setAppPasswordHash(hash: string): void {
  store.set('appPasswordHash', hash);
}

/** 兼容老 IPC：本地改密码时只存哈希，不再存明文。 */
export function setAppPassword(password: string): void {
  setAppPasswordHash(hashAppPassword(password));
}

function buildLockHTML(): string {
  // Use base64 to avoid encoding issues with Chinese characters
  return Buffer.from(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;display:flex;align-items:center;justify-content:center;height:100vh;font-family:"Microsoft YaHei","微软雅黑",Arial,sans-serif}
.box{text-align:center}
.icon{font-size:60px;margin-bottom:20px}
.title{color:#fff;font-size:18px;margin-bottom:10px}
.hint{color:#888;font-size:12px;margin-bottom:20px}
input{padding:10px 20px;font-size:16px;border:2px solid #00D4FF;border-radius:8px;background:#111;color:#fff;text-align:center;outline:none;width:200px}
input:focus{border-color:#52c41a}
.error{color:#FF4757;font-size:12px;margin-top:10px;display:none}
</style></head><body>
<div class="box">
<div class="icon">🔒</div>
<div class="title">休息中 · 屏幕已锁定</div>
<div class="hint">输入 App 密码解锁并回到空闲状态</div>
<input type="password" id="pw" autofocus placeholder="输入密码">
<div class="error" id="err">密码错误</div>
</div>
<script>
var attempts=0;
document.getElementById('pw').addEventListener('keydown',function(e){
if(e.key==='Enter'){
var value=e.target.value;
window.electronAPI&&window.electronAPI.unlockScreen&&window.electronAPI.unlockScreen(value).then(function(ok){
if(ok){window.close();}
else{
attempts++;
document.getElementById('err').style.display='block';
e.target.value='';
if(attempts>=5){
document.getElementById('err').textContent='尝试次数过多，请等待...';
e.target.disabled=true;
setTimeout(function(){e.target.disabled=false;attempts=0;document.getElementById('err').style.display='none'},30000);
}
}
});
}
});
document.addEventListener('keydown',function(e){
if(e.altKey&&e.key==='F4')e.preventDefault();
if(e.ctrlKey&&e.key==='w')e.preventDefault();
});
</script></body></html>`, 'utf-8').toString('base64');
}

export function showScreenLock(): void {
  if (lockWindow) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  lockWindow = new BrowserWindow({
    x: 0, y: 0,
    width, height,
    fullscreen: true,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: (require('path') as any).join(__dirname, '../preload-dist/preload.js'),
    },
  });

  lockWindow.loadURL(`data:text/html;charset=utf-8;base64,${buildLockHTML()}`);

  lockWindow.setAlwaysOnTop(true, 'screen-saver');
  lockWindow.setVisibleOnAllWorkspaces(true);
  lockWindow.setFullScreenable(false);

  lockWindow.on('closed', () => {
    lockWindow = null;
    store.set('screenLocked', 'false');
    store.set('lastStatus', 'AVAILABLE');
    try { emitStatus('AVAILABLE'); } catch {}
    logger.info('Screen unlocked, status set to AVAILABLE');
    startIdleTimer();
  });

  lockWindow.on('close', (e) => {
    const isLocked = store.get('screenLocked');
    if (isLocked !== 'unlocked') e.preventDefault();
  });

  store.set('screenLocked', 'true');
  logger.info('Screen lock shown');
}

function startIdleTimer(): void {
  stopIdleTimer();
  idleTimer = setTimeout(() => {
    const status = store.get('lastStatus');
    if (status === 'RESTING') showScreenLock();
  }, IDLE_TIMEOUT);
}

function stopIdleTimer(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

export function hideScreenLock(): void {
  if (lockWindow) {
    store.set('screenLocked', 'unlocked');
    lockWindow.close();
  }
}

/**
 * 「休息」改为休眠：点休息后直接让整机进入休眠。
 * 失败时不再锁屏，也不再弹窗；只记录日志。
 */
export function hibernatePc(): void {
  enableHibernate(() => {
    execFile('shutdown.exe', ['/h'], { windowsHide: true }, (err) => {
      if (err) {
        logger.warn('Hibernate failed; keep running without screen lock', { error: err?.message || String(err) });
      } else {
        logger.info('Hibernate command issued');
      }
    });
  });
}

function enableHibernate(done: () => void): void {
  // 有些机器关机菜单里有「休眠」但 hibernate 是关的，先打开再发命令。
  execFile('powercfg.exe', ['/hibernate', 'on'], { windowsHide: true }, (err) => {
    if (err) logger.warn('Enable hibernate failed', { error: err?.message || String(err) });
    done();
  });
}

/**
 * 自动休息改成「睡眠」：内存继续供电，游戏和登录状态都在，鼠标/键盘一动就醒。
 * 不再锁屏；睡眠失败时退到休眠，休眠也失败就保持运行并记录日志。
 */
export function sleepPc(): void {
  enableHibernate(() => {
    execFile(
      'rundll32.exe',
      ['powrprof.dll,SetSuspendState', '0,1,0'],
      { windowsHide: true },
      (err) => {
        if (!err) {
          logger.info('Sleep command issued');
          return;
        }
        logger.warn('Sleep failed; trying hibernate fallback', { error: err?.message || String(err) });
        execFile('shutdown.exe', ['/h'], { windowsHide: true }, (err2) => {
          if (err2) logger.warn('Hibernate fallback failed; keep running', { error: err2?.message || String(err2) });
          else logger.info('Hibernate fallback issued');
        });
      },
    );
  });
}

/**
 * 开机时尽量把系统休眠打开。普通权限的客户端执行会失败，这里只记录不打扰；
 * 如果客户端以管理员权限运行，则能直接成功，保证「休息=休眠」可用。
 */
export function ensureHibernateEnabled(): void {
  execFile(
    'powercfg.exe',
    ['/hibernate', 'on'],
    { windowsHide: true },
    (err) => {
      if (err) {
        logger.debug('Ensure hibernate enabled failed (non-admin is expected)', { error: err?.message || String(err) });
      } else {
        logger.info('Hibernate enabled');
      }
    },
  );
}

export function handleStatusChanged(status: string): void {
  store.set('lastStatus', status);
  if (status === 'RESTING') {
    // 手动点休息也改睡眠：保留游戏/登录状态，唤醒即可继续。
    stopIdleTimer();
    sleepPc();
  } else {
    stopIdleTimer();
    hideScreenLock();
  }
}

/** 1 小时无操作自动休息：只睡眠，不 hibernation；手动点休息仍是上面的休眠。 */
export function handleIdleRestSleep(): void {
  store.set('lastStatus', 'RESTING');
  stopIdleTimer();
  sleepPc();
}
