import { BrowserWindow, screen, ipcMain } from 'electron';
import { exec } from 'child_process';
import { logger } from './logger';

interface RemoteCommand {
  command: string;       // shutdown | restart | throttle | unthrottle
  params?: any;          // { limitKB } for throttle
}

let execWindow: BrowserWindow | null = null;
let execAction: 'exec' | 'cancel' | null = null;

const commandLabels: Record<string, string> = {
  shutdown: '关机',
  restart: '重启',
  throttle: '限速',
  unthrottle: '解除限速',
};

export function handleRemoteCommand(cmd: RemoteCommand, onDone: (success: boolean) => void): void {
  const label = commandLabels[cmd.command] || cmd.command;
  const seconds = 10; // 10秒倒计时，给用户更多时间准备

  logger.info('Remote command received, showing notification', { command: cmd.command });
  showNotification(label, seconds, () => {
    executeCommand(cmd, onDone);
  });
}

function showNotification(label: string, seconds: number, onExecute: () => void): void {
  if (execWindow) { try { execWindow.close(); } catch {} }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 360;
  const winH = 200;

  execWindow = new BrowserWindow({
    width: winW, height: winH,
    x: screenWidth - winW - 20, y: screenHeight - winH - 20,
    frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: "Microsoft YaHei", sans-serif; background: #0F172A; color: #E2E8F0;
           border: 1px solid #FF9100; border-radius: 12px; overflow: hidden;
           user-select: none; -webkit-app-region: drag; height: 100vh;
           display: flex; flex-direction: column; }
    .header { padding: 20px 20px 12px; text-align: center; }
    .title { font-size: 16px; font-weight: 700; color: #FF9100; }
    .subtitle { font-size: 13px; color: #94A3B8; margin-top: 6px; }
    .body { padding: 0 20px; flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .timer { text-align: center; font-size: 28px; font-weight: 700; color: #FF9100; font-family: monospace; }
    .actions { display: flex; gap: 12px; padding: 16px 20px 20px; -webkit-app-region: no-drag; }
    .btn { flex:1; padding: 10px 0; border-radius: 8px; border: none; cursor: pointer;
           font-size: 14px; font-weight: 600; transition: all 0.2s; }
    .btn-exec { background: linear-gradient(135deg, #FF9100, #FF6B00); color: #fff; }
    .btn-exec:hover { transform: scale(1.02); }
    .btn-cancel { background: rgba(148,163,184,0.15); color: #94A3B8; }
    .btn-cancel:hover { background: rgba(148,163,184,0.25); }
  </style></head><body>
    <div class="header">
      <div class="title">⚙️ 远程控制指令</div>
      <div class="subtitle">管理员下发「${label}」指令，将在 <span id="sec">${seconds}</span> 秒后执行</div>
    </div>
    <div class="body">
      <div class="timer" id="timer">${seconds}</div>
    </div>
    <div class="actions">
      <button class="btn btn-cancel" id="cancelBtn">取消</button>
      <button class="btn btn-exec" id="execBtn">立即执行</button>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      let sec = ${seconds};
      const update = () => { document.getElementById('timer').textContent = sec; document.getElementById('sec').textContent = sec; };
      const countdown = setInterval(() => {
        sec--;
        update();
        if (sec <= 0) { clearInterval(countdown); ipcRenderer.send('rcmd-exec'); window.close(); }
      }, 1000);
      document.getElementById('execBtn').addEventListener('click', () => { clearInterval(countdown); ipcRenderer.send('rcmd-exec'); window.close(); });
      document.getElementById('cancelBtn').addEventListener('click', () => { clearInterval(countdown); ipcRenderer.send('rcmd-cancel'); window.close(); });
    </script>
  </body></html>`;

  execWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // IPC listeners: receive decision BEFORE window closes
  const onExec = () => { execAction = 'exec'; };
  const onCancel = () => { execAction = 'cancel'; };
  ipcMain.on('rcmd-exec', onExec);
  ipcMain.on('rcmd-cancel', onCancel);

  execWindow.on('closed', () => {
    ipcMain.removeListener('rcmd-exec', onExec);
    ipcMain.removeListener('rcmd-cancel', onCancel);
    if (execAction === 'cancel') {
      logger.info('Remote command cancelled by user', { label });
    } else {
      logger.info('Remote command executing', { label, action: execAction || 'default' });
      onExecute();
    }
    execWindow = null;
  });
}

function executeCommand(cmd: RemoteCommand, onDone: (success: boolean) => void): void {
  const { command, params } = cmd;
  let shellCmd = '';

  switch (command) {
    case 'shutdown':
      shellCmd = 'shutdown /s /t 0';
      break;
    case 'restart':
      shellCmd = 'shutdown /r /t 0';
      break;
    case 'throttle': {
      const limitKB = params?.limitKB || 500;
      shellCmd = `powershell -NoProfile -Command "New-NetQosPolicy -Name 'ChunlvThrottle' -ThrottleRateActionBitsPerSecond ${limitKB * 1024 * 8}"`;
      break;
    }
    case 'unthrottle':
      shellCmd = `powershell -NoProfile -Command "Remove-NetQosPolicy -Name 'ChunlvThrottle' -ErrorAction SilentlyContinue"`;
      break;
    default:
      logger.warn('Unknown remote command', { command });
      onDone(false);
      return;
  }

  logger.info('Executing remote command', { command, shell: shellCmd.slice(0, 100) });
  exec(shellCmd, { timeout: 15000 }, (error, stdout, stderr) => {
    const success = !error;
    logger.info(success ? 'Remote command executed' : 'Remote command failed', { command, error: stderr || error?.message });
    onDone(success);
  });
}
