#!/usr/bin/env node
/**
 * 「界面体检」：逐个页面跑一遍体检，把「看得见的问题」量出来，而不是靠眼睛看截图。
 *
 * 为什么要有它：截图一张张看到眼睛花，而且「有没有溢出 / 有没有被截断 / 页头字号一致吗」
 * 这种事人眼不靠谱（缩放一下就看走眼，之前就误判过一次「菜单文字被截断」）。
 * 这个脚本开一次无头浏览器逐页导航，在页面里跑一段探针，返回 JSON：
 *   1. 横向溢出：内容卡（.app-content）里有没有东西比卡片还宽（右边被切掉）；
 *   2. 文字被截断：scrollWidth 明显大于 clientWidth 且 overflow 不是 auto/scroll/hidden 的容器；
 *   3. 页头：每个页面最靠上的那个标题，报出文字 / 字号 / 颜色 / 是否用了统一页头组件；
 *   4. 纵向对比：一遍跑完把各页页头的字号、色值合并起来看，一眼就知道哪个页「长得不一样」。
 *
 * 用法：
 *   node scripts/_mock_api.mjs --port=8123 --role=OWNER       # 另开窗口
 *   node scripts/_ui_audit.mjs --base=http://127.0.0.1:8123 \
 *     --pre=scripts/_shot_seed_owner.js /admin /admin/orders /admin/settings
 * 选项：--w=1600 --h=1000 --wait=2800 --json=tmp_shots/ui_audit.json
 * 只允许打本地地址。
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
  console.error('用法：node scripts/_ui_audit.mjs --base=http://127.0.0.1:8123 /admin /admin/orders ...');
  process.exit(2);
}
const base = opt('base', 'http://127.0.0.1:8123');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
  console.error('只允许本地地址：' + base);
  process.exit(2);
}
const width = Number(opt('w', 1600));
const height = Number(opt('h', 1000));
const wait = Number(opt('wait', 2800));
const pre = opt('pre', '');
const jsonOut = opt('json', '');
const port = Number(opt('port', 9345));

const browser = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在页面里跑的探针：把「看得见的问题」量成数据。 */
const PROBE = `(() => {
  const out = { titles: [], overflow: [], clipped: [], issues: [] };
  const host = document.querySelector('.app-content');
  if (!host) { out.issues.push('没找到 .app-content（没登录 / 页面还没渲染完）'); return out; }
  const hostRect = host.getBoundingClientRect();

  // ── 1. 页头：最靠上的标题（统一页头组件用的是 .ant-typography 的 h5）──
  const heads = [...host.querySelectorAll('h1,h2,h3,h4,h5')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top - hostRect.top < 320;
  }).slice(0, 3);
  for (const el of heads) {
    const cs = getComputedStyle(el);
    out.titles.push({
      text: (el.textContent || '').trim().slice(0, 24),
      tag: el.tagName.toLowerCase(),
      size: cs.fontSize,
      weight: cs.fontWeight,
      color: cs.color,
      gradient: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 120) : '',
      top: Math.round(el.getBoundingClientRect().top - hostRect.top),
    });
  }

  // ── 2. 横向溢出：谁比内容卡还宽（右边被切掉）──
  //    注意：有祖先带横向滚动条的（antd 表格列多时就是 .ant-table-content overflow:auto）
  //    不算问题 —— 那是「可以滚着看」，不是「被切掉」。
  const all = host.querySelectorAll('*');
  const inScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== host) {
      const st = getComputedStyle(n);
      if (st.overflowX === 'auto' || st.overflowX === 'scroll') return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    const over = Math.round(r.right - (hostRect.right - 1));
    if (over > 2 && !inScroller(el)) {
      out.overflow.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 30),
        over,
        w: Math.round(r.width),
      });
    }
  }
  out.overflow = out.overflow.slice(0, 12);

  // ── 3. 文字被截断（不是有意的省略号菜单）──
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' || cs.textOverflow !== 'clip') continue;
    if (inScroller(el)) continue;
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 2) continue;
    const d = el.scrollWidth - el.clientWidth;
    if (d > 4 && el.clientWidth > 0) {
      out.clipped.push({ text: t.slice(0, 26), over: d, w: el.clientWidth });
    }
  }
  out.clipped = out.clipped.slice(0, 12);

  // ── 4. 页面顶部压根没有标题（一进页面不知道自己在哪）──
  if (!out.titles.length) out.noTitle = true;
  return out;
})()`;

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

const profile = path.join(process.cwd(), 'tmp_edge_profile_audit');
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

const report = [];
try {
  const target = await findTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (pre) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(pre, 'utf8') });
  }

  for (const p of paths) {
    await cdp.send('Page.navigate', { url: base + p });
    await sleep(wait);
    const r = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const data = r?.result?.value || {};
    report.push({ path: p, ...data });
    const head = (data.titles || [])[0] || {};
    const flags = [];
    if ((data.overflow || []).length) flags.push('横向溢出 ' + data.overflow.length);
    if ((data.clipped || []).length) flags.push('文字截断 ' + data.clipped.length);
    if ((data.issues || []).length) flags.push('!! ' + data.issues.join(';'));
    if (data.noTitle) flags.push('没有页面标题');
    console.log(
      '[audit] ' + p.padEnd(34) + ' 标题=' + JSON.stringify((head.text || '').slice(0, 16)) +
        ' ' + (head.size || '-') + '/' + (head.weight || '-') +
        (head.gradient ? ' 渐变' : ' 纯色 ' + (head.color || '')) +
        (flags.length ? '   ⚠ ' + flags.join(' · ') : '   ok'),
    );
  }
  cdp.ws.close();
} catch (err) {
  console.error('[audit] 失败：' + (err && err.message));
  process.exitCode = 1;
} finally {
  try {
    child.kill();
  } catch {
    /* 已经退了 */
  }
}

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
  console.log('[audit] 明细 → ' + jsonOut);
}
