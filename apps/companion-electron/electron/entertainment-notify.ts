import { BrowserWindow, screen } from 'electron';
import { logger } from './logger';

let warningWindow: BrowserWindow | null = null;

export function showEntertainmentWarning(data: {
  message: string;
  elapsedMinutes: number;
  fee: number;
  availableFunds: number;
  remainingMinutes: number;
  autoSwitchIn: number;
}): void {
  closeWarning();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 400, winH = 250;

  warningWindow = new BrowserWindow({
    width: winW, height: winH,
    x: screenWidth - winW - 20, y: screenHeight - winH - 20,
    frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: "Microsoft YaHei", sans-serif; background: #0F172A; color: #E2E8F0;
           border: 1px solid #FAAD14; border-radius: 12px; overflow: hidden;
           user-select: none; -webkit-app-region: drag; height: 100vh;
           display: flex; flex-direction: column; }
    .header { padding: 20px 20px 12px; text-align: center; }
    .title { font-size: 16px; font-weight: 700; color: #FAAD14; }
    .body { padding: 0 20px; flex: 1; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .label { color: #94A3B8; }
    .value { color: #E2E8F0; font-weight: 600; }
    .warn { color: #FF4757; }
    .actions { display: flex; gap: 12px; padding: 16px 20px 20px; -webkit-app-region: no-drag; }
    .btn { flex:1; padding: 10px 0; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; }
    .btn-ok { background: linear-gradient(135deg, #FAAD14, #FF9100); color: #0F172A; }
  </style></head><body>
    <div class="header"><div class="title">⚠️ 余额不足提醒</div></div>
    <div class="body">
      <div class="row"><span class="label">已娱乐</span><span class="value">${data.elapsedMinutes} 分钟</span></div>
      <div class="row"><span class="label">费用</span><span class="value">¥${data.fee}</span></div>
      <div class="row"><span class="label">可用余额</span><span class="value">¥${data.availableFunds}</span></div>
      <div class="row"><span class="label">剩余可玩</span><span class="warn value">${data.remainingMinutes} 分钟</span></div>
      <div class="row"><span class="label">30分钟后</span><span class="warn value">自动切换到空闲</span></div>
    </div>
    <div class="actions"><button class="btn btn-ok" onclick="window.close()">知道了</button></div>
  </body></html>`;

  warningWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  warningWindow.on('closed', () => { warningWindow = null; });
  setTimeout(() => closeWarning(), 30000);
}

export function showEntertainmentForceIdle(data: { message: string }): void {
  closeWarning();
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 400, winH = 220;

  warningWindow = new BrowserWindow({
    width: winW, height: winH,
    x: screenWidth - winW - 20, y: screenHeight - winH - 20,
    frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: "Microsoft YaHei", sans-serif; background: #0F172A; color: #E2E8F0;
           border: 1px solid #FF4757; border-radius: 12px; overflow: hidden;
           user-select: none; -webkit-app-region: drag; height: 100vh;
           display: flex; flex-direction: column; }
    .header { padding: 20px 20px 12px; text-align: center; }
    .title { font-size: 16px; font-weight: 700; color: #FF4757; }
    .msg { padding: 0 20px 16px; text-align: center; font-size: 13px; color: #94A3B8; line-height: 1.8; }
    .actions { display: flex; gap: 12px; padding: 16px 20px 20px; -webkit-app-region: no-drag; }
    .btn { flex:1; padding: 10px 0; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; }
    .btn-ok { background: linear-gradient(135deg, #FF4757, #FF6B81); color: #fff; }
  </style></head><body>
    <div class="header"><div class="title">🔴 余额不足，已自动切换到空闲</div></div>
    <div class="msg">${data.message}</div>
    <div class="actions"><button class="btn btn-ok" onclick="window.close()">知道了</button></div>
  </body></html>`;

  warningWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  warningWindow.on('closed', () => { warningWindow = null; });
  setTimeout(() => closeWarning(), 15000);
}

function closeWarning(): void {
  if (warningWindow) {
    try { warningWindow.close(); } catch { /* ignore */ }
    warningWindow = null;
  }
}
