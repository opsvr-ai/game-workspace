import { BrowserWindow, screen, ipcMain } from 'electron';
import { logger } from './logger';

let w: BrowserWindow | null = null;
let t: ReturnType<typeof setTimeout> | null = null;
let action: 'kill' | 'cancel' | null = null;

export interface KillNotificationOptions { processName: string; countdownSeconds?: number; onKillNow: () => void; }

export function showKillNotification(opts: KillNotificationOptions): void {
  closeKillNotification(); action = null;
  const s = opts.countdownSeconds ?? 5;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  w = new BrowserWindow({
    width: 360, height: 220, x: sw - 380, y: sh - 240,
    frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: false, nodeIntegration: true },
  });

  const h = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei",sans-serif;background:#0F172A;color:#E2E8F0;
border:1px solid #FF4757;border-radius:12px;overflow:hidden;user-select:none;
-webkit-app-region:drag;height:100vh;display:flex;flex-direction:column}
.h{padding:20px 20px 12px;text-align:center}
.t{font-size:16px;font-weight:700;color:#FF4757}
.pn{font-size:14px;color:#FF9100;margin-top:6px;font-family:monospace}
.b{padding:0 20px;flex:1;display:flex;flex-direction:column;justify-content:center}
.ct{text-align:center;font-size:13px;color:#94A3B8;margin-bottom:8px}
.pb{width:100%;height:6px;background:rgba(255,71,87,0.2);border-radius:3px;overflow:hidden}
.pf{height:100%;background:linear-gradient(90deg,#FF4757,#FF9100);border-radius:3px;width:100%}
.tm{text-align:center;font-size:28px;font-weight:700;color:#FF4757;margin-top:10px;font-family:monospace}
.ac{display:flex;gap:12px;padding:16px 20px 20px;-webkit-app-region:no-drag}
.btn{flex:1;padding:10px 0;border-radius:8px;border:none;cursor:pointer;font-size:14px;font-weight:600}
.bk{background:linear-gradient(135deg,#FF4757,#FF6B81);color:#fff}
.bc{background:rgba(148,163,184,0.15);color:#94A3B8}
</style></head><body>
<div class="h"><div class="t">检测到黑名单进程</div><div class="pn">${escHtml(opts.processName)}</div></div>
<div class="b">
<div class="ct" id="cl">将在 ${s} 秒后自动关闭</div>
<div class="pb"><div class="pf" id="pg"></div></div>
<div class="tm" id="td">${s}</div>
</div>
<div class="ac">
<button class="btn bc" id="cb">关闭提示</button>
<button class="btn bk" id="kb">立即关闭</button>
</div>
<script>
const {ipcRenderer}=require('electron');
let sec=${s},total=${s};
const td=document.getElementById('td'),cl=document.getElementById('cl'),pg=document.getElementById('pg');
const cd=setInterval(()=>{sec--;td.textContent=sec;cl.textContent='将在 '+sec+' 秒后自动关闭';pg.style.width=((sec/total)*100)+'%';if(sec<=0){clearInterval(cd);ipcRenderer.send('kill-now');window.close();}},1000);
document.getElementById('kb').addEventListener('click',()=>{clearInterval(cd);ipcRenderer.send('kill-now');window.close();});
document.getElementById('cb').addEventListener('click',()=>{clearInterval(cd);ipcRenderer.send('kill-cancel');window.close();});
</script></body></html>`;

  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(h));

  const onNow = () => { action = 'kill'; };
  const onCancel = () => { action = 'cancel'; };
  ipcMain.on('kill-now', onNow);
  ipcMain.on('kill-cancel', onCancel);

  w.on('closed', () => {
    ipcMain.removeListener('kill-now', onNow);
    ipcMain.removeListener('kill-cancel', onCancel);
    if (action === 'cancel') {
      logger.info('[KillNotify] Cancelled by user', { pn: opts.processName });
    } else {
      logger.info('[KillNotify] Executing kill', { pn: opts.processName });
      opts.onKillNow();
    }
    w = null;
  });
  t = setTimeout(() => closeKillNotification(), (s + 3) * 1000);
}

function closeKillNotification(): void {
  if (t) { clearTimeout(t); t = null; }
  if (w) { try { w.close(); } catch {} w = null; }
}

export function showKilledToast(pn: string): void {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const tw = new BrowserWindow({
    width: 320, height: 60, x: sw - 340, y: sh - 80,
    frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  tw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}body{font-family:"Microsoft YaHei",sans-serif;background:#0F172A;color:#E2E8F0;border:1px solid #00E676;border-radius:10px;overflow:hidden;user-select:none;height:100vh;display:flex;align-items:center;justify-content:center}.m{font-size:13px;color:#00E676}.n{color:#fff;font-weight:600}</style></head><body><div class="m">已自动关闭黑名单进程 <span class="n">' + escHtml(pn) + '</span></div></body></html>'));
  setTimeout(() => { try { tw.close(); } catch {} }, 3000);
}

function escHtml(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
