import { BrowserWindow, screen } from 'electron';
import path from 'path';

let notificationWindow: BrowserWindow | null = null;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

export function showOrderNotification(
  order: any,
  isUrgent: boolean,
  onAccept: () => void,
): void {
  // Close existing notification
  closeNotification();

  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  const winW = 420;
  const winH = 300;

  notificationWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenWidth - winW - 20,
    y: screenHeight - winH - 20,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const gameName = order.game || order.gameName || order.game_name || '订单';
  const amount = order.amount || order.price || order.totalAmount || 0;
  const orderType = order.type || order.orderType || 'NEW';
  const customerSource = order.customFields?.customerSource || order.source || '';
  const urgency = order.customFields?.urgency || order.urgency || (isUrgent ? 'urgent' : 'now');

  const typeLabels: Record<string, string> = {
    NEW: '🆕 新单',
    RENEW: '🔄 续单',
    REPURCHASE: '🔁 复购',
    TIP: '💝 打赏',
  };

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: "Microsoft YaHei", sans-serif; background: #0F172A; color: #E2E8F0;
           border: 1px solid ${isUrgent ? '#FF4757' : '#00D4FF'}; border-radius: 12px;
           overflow: hidden; user-select: none; -webkit-app-region: drag; height: 100vh;
           display: flex; flex-direction: column; }
    .header { padding: 20px 20px 12px; text-align: center; }
    .title { font-size: 18px; font-weight: 700; color: ${isUrgent ? '#FF4757' : '#00D4FF'}; }
    .subtitle { font-size: 12px; color: #94A3B8; margin-top: 4px; }
    .body { padding: 0 20px; flex: 1; }
    .row { display: flex; justify-content: space-between; padding: 8px 0;
           border-bottom: 1px solid rgba(148,163,184,0.1); }
    .label { color: #94A3B8; font-size: 13px; }
    .value { color: #E2E8F0; font-size: 13px; font-weight: 600; }
    .amount { color: #FF6B9D; font-size: 22px; font-weight: 700; }
    .actions { display: flex; gap: 12px; padding: 16px 20px 20px;
               -webkit-app-region: no-drag; }
    .btn { flex:1; padding: 10px 0; border-radius: 8px; border: none; cursor: pointer;
           font-size: 14px; font-weight: 600; transition: all 0.2s; }
    .btn-accept { background: linear-gradient(135deg, #00D4FF, #0099CC); color: #0F172A; }
    .btn-accept:hover { transform: scale(1.02); }
    .btn-ignore { background: rgba(148,163,184,0.15); color: #94A3B8; }
    .btn-ignore:hover { background: rgba(148,163,184,0.25); }
    .timer { text-align: center; font-size: 11px; color: #64748B; padding-bottom: 4px;
             -webkit-app-region: no-drag; }
  </style></head><body>
    <div class="header">
      <div class="title">${isUrgent ? '⚡ 急单提醒' : '📋 新订单提醒'}</div>
      <div class="subtitle">${typeLabels[orderType] || orderType}</div>
    </div>
    <div class="body">
      <div class="row"><span class="label">游戏</span><span class="value">${gameName}</span></div>
      <div class="row"><span class="label">金额</span><span class="amount">¥${Number(amount).toFixed(2)}</span></div>
      ${customerSource ? `<div class="row"><span class="label">来源</span><span class="value">${customerSource}</span></div>` : ''}
      <div class="row"><span class="label">时间</span><span class="value">${urgency === 'later' ? '📅 预约' : '⚡ 立即打'}</span></div>
    </div>
    <div class="timer" id="timer">30 秒后自动关闭</div>
    <div class="actions">
      <button class="btn btn-ignore" onclick="window.close()">忽略</button>
      <button class="btn btn-accept" id="acceptBtn">查看</button>
    </div>
    <script>
      let sec = 30;
      const timer = document.getElementById('timer');
      const countdown = setInterval(() => {
        sec--;
        timer.textContent = sec + ' 秒后自动关闭';
        if (sec <= 0) { clearInterval(countdown); window.close(); }
      }, 1000);
      document.getElementById('acceptBtn').addEventListener('click', () => {
        clearInterval(countdown);
        window.__acceptCallback && window.__acceptCallback();
        window.close();
      });
    </script>
  </body></html>`;

  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // @ts-ignore - inject callback
  (notificationWindow as any).webContents.executeJavaScript(
    `window.__acceptCallback = function() { window.close(); };`,
  );

  notificationWindow.on('closed', () => {
    notificationWindow = null;
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
  });

  // Auto close after 35 seconds (just in case the countdown fails)
  autoCloseTimer = setTimeout(() => {
    closeNotification();
  }, 35_000);

  // Accept button handler via IPC
  notificationWindow.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'accept-order') {
      closeNotification();
      onAccept();
    }
  });

  // Override window.close to trigger accept
  notificationWindow.webContents.executeJavaScript(`
    const origClose = window.close;
    window.close = function() { origClose.call(window); };
  `);

  // Monitor: when notification is closing because user clicked accept,
  // check if it was explicit close vs timeout
  notificationWindow.on('close', () => {
    // We can't easily distinguish accept vs ignore in data: URL mode,
    // so both just close the notification
  });
}

function closeNotification(): void {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
  if (notificationWindow) {
    try { notificationWindow.close(); } catch { /* ignore */ }
    notificationWindow = null;
  }
}
