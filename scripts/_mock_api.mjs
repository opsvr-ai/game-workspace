#!/usr/bin/env node
/**
 * 本地「假后台」：把 apps/web/dist 当静态站发出去，同时把 /api/* 全部接管。
 *
 * 为什么需要它：这套系统的页面在本机打不开 —— 进页面要登录、登录要连数据库，
 * 而本机没有数据库。于是「界面到底长什么样、整齐不整齐」只能等上线才看见。
 * 有了它 + scripts/_shot_ui.mjs，就能在**完全离线、不碰线上**的前提下把真实页面截出来：
 * 颜色、间距、对齐、表格列宽这些「改完看不见」的东西，第一次能自己看。
 *
 * 用法：
 *   node scripts/_mock_api.mjs                       # 默认 127.0.0.1:8123
 *   node scripts/_mock_api.mjs --port=8123
 * 然后：
 *   node scripts/_shot_ui.mjs http://127.0.0.1:8123/cs/dispatch out.png \
 *     --pre=scripts/_shot_seed_owner.js --await=.ant-table --w=1600 --full
 *
 * 它**只回答假数据**，请求路径会打进 tmp_shots/_api_log.txt ——
 * 想给某个页面加更真实的数据，照着这份日志补 FIXTURES 即可。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps', 'web', 'dist');
const LOG_FILE = path.join(ROOT, 'tmp_shots', '_api_log.txt');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const PORT = Number(opt('port', 8123));
// --role=OWNER|ADMIN|CS|COMPANION：/auth/me 用哪个身份返回。
// 想看别的角色就再起一个实例、换个 --port 即可（截图脚本用 --base 指过去）。
const ROLE = String(opt('role', 'OWNER')).toUpperCase();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** 登录态里的那个「人」。老板角色，能看到全部菜单，最好用来对照界面。 */
const USERS = {
  OWNER: {
    id: 'u-owner-1',
    username: 'hanlei',
    displayName: '韩磊',
    role: 'OWNER',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  ADMIN: {
    id: 'u-admin-1',
    username: 'dianzhang01',
    displayName: '张店长',
    role: 'ADMIN',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  CS: {
    id: 'u-cs-1',
    username: 'kefu01',
    displayName: '小美',
    role: 'CS',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    avatar: null,
    pendingReviewCount: 0,
  },
  COMPANION: {
    id: 'u-comp-1',
    username: 'zhangsan',
    displayName: '张三',
    role: 'COMPANION',
    studioId: 's-1',
    studioName: '蠢驴电竞',
    companionId: 'c-1',
    avatar: null,
    pendingReviewCount: 0,
  },
};
const ME = USERS[ROLE] || USERS.OWNER;

/** 按 方法 + 路径 精确/正则匹配的假响应；没命中的一律 { data: null }。 */
const FIXTURES = [
  { m: 'GET', p: /^\/api\/auth\/me$/, body: { data: ME } },
  {
    m: 'POST',
    p: /^\/api\/auth\/login$/,
    body: { data: { accessToken: 'mock-access', refreshToken: 'mock-refresh', user: ME } },
  },
  { m: 'POST', p: /^\/api\/auth\/refresh$/, body: { data: { accessToken: 'mock-access', refreshToken: 'mock-refresh' } } },
  { m: 'GET', p: /^\/api\/config/, body: { data: { data: {} } } },
];

function log(line) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const isFile = path.extname(rel) !== '';
  const full = path.join(DIST, isFile ? rel : 'index.html');
  if (!full.startsWith(DIST) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA 兜底：没扩展名的路径一律回 index.html（前端自己路由）
    const idx = path.join(DIST, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(fs.readFileSync(idx));
      return;
    }
    res.writeHead(404);
    res.end('dist 还没构建：先跑 pnpm --filter @chunlv/web build');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (!p.startsWith('/api/')) {
    serveStatic(req, res, p);
    return;
  }

  const method = req.method || 'GET';
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 2_000_000) req.destroy();
  });
  req.on('end', () => {
    const hit = FIXTURES.find((f) => f.m === method && f.p.test(p));
    log(method + ' ' + p + (url.search ? url.search : '') + (hit ? '  [fixture]' : ''));
    json(res, hit ? hit.body : { data: null });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const ok = fs.existsSync(path.join(DIST, 'index.html'));
  console.log('[mock] 假后台起来了 → http://127.0.0.1:' + PORT + '（身份 ' + ME.role + ' / ' + ME.displayName + '）' + (ok ? '' : '  ⚠ dist 还没构建'));
  console.log('[mock] 请求日志 → tmp_shots/_api_log.txt');
});
