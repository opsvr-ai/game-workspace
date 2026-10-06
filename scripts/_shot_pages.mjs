#!/usr/bin/env node
/**
 * 批量给多个页面截图（**只开一次**无头浏览器，逐页导航）。
 *
 * 为什么要有它：scripts/_shot_ui.mjs 每跑一次都要重启浏览器，单页 ~60 秒，
 * 「把主要页面都看一遍」这种巡检要十几分钟，根本做不下去。这个脚本开一次浏览器、
 * 一页一页地拍，第二页起每页只要几秒 —— UI 巡检才真正可行。
 *
 * 用法：
 *   node scripts/_mock_api.mjs                                  # 另开一个窗口，先把假后台起起来
 *   node scripts/_shot_pages.mjs --out=tmp_shots/audit \
 *     --pre=scripts/_shot_seed_owner.js \
 *     --base=http://127.0.0.1:8123 \
 *     /admin /admin/orders /cs/dispatch /owner/employees
 * 选项：--w=1600 --h=900 --wait=2500 --scale=1 --full --sel=<选择器>
 *
 * 只允许打本地地址（127.0.0.1 / localhost），避免误截线上。
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
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const paths = args.filter((a) => !a.startsWith('--'));
if (!paths.length) {
  console.error('用法：node scripts/_shot_pages.mjs --out=tmp_shots/audit --base=http://127.0.0.1:8123 /admin /cs/dispatch ...');
  process.exit(2);
}

const base = opt('base', 'http://127.0.0.1:8123');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
  console.error('只允许本地地址：' + base);
  process.exit(2);
}
const outDir = opt('out', 'tmp_shots/audit');
const width = Number(opt('w', 1600));
const height = Number(opt('h', 900));
const scale = Number(opt('scale', 1));
const wait = Number(opt('wait', 2500));
const sel = opt('sel', '');
const pre = opt('pre', '');
const full = args.includes('--full');
const port = Number(opt('port', 9344));

const browser = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome，请在 EDGE_CANDIDATES 里补上路径');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.join(process.cwd(), 'tmp_edge_profile_batch');
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

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
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
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
  return { ws, ready, send };
}

const slug = (p) => p.replace(/^\//, '').replace(/[^\w.-]+/g, '_') || 'root';

try {
  const target = await findTarget();
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
  fs.mkdirSync(outDir, { recursive: true });

  for (const p of paths) {
    const url = base + p;
    await cdp.send('Page.navigate', { url });
    await sleep(wait);
    // 自证：页面视口跟 --w 差得多就喊一声，别让「截图失真」再被当成界面缺陷。
    const vp = await cdp.send('Runtime.evaluate', { expression: 'window.innerWidth', returnByValue: true });
    const realW = Number(vp?.result?.value) || width;
    if (Math.abs(realW - width) > 8) {
      console.log('[shot] ！视口 ' + realW + 'px 与 --w=' + width + 'px 不一致，这张图可能失真');
    }
    let clip = { x: 0, y: 0, width, height, scale };
    if (full) {
      const m = await cdp.send('Runtime.evaluate', {
        expression:
          'JSON.stringify({ h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) })',
        returnByValue: true,
      });
      let h = height;
      try {
        h = Math.min(Math.max(JSON.parse(m?.result?.value || '{}').h || height, 400), 12000);
      } catch {
        /* 量不到就用默认 */
      }
      clip = { x: 0, y: 0, width, height: h, scale };
    }
    if (sel) {
      const box = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height, sw: Math.max(el.scrollWidth, r.width), sh: Math.max(el.scrollHeight, r.height) }); })()`,
        returnByValue: true,
      });
      try {
        const b = JSON.parse(box?.result?.value || 'null');
        // --full：这套系统的外壳是 height:100vh + overflow:hidden，页面在 .app-content 这类
        // 内层容器里滚 —— 所以「整页」要按容器的 scrollHeight 算，不能按文档高度。
        if (b) clip = { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: (full ? b.sw : b.w) + 24, height: (full ? b.sh : b.h) + 24, scale };
      } catch {
        /* 没找到就当整页 */
      }
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    const file = path.join(outDir, slug(p) + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('[shot] ' + p + ' → ' + file + ' (' + Math.round(clip.width) + 'x' + Math.round(clip.height) + ')');
  }
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
