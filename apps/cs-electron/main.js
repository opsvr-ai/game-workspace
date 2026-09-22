const { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// 低配电脑无独显/驱动老旧时，关闭硬件加速避免黑屏
app.disableHardwareAcceleration();
// 允许局域网 http 地址使用麦克风/媒体接口
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', getServerUrl().replace(/\/$/, ''));

function getServerUrl() {
  const candidates = [
    path.join(process.resourcesPath, 'config.json'),
    path.join(__dirname, 'config.json'),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cfg && cfg.serverUrl) return cfg.serverUrl;
    } catch {
      // ignore and try next
    }
  }
  return 'http://1.117.229.36:3001';
}

function getLoginUrl() {
  const base = getServerUrl().replace(/\/$/, '') + '/login';
  return `${base}?v=${app.getVersion()}`;
}

async function clearSessionCache() {
  try {
    await session.defaultSession.clearCache();
  } catch {
    // 忽略清理失败
  }
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const https = require('https');
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        resolve(downloadFile(new URL(res.headers.location, url).toString(), dest));
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    req.on('error', (err) => {
      file.close();
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
      reject(err);
    });
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error('download timeout'));
    });
  });
}

function checkForUpdates() {
  try {
    const serverUrl = getServerUrl().replace(/\/$/, '');
    fetch(`${serverUrl}/api/agent/cs-version`)
      .then((res) => res.json())
      .then((json) => {
        const latest = json?.data?.version;
        const downloadUrl = json?.data?.downloadUrl;
        if (!latest || !downloadUrl) return;
        // 只有服务器版本严格更新时才更新；本地已是最新/更新时不触发，
        // 避免字符串不等（===）导致反复下载安装并退出（闪退）。
        if (compareVersions(latest, app.getVersion()) <= 0) return;
        const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${serverUrl}${downloadUrl}`;
        const out = path.join(app.getPath('temp'), `Chunlv-CS-Setup-${latest}.exe`);
        // 先在主进程把安装包完整下载下来，再退出安装；避免之前用后台 PowerShell
        // 下载时应用一退出就把下载进程一起杀掉，导致永远装不上。
        downloadFile(fullUrl, out)
          .then(() => {
            const ps = `Start-Process -FilePath '${out}' -ArgumentList '/S' -Verb RunAs -Wait; Remove-Item '${out}' -Force -ErrorAction SilentlyContinue`;
            const { spawn } = require('child_process');
            spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
              detached: true,
              stdio: 'ignore',
            }).unref();
            app.quit();
          })
          .catch(() => {
            // 下载失败时保持应用运行，避免闪退死循环。
          });
      })
      .catch(() => {});
  } catch {}
}

function credentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function loadCredentials() {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    if (!raw || !safeStorage.isEncryptionAvailable()) return null;
    const json = safeStorage.decryptString(Buffer.from(raw, 'base64'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function saveCredentials(creds) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { success: false, message: '系统不支持安全存储' };
    if (!creds || !creds.username || !creds.password) {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
      return { success: true };
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(creds)).toString('base64');
    fs.writeFileSync(credentialsPath(), encrypted, 'utf8');
    return { success: true };
  } catch {
    return { success: false, message: '保存失败' };
  }
}

/**
 * 客户端改名/更新之后，老机器的桌面快捷方式会指向已经被删掉的旧目录
 * （蠢驴电竞客服端 / 旧的客服管理目录），表现就是「图标变白、点开提示
 * 无法在此电脑上运行」。陪玩端早就修过同一个问题（每次启动校正自己的快捷方式），
 * 客服端一直缺这一段，所以这里补齐：
 *   ① 每次启动把「客服管理」快捷方式指到本次正在运行的 exe；
 *   ② 名字属于本产品、但目标已经不存在的旧图标（白图标）顺手清掉。
 * 当前用户桌面和公共桌面都处理（老版本 perMachine 安装器把图标放公共桌面）。
 */
function ensureDesktopShortcut() {
  // 开发模式（electron.exe）不建快捷方式，避免污染开发机桌面。
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
  const lnk = path.join(desktop, '客服管理.lnk');
  const dir = path.dirname(target);
  let publicDesktop = '';
  try {
    publicDesktop = path.join(path.dirname(app.getPath('home')), 'Public', 'Desktop');
  } catch {
    publicDesktop = '';
  }
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$w=New-Object -ComObject WScript.Shell',
    '$s=$w.CreateShortcut(' + q(lnk) + ')',
    '$s.TargetPath=' + q(target),
    '$s.WorkingDirectory=' + q(dir),
    '$s.IconLocation=' + q(target + ',0'),
    "$s.Description='客服管理'",
    '$s.Save()',
    // 枚举桌面快捷方式必须用 -Path，不能用 -LiteralPath，否则 *.lnk 不会被展开。
    // 小部分机器上「公共桌面」目录不存在（被删或被策略禁掉），先过滤掉：
    // 否则 Get-ChildItem 会报错，powershell 以退出码 1 收场，日志里天天一条假告警。
    '$desktops = @(' + q(desktop) + (publicDesktop ? ',' + q(publicDesktop) : '') + ') | Where-Object { $_ -and (Test-Path -LiteralPath $_) }',
    'foreach($d in $desktops){',
    "  Get-ChildItem -Path (Join-Path $d '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {",
    // 判断「是不是刚写的那个」必须比全路径：公共桌面上同名（客服管理.lnk）
    // 的旧图标正是最常见的白图标来源，按名字跳过就永远清不掉。
    "    if ($_.FullName -eq " + q(lnk) + ") { return }",
    "    if ($_.Name -notmatch '客服管理|蠢驴电竞|chunlv') { return }",
    // 旧品牌名字（蠢驴电竞客服端 / 蠢驴电竞）一律清掉，早就改名了。
    "    if ($_.Name -match '蠢驴电竞') { Remove-Item -LiteralPath $_.FullName -Force; return }",
    '    $t=$w.CreateShortcut($_.FullName).TargetPath',
    '    if (-not $t -or -not (Test-Path -LiteralPath $t) -or ($t -ieq ' + q(target) + ')) { Remove-Item -LiteralPath $_.FullName -Force }',
    '  }',
    '}',
  ].join(';');

  require('child_process').execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
    (err) => {
      if (err) console.warn('Desktop shortcut repair failed:', err.message);
    },
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: '客服管理',
    backgroundColor: '#0B1024',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const serverUrl = getServerUrl().replace(/\/$/, '');
  clearSessionCache().then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(getLoginUrl());
    }
  });
  // 只在「登录页自己加载失败」时重试。
  // 以前是只要窗口里任何一次加载失败（子框架、偶发断网、资源加载超时……）
  // 就把整个窗口强行 loadURL 到登录页，客服正用着会突然掉到登录界面。
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return; // 子框架/资源失败不理会
    if (code === -3) return; // ERR_ABORTED：正常的中断，不算失败
    const loginPath = getLoginUrl().split('?')[0];
    if (!String(failedUrl || '').startsWith(loginPath)) return; // 不是登录页就别动
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        mainWindow.loadURL(getLoginUrl());
      }
    }, 2000);
  });
  // 点 ❌ 最小化到托盘，不退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(process.resourcesPath, 'donkey.ico');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('客服管理');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });
  ipcMain.handle('config:getServerUrl', () => getServerUrl());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('folder:open', (_e, path) => {
    if (typeof path !== 'string' || !path.trim()) return { success: false };
    return shell.openPath(path.trim()).then(() => ({ success: true })).catch((err) => ({ success: false, error: String(err) }));
  });
  ipcMain.handle('credentials:get', () => loadCredentials());
  ipcMain.handle('credentials:save', (_e, creds) => saveCredentials(creds));
  ipcMain.handle('credentials:clear', () => {
    try {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
      return { success: true };
    } catch {
      return { success: false };
    }
  });
  ipcMain.handle('auth:logout', () => {
    try {
      if (fs.existsSync(credentialsPath())) fs.unlinkSync(credentialsPath());
    } catch {}
    return { success: true };
  });
  createWindow();
  createTray();
  // 每次启动顺手校正桌面图标：更新/改名后老机器的图标会变白、点不开。
  ensureDesktopShortcut();
  // 随机错峰，避免多台客服机同时下载 74MB 安装包。
  setTimeout(checkForUpdates, 20000 + Math.floor(Math.random() * 120000));
  // 版本号查询从 5 分钟放宽到 30 分钟（一天 288 次没有意义）；
  // 后台「推送更新」仍然可以立刻下发，不影响装机时间。
  setInterval(checkForUpdates, 30 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 隐藏到托盘时不退出；只有托盘“退出”才真正退出
});
