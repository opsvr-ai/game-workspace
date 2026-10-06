#!/usr/bin/env node
/**
 * 路由分包守卫（配合 docs/REFACTOR-PLAN.md「前端按路由懒加载」那一批）。
 *
 * 为什么要有它：
 *   以前 50 个页面全是同步 import —— 首屏必须把「所有页面」的代码下载 + 解析完才画出第一帧
 *   （应用主包 1.2MB / 首屏 gzip 820KB，本机都要 3 秒才见到外壳）。改成按路由 lazy 之后
 *   主包掉到 347KB（首屏 gzip 582KB），点哪页拉哪页。
 *   **但这件事看不见**：新加一个页面时「同步 import」是最自然的写法，写下去没人会觉得不对，
 *   只是所有人的启动又慢一点 —— 所以要有个东西拦一下。
 *
 * 两条规则：
 *   1. router.tsx 里不许再出现 `import X from './pages/...'`（页面一律 `lazy(() => import(...))`）；
 *      外壳 AppLayout / 第一屏 LoginPage 不受此限（它们必须同步）。
 *   2. 如果本地有构建产物，入口分包（dist/assets/index-*.js）不许超过 SIZE_LIMIT_KB
 *      （现在约 347KB；这条能抓住「悄悄把某个大页面又同步进去了」这类回归）。
 *
 * 用法：
 *   node scripts/_check_route_splitting.mjs            # 只报告（CI 用，输出退出码）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = path.join(ROOT, 'apps', 'web', 'src', 'router.tsx');
const ASSETS = path.join(ROOT, 'apps', 'web', 'dist', 'assets');
/** 入口分包上限（KB）。当前约 347KB，留了点余量；同步塞回 2~3 个页面就会超。 */
const SIZE_LIMIT_KB = 512;
/**
 * 「首屏」的合计上限（KB，gzip 与未压缩各一条）。
 *
 * 首屏 = index.html 里 <script> + modulepreload 的那几个文件，**再顺着它们的静态 import 递归下去**
 * —— 这才是「打开第一眼要下载多少」。现在 3 个文件：index 347KB + antd 1293KB + react 204KB
 * = 1844KB（gzip 582KB）。
 *
 * 为什么还要卡这个：单看 index 一个块会被「把东西塞进 antd / react 块」绕过。
 * 2026-10-07 试过两条减首屏的路，都没成，结论写在这里免得后面再试一遍：
 *   ① 让 antd 走默认分块 → Rollup 把 antd 直接并进 react 块（1446KB），首屏只少 22KB；
 *   ② 把 Table / DatePicker / Upload 这些「只有表格页才用」的摘成单独块 → 那个块仍然被首屏静态引用
 *      （因为代码里 `import { X } from 'antd'` 走的是 antd 的汇总出口，所有组件都算「可达」），
 *      首屏反而多了 2KB。
 *   真正能减首屏的做法是「外壳别再 import 汇总出口、改成按组件路径引」（工序大，另开一批）。
 */
const INITIAL_LIMIT_KB = 2000;
const INITIAL_GZIP_LIMIT_KB = 640;
/** 至少要有这么多页面是懒加载的（防止「把路由删光」也算通过）。 */
const MIN_LAZY = 40;
/**
 * 允许同步 import 的页面：**只有第一屏**。
 * LoginPage 是没登录时的第一眼，它要是拉不到，用户连登录都进不去 —— 不值得为这点体积冒险。
 * （AppLayout 是外壳，不在 ./pages/ 下，本来就不受这条规则管。）
 */
const EAGER_OK = new Set(['./pages/LoginPage']);

const problems = [];
const src = fs.readFileSync(ROUTER, 'utf8');
const lines = src.split(/\r?\n/);

const eagerPageImports = [];
lines.forEach((line, i) => {
  const m = /^import\s+(\w+)\s+from\s+[\x27"](\.\/pages\/[^\x27"]+)[\x27"];/.exec(line);
  if (m && !EAGER_OK.has(m[2])) eagerPageImports.push({ line: i + 1, name: m[1], from: m[2] });
});
if (eagerPageImports.length) {
  problems.push(
    `router.tsx 里有 ${eagerPageImports.length} 个页面是**同步 import**（首屏要等它下载完）：`,
  );
  for (const e of eagerPageImports.slice(0, 10)) {
    problems.push(`  ${e.from}（第 ${e.line} 行）→ 改成 const ${e.name} = lazy(() => import('${e.from}'));`);
  }
}

const lazyCount = (src.match(/lazy\(\(\)\s*=>\s*import\(/g) || []).length;
if (lazyCount < MIN_LAZY) {
  problems.push(`懒加载的页面只有 ${lazyCount} 个（至少应 ${MIN_LAZY} 个）—— 路由是不是被删了？`);
}

// 有构建产物就顺便量一下「首屏到底多大」
let sizeLine = '（没找到构建产物，跳过体积检查；先 pnpm --filter @chunlv/web build）';
const DIST = path.join(ROOT, 'apps', 'web', 'dist');
if (fs.existsSync(ASSETS) && fs.existsSync(path.join(DIST, 'index.html'))) {
  // 入口分包本身
  const entries = fs
    .readdirSync(ASSETS)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, kb: fs.statSync(path.join(ASSETS, f)).size / 1024 }))
    .sort((a, b) => b.kb - a.kb);
  if (entries.length) {
    const biggest = entries[0];
    if (biggest.kb > SIZE_LIMIT_KB) {
      problems.push(
        `入口分包 ${biggest.f} = ${biggest.kb.toFixed(0)}KB 超过上限 ${SIZE_LIMIT_KB}KB —— ` +
          '多半是某个页面 / 大库又被同步 import 进来了。',
      );
    }
  }

  // 首屏合计：index.html 引到的文件 + 顺着静态 import 递归下去
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const seeds = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) seeds.add(m[1].replace(/^\//, '').replace('assets/', ''));
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.js)"/g)) seeds.add(m[1].replace(/^\//, '').replace('assets/', ''));
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const full = path.join(ASSETS, f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/import\s*(?:[^"'\n]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  let raw = 0;
  let gz = 0;
  for (const f of seen) {
    const buf = fs.readFileSync(path.join(ASSETS, f));
    raw += buf.length / 1024;
    gz += zlib.gzipSync(buf).length / 1024;
  }
  sizeLine =
    `入口分包 ${entries.length ? entries[0].f + ' = ' + entries[0].kb.toFixed(0) + 'KB' : '-'}（上限 ${SIZE_LIMIT_KB}KB）；` +
    `首屏合计 ${seen.size} 个文件 = ${raw.toFixed(0)}KB（gzip ${gz.toFixed(0)}KB，上限 ${INITIAL_LIMIT_KB}/${INITIAL_GZIP_LIMIT_KB}KB）`;
  if (raw > INITIAL_LIMIT_KB || gz > INITIAL_GZIP_LIMIT_KB) {
    problems.push(
      `首屏合计 ${raw.toFixed(0)}KB / gzip ${gz.toFixed(0)}KB 超过上限 ` +
        `${INITIAL_LIMIT_KB}/${INITIAL_GZIP_LIMIT_KB}KB —— 检查是不是有页面 / 大库被同步 import 进了入口。` +
        '（确实是有意的，就把上面两个上限一起调高，并在注释里写清为什么。）',
    );
  }
}

if (problems.length) {
  console.error('[splitting] ✖ 路由分包回归：');
  for (const p of problems) console.error('            ' + p);
  console.error('            首屏多背 1MB 没人看得见，但所有人的启动都慢一截。');
  process.exit(1);
}
console.log(`[splitting] ✔ 页面全部懒加载（${lazyCount} 个）；${sizeLine}`);
