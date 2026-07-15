import { BrowserWindow, app, globalShortcut, screen } from 'electron';
import { store } from './store';
import { logger } from './logger';
import { emitStatus } from './websocket';

let lockWindow: BrowserWindow | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT = 3 * 60 * 1000; // 3 minutes before re-lock

function getAppPassword(): string {
  return (store.get('appPassword') as string) || '123456';
}

export function setAppPassword(password: string): void {
  store.set('appPassword', password);
}

export function getAppPasswordForUI(): string {
  return getAppPassword();
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
      preload: (require('path') as any).join(__dirname, 'preload.js'),
    },
  });

  const pass = getAppPassword();
  lockWindow.loadURL(`data:text/html,${encodeURIComponent(`
    <html><head><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { background:#000; display:flex; align-items:center; justify-content:center; height:100vh; font-family:Arial; }
      .box { text-align:center; }
      .icon { font-size:60px; margin-bottom:20px; }
      .title { color:#fff; font-size:18px; margin-bottom:10px; }
      .hint { color:#888; font-size:12px; margin-bottom:20px; }
      input { padding:10px 20px; font-size:16px; border:2px solid #00D4FF; border-radius:8px; background:#111; color:#fff; text-align:center; outline:none; width:200px; }
      input:focus { border-color:#52c41a; }
      .error { color:#FF4757; font-size:12px; margin-top:10px; display:none; }
    </style></head><body>
    <div class="box">
      <div class="icon">🔒</div>
      <div class="title">休息中 · 屏幕已锁定</div>
      <div class="hint">输入 App 密码解锁并回到空闲状态</div>
      <input type="password" id="pw" autofocus placeholder="输入密码">
      <div class="error" id="err">密码错误</div>
    </div>
    <script>
      const pass = ${JSON.stringify(pass)};
      let attempts = 0;
      document.getElementById('pw').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.target.value === pass) {
            window.electronAPI?.storeSet?.('screenLocked', 'false');
            window.close();
          } else {
            attempts++;
            document.getElementById('err').style.display = 'block';
            e.target.value = '';
            if (attempts >= 5) {
              document.getElementById('err').textContent = '尝试次数过多，请等待...';
              e.target.disabled = true;
              setTimeout(() => { e.target.disabled = false; attempts = 0; document.getElementById('err').style.display = 'none'; }, 30000);
            }
          }
        }
      });
      // Prevent closing via shortcut keys
      document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'F4') e.preventDefault();
        if (e.ctrlKey && e.key === 'w') e.preventDefault();
      });
    </script></body></html>
  `)}`);

  lockWindow.setAlwaysOnTop(true, 'screen-saver');
  lockWindow.setVisibleOnAllWorkspaces(true);
  lockWindow.setFullScreenable(false);

  lockWindow.on('closed', () => {
    lockWindow = null;
    // Unlocked — set status to AVAILABLE
    store.set('screenLocked', 'false');
    try { emitStatus('AVAILABLE'); } catch {}
    logger.info('Screen unlocked, status set to AVAILABLE');
    startIdleTimer();
  });

  // Prevent closing
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
