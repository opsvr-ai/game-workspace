const { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createMachineAgent } = require('./machine-agent');

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

// ── 自动更新（2026-09-30 老板：客服端以后全自动、不用点授权）──────────
// 以前客服端自己下载 NSIS 安装包、再用 -Verb RunAs 去装，每次更新都要人点一下
// UAC 授权 —— 客服不在电脑跟前，这台机器就永远停在老版本。
// 现在改成跟陪玩端一样的路子：先下好整包 zip → 给看门狗（SystemHelper 服务，
// 系统权限）写一个信号文件 → 自己退出 → 看门狗解压换装并把客户端拉起来。
// 全程不弹 UAC，客服什么都不用做。
const UPDATE_DIR = 'C:' + path.sep + 'ProgramData' + path.sep + 'chunlv';
const UPDATE_SIGNAL = path.join(UPDATE_DIR, 'update.json');
const UPDATE_ZIP = path.join(UPDATE_DIR, 'update-cs.zip');
const HEALTH_FILE = path.join(UPDATE_DIR, 'client-healthy.json');
const BLOCKED_FILE = path.join(UPDATE_DIR, 'blocked-versions.json');
const WATCHDOG_EXE = 'C:' + path.sep + 'Program Files' + path.sep + 'SystemHelper' + path.sep + 'SystemHelper.exe';
// 这个字符串只有「认得客服端」的看门狗里才有（旧看门狗只盯陪玩端）。把客服端交给
// 旧看门狗会变成「关掉之后再也没人拉起来」，更新信号还会被解压到陪玩端目录里，
// 所以必须先确认它认得客服端 —— 只看这个标记，不钉死具体构建号，
// 以后看门狗再升级也不会把这条路堵死。
const WATCHDOG_CLIENT_MARK = '客服管理.exe';

function readBlockedVersions() {
  try {
    return JSON.parse(fs.readFileSync(BLOCKED_FILE, 'utf-8')) || {};
  } catch {
    return {};
  }
}

// 看门狗在不在，而且是不是认得客服端的新版（直接在它的 exe 字节里找内嵌标记）。
function watchdogReady() {
  try {
    if (!fs.existsSync(WATCHDOG_EXE)) return false;
    const buf = fs.readFileSync(WATCHDOG_EXE);
    return buf.length > (1 << 20) && buf.includes(Buffer.from(WATCHDOG_CLIENT_MARK));
  } catch {
    return false;
  }
}

// 看门狗更新完会等客户端自报「我起来了」（client-healthy.json）：
// 等不到就整目录回滚到更新前那一版。所以只要主进程起来了就写，之后每分钟刷新一次。
function writeHealthMarker() {
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    fs.writeFileSync(
      HEALTH_FILE,
      JSON.stringify({ version: app.getVersion(), exePath: app.getPath('exe'), at: Date.now() }),
      'utf-8',
    );
  } catch {
    // 写不了就算了：只是少一层「装坏了自动回滚」的保护。
  }
}

function signalUpdate(url, localPath, version) {
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_SIGNAL, JSON.stringify({ url, localPath, version }), 'utf-8');
  } catch {
    // 写不进信号文件：这轮更新装不上，下轮再说，不影响客服正在用的窗口。
  }
}

// 没装新看门狗的老机器退回老办法：装 NSIS 安装包（需要点一次 UAC），
// 保证不会因为「装不了」而永远停在老版本。
function runInstallerElevated(installerPath) {
  const ps =
    "Start-Process -FilePath '" + installerPath + "' -ArgumentList '/S' -Verb RunAs -Wait; " +
    "Remove-Item '" + installerPath + "' -Force -ErrorAction SilentlyContinue";
  const { spawn } = require('child_process');
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  // 这里故意不 app.quit()：安装包自己会先关掉客服端再换文件（装完也会自动打开）。
  // 以前先退出，客服一点「取消」授权，这台机器的客服端就再也没人拉起来了。
}

function checkForUpdates() {
  try {
    const serverUrl = getServerUrl().replace(/\/$/, '');
    fetch(serverUrl + '/api/agent/cs-version')
      .then((res) => res.json())
      .then((json) => {
        const latest = json && json.data && json.data.version;
        const exeUrl = json && json.data && json.data.downloadUrl;
        const zipUrl = json && json.data && json.data.zipUrl;
        if (!latest || !exeUrl) return;
        // 只有服务器版本严格更新时才更新；本地已是最新/更新时不触发，
        // 避免字符串不等（===）导致反复下载安装并退出（闪退）。
        if (compareVersions(latest, app.getVersion()) <= 0) return;
        // 这个版本在这台机器上装坏过（看门狗已回滚 + 拉黑）：别再下了，否则死循环。
        if (Object.prototype.hasOwnProperty.call(readBlockedVersions(), latest)) return;

        const toFull = (u) => (u.indexOf('http') === 0 ? u : serverUrl + u);
        // 静默路径：有「认得客服端」的新看门狗就走整包 zip，不需要授权。
        const silent = !!(zipUrl && watchdogReady());
        const fullUrl = toFull(silent ? zipUrl : exeUrl);
        // 先在主进程把包完整下载下来，再退出安装；避免之前用后台 PowerShell 下载时
        // 应用一退出就把下载进程一起杀掉，导致永远装不上。
        const out = silent
          ? UPDATE_ZIP
          : path.join(app.getPath('temp'), 'Chunlv-CS-Setup-' + latest + '.exe');
        downloadFile(fullUrl, out)
          .then(() => {
            if (silent) {
              signalUpdate(fullUrl, out, latest);
              // 交给看门狗（系统权限）解压换装并重启：不弹 UAC。
              setTimeout(() => app.exit(0), 800);
              return;
            }
            runInstallerElevated(out);
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

// ── 页面加载失败时的兜底（2026-09-30）────────────────────────────────────────
// 老板报「192.168.1.4 邵泽慧那台怎么蓝屏了」，发来的照片是客服端窗口整片深蓝 —— 那就是本窗口
// 的 backgroundColor（#0B1024），页面一个字都没渲染出来。**不是 Windows 蓝屏死机**，是页面
// 根本没加载成功（她那台老客户端 9/30 凌晨 3 点之后就再没连上服务器），而老客户端在这种情况下
// 什么都不显示，客服、老板都看不懂，只能当成电脑坏了。现在补三件事：
//   ① 每次加载失败/超时都写本地日志 + 回传服务器（落 client-errors/），以后有据可查；
//   ② 窗口里直接显示人话（连不上服务器 + 原因 + 重试按钮），不再是深蓝空窗口；
//   ③ 每 10 秒自动重试一次，托盘里也能点「重新加载页面」。
function logLine(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'cs-client.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.unlinkSync(file);
    fs.appendFileSync(file, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8');
  } catch {}
  try { console.log(msg); } catch {}
}

function reportLoadFailure(desc, code) {
  try {
    const url = getServerUrl().replace(/\/$/, '') + '/api/agent/client-error';
    const payload = {
      ip: '', user: '', role: 'CS', appVersion: app.getVersion(),
      page: 'cs-shell', url: getLoginUrl(), phase: 'cs-page-load',
      status: code === 'timeout' ? null : (code == null ? null : code),
      message: String(desc || ''), detail: 'attempts=' + loadAttempts + ' code=' + code, ua: '',
    };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch {}
}

// 兜底页：深蓝底 + 人话 + 重试按钮（点按钮走 IPC，不整页刷新，免得把重试次数清零）
function buildLoadErrorHtml(detail) {
  const serverUrl = getServerUrl().replace(/\/$/, '');
  const loginUrl = serverUrl + '/login';
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>客服端 · 连不上服务器</title><style>'
    + 'body{margin:0;height:100vh;background:#0B1024;color:#e6e9f5;font-family:"Microsoft YaHei","微软雅黑",Arial,sans-serif;display:flex;align-items:center;justify-content:center}'
    + '.box{max-width:640px;padding:0 28px;text-align:center}'
    + '.icon{font-size:44px}h1{font-size:20px;margin:14px 0 10px;font-weight:600}'
    + 'p{font-size:13px;line-height:1.9;color:#aeb6d4;margin:6px 0}'
    + 'code{color:#8fb2ff;word-break:break-all}'
    + 'button{margin-top:18px;padding:10px 26px;font-size:15px;border:0;border-radius:8px;background:#1677ff;color:#fff;cursor:pointer}'
    + 'button:hover{background:#0958d9}'
    + '.tip{margin-top:18px;font-size:12px;color:#7b83a3;line-height:1.9}'
    + '</style></head><body><div class="box"><div class="icon">📡</div>'
    + '<h1>连不上服务器，页面没打开</h1>'
    + '<p>服务器地址：<code>' + loginUrl + '</code></p>'
    + '<p>原因：' + (detail || '未知') + '</p>'
    + '<p>已经重试 <b>' + loadAttempts + '</b> 次，每 10 秒会自动再试一次。</p>'
    + '<button id="r">立即重新加载</button>'
    + '<div class="tip">先确认这台电脑能上网、把 VPN / 代理（v2rayN、加速器之类）关掉再点重试。<br>'
    + '一直不行就把这张页面拍给管理员，或在这台电脑上重装一次客服端：<br><code>' + serverUrl + '/uploads/客服管理-Setup.exe</code></div>'
    + '<script>document.getElementById("r").onclick=function(){if(window.electronAPI&&window.electronAPI.reloadApp){window.electronAPI.reloadApp();}};</script>'
    + '</div></body></html>';
  return 'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf-8').toString('base64');
}

let loadAttempts = 0;
let loadOk = false;
// 本次加载是不是已经失败了。Chromium 失败时也会提交一张「错误页」并触发 did-finish-load，
// 而 getURL() 还报着原来那个地址 —— 只看 URL 会把失败当成功，把重试次数和自动重试一起清掉。
let loadFailed = false;
let loadWatchdog = null;
let autoRetryTimer = null;

function loadAppPage(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  loadOk = false;
  loadFailed = false;
  clearTimeout(loadWatchdog);
  // 30 秒还没加载完就当成失败（服务器没响应时 Chromium 可能一直转圈、不报错）
  loadWatchdog = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || loadOk) return;
    onLoadFailure('页面加载超时（服务器没响应）', 'timeout');
  }, 30000);
  logLine('load app page (' + reason + ') attempt=' + loadAttempts);
  mainWindow.loadURL(getLoginUrl());
}

function onLoadFailure(desc, code) {
  loadAttempts += 1;
  loadFailed = true;
  logLine('page load failed attempt=' + loadAttempts + ' code=' + code + ' desc=' + desc);
  reportLoadFailure(desc, code);
  clearTimeout(loadWatchdog);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(buildLoadErrorHtml(desc + '（' + code + '）'));
  }
  clearTimeout(autoRetryTimer);
  autoRetryTimer = setTimeout(() => loadAppPage('auto-retry'), 10000);
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
  clearSessionCache().then(() => loadAppPage('startup'));
  // 只在「登录页自己加载失败」时动手。
  // 以前是只要窗口里任何一次加载失败（子框架、偶发断网、资源加载超时……）
  // 就把整个窗口强行 loadURL 到登录页，客服正用着会突然掉到登录界面。
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return; // 子框架/资源失败不理会
    if (code === -3) return; // ERR_ABORTED：正常的中断，不算失败
    if (String(failedUrl || '').startsWith('data:')) return; // 我们自己那张兜底页
    const loginPath = getLoginUrl().split('?')[0];
    if (!String(failedUrl || '').startsWith(loginPath)) return; // 不是登录页就别动
    onLoadFailure(desc || '加载失败', code);
  });
  // 真的加载成功才把重试计数清零（兜底页也是一次成功的加载，所以必须按 URL 判断）
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (loadFailed) return; // 这是失败后 Chromium 自己那张错误页，不是真加载成功
    const url = mainWindow.webContents.getURL();
    if (!url.startsWith(serverUrl)) return;
    loadOk = true;
    loadAttempts = 0;
    clearTimeout(loadWatchdog);
    clearTimeout(autoRetryTimer);
    logLine('page loaded ok: ' + url.slice(0, 120));
  });
  // 点 ❌ 最小化到托盘，不退出
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
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

// 托盘图标：优先用打包进 resources 的 donkey.ico，其次开发目录里的同名文件。
// 老代码直接 createFromPath，文件不存在时拿到的是「空图片」，托盘里啥也看不见
// —— 老板 2026-09-26 报的「客服端右下角没图标」就是这个（安装包里从来没打进这个 ico）。
function createTrayIcon() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'donkey.ico') : '',
    path.join(__dirname, 'public', 'donkey.ico'),
    process.resourcesPath ? path.join(process.resourcesPath, 'donkey.png') : '',
    path.join(__dirname, 'public', 'donkey.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    } catch {
      // 换下一个候选路径
    }
  }
  // 兜底：图标文件全都读不到时，画一个一定看得见的小圆点（灰蓝色，两种字节序看着都一样）。
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2) > 7) continue;
      const px = (y * size + x) * 4;
      buf[px] = 0x4b;
      buf[px + 1] = 0x55;
      buf[px + 2] = 0x63;
      buf[px + 3] = 0xff;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createTray() {
  try {
    tray = new Tray(createTrayIcon());
  } catch (err) {
    // 托盘建不出来时不要再走「关窗口=隐藏」，否则窗口一关就再也叫不出来了。
    console.warn('Tray creation failed:', err && err.message);
    tray = null;
    return;
  }
  tray.setToolTip('客服管理');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showWindow() },
      {
        label: '重新加载页面',
        click: () => {
          loadAttempts = 0;
          showWindow();
          loadAppPage('tray');
        },
      },
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

// ── 机器台账 / 远程一键诊断（2026-09-30）─────────────────────────────────
// 老板：客服电脑以前我们完全看不见，机器一出问题只能等人到电脑跟前。
// 这里让客服端每 5 分钟把机器信息报给服务器台账，并每 60 秒领一次远程任务
// （一键诊断 / 下发的指令 / 一键开通远程管理），执行完把报告传回去。
// 全部由客户端主动往外连，客服在什么网络都一样能用，不用开端口、不用中继机。
const machineAgent = createMachineAgent({
  app,
  clientType: 'CS',
  getServerUrl,
  // 页面登录后会把账号口令存到 credentials.json（safeStorage 加密），
  // 只有本机本用户能解开 —— 拿它当「这台电脑现在是哪个人在用」。
  getLoginUser: () => {
    const creds = loadCredentials();
    return creds && creds.username ? { username: creds.username, role: 'CS' } : null;
  },
  log: logLine,
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });
  ipcMain.handle('config:getServerUrl', () => getServerUrl());
  ipcMain.handle('app:getVersion', () => app.getVersion());
  // 兜底页上的「立即重新加载」按钮走这里（不用整页刷新，重试次数不会被清零）
  ipcMain.handle('app:reload', () => {
    loadAttempts = 0;
    loadAppPage('manual');
    return true;
  });
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

  machineAgent.start();
  // 更新后「我还活着」的标记：看门狗拿它判断这次更新有没有把客户端装坏
  // （等不到就整目录回滚到更新前那一版），所以起来就写、之后每分钟刷新时间戳。
  writeHealthMarker();
  setInterval(writeHealthMarker, 60 * 1000);
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
