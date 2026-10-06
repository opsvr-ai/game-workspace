#!/usr/bin/env node
/**
 * 给某一页 / 某一区块截图（无头 Edge + CDP），用来做**界面改版的前后对照**。
 *
 * 为什么需要它：这套系统的界面在本机没法手点（进页面要登录、还要连数据库），
 * 而颜色 / 圆角 / 间距这种东西「改完看不见」就等于没改。这个脚本能：
 *   - 打开任意页面（含内部页 /ui-kit，它不需要登录、不连后端）；
 *   - 把某个元素滚到眼前、按它的实际大小裁图（还能放大倍率）；
 * 于是「改前一张、改后一张」就能逐像素对照了。
 *
 * 用法：
 *   node scripts/_shot_ui.mjs <url> <out.png> [--sel=选择器] [--w=1440] [--h=1000] [--scale=2] [--wait=1500]
 * 例：
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8100/ui-kit tmp_shots/ui-kit.png --w=1440 --h=2400
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8100/ui-kit tmp_shots/buttons.png --sel="#controls" --scale=2
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8100/login tmp_shots/login.png
 *
 * 依赖：本机装了 Edge（路径见 EDGE_CANDIDATES）或 Chrome。只跑本地地址，别拿它去截线上。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const [url, out] = positional;
if (!url || !out) {
  console.error('用法：node scripts/_shot_ui.mjs <url> <out.png> [--sel=选择器] [--w=1440] [--h=1000] [--scale=2] [--wait=1500]');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error('只允许本地地址（127.0.0.1 / localhost），别拿去截线上页面：' + url);
  process.exit(2);
}

const width = Number(opt('w', 1440));
const height = Number(opt('h', 1000));
const scale = Number(opt('scale', 2));
const wait = Number(opt('wait', 1500));
const sel = opt('sel', '');
const port = Number(opt('port', 9333));
// --pre=<js 文件>：导航**之前**注入的脚本（用来造登录态 / 挡掉 Electron 相关探测）
const pre = opt('pre', '');
// --await=<选择器>：等它出现再截图（页面是异步拉数据的，固定 sleep 不可靠）
const awaitSel = opt('await', '');
// --full：按整个文档的高度截图（长页面看全貌）
const full = args.includes('--full');
// --eval=<js>：顺手在页面上跑一段表达式并把结果打出来（量宽度 / 对齐这种「必须拿数」的检查）
const evalJs = opt('eval', '');

const browser = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome，请在 EDGE_CANDIDATES 里补上路径');
  process.exit(2);
}

const profile = path.join(process.cwd(), 'tmp_edge_profile');
const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=' + width + ',' + height,
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('连不上无头浏览器（端口 ' + port + '）');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg.method);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('WS 出错：' + (e.message || ''))));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error('CDP 超时：' + method));
        }
      }, 60000);
    });
  return { ws, ready, send, events };
}

try {
  const target = await findPageTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 视口按 --w/--h 精确设死。以前只靠 --window-size：无头窗口尺寸会被窗口边框 / 系统缩放吃掉，
  // 而且 captureScreenshot(captureBeyondViewport) 还会临时改布局宽度 —— 量出来的侧栏宽度、
  // 菜单文字就可能跟真实页面不一样（曾据此误判「菜单文字被截断」）。改成显式覆盖后，
  // window.innerWidth 就等于 --w，截图和探针看到的是同一个视口。
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (pre) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(pre, 'utf8') });
  }
  await cdp.send('Page.navigate', { url });
  await sleep(wait);
  {
    const vp = await cdp.send('Runtime.evaluate', { expression: 'window.innerWidth', returnByValue: true });
    const realW = Number(vp?.result?.value) || width;
    if (Math.abs(realW - width) > 8) console.log('[shot] ！视口 ' + realW + 'px 与 --w=' + width + 'px 不一致，这张图可能失真');
  }

  if (awaitSel) {
    const expr = 'document.querySelector(' + JSON.stringify(awaitSel) + ') !== null';
    for (let i = 0; i < 40; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r?.result?.value === true) break;
      await sleep(250);
    }
  }

  let boxW = width;
  let boxH = height;
  if (full) {
    const m = await cdp.send('Runtime.evaluate', {
      expression:
        'JSON.stringify({ w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) })',
      returnByValue: true,
    });
    try {
      const b = JSON.parse(m?.result?.value || '{}');
      if (b.w) boxW = Math.min(Math.max(b.w, 320), 3000);
      if (b.h) boxH = Math.min(Math.max(b.h, 400), 12000);
    } catch {
      /* 量不到就用传进来的高度 */
    }
  }

  if (evalJs) {
    const r = await cdp.send('Runtime.evaluate', { expression: evalJs, returnByValue: true, awaitPromise: true });
    console.log('[eval] ' + JSON.stringify(r?.result?.value ?? r?.result?.description ?? null));
  }

  let clip = { x: 0, y: 0, width: full ? boxW : width, height: full ? boxH : height, scale };
  if (sel) {
    const box = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }); })()`,
      returnByValue: true,
    });
    const raw = box?.result?.value;
    if (!raw) throw new Error('页面上找不到这个元素：' + sel);
    const b = JSON.parse(raw);
    clip = { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.w + 24, height: b.h + 24, scale };
    await sleep(400);
  }

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip,
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('[shot] ' + url + (sel ? ' ' + sel : '') + ' → ' + out + ' (' + clip.width + 'x' + clip.height + ' @' + scale + 'x)');
  cdp.ws.close();
} catch (err) {
  console.error('[shot] 失败：' + (err && err.message));
  process.exitCode = 1;
} finally {
  try {
    child.kill();
  } catch {
    /* 已经退了 */
  }
}
