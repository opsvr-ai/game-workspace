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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = path.join(ROOT, 'apps', 'web', 'src', 'router.tsx');
const ASSETS = path.join(ROOT, 'apps', 'web', 'dist', 'assets');
/** 入口分包上限（KB）。当前约 347KB，留了点余量；同步塞回 2~3 个页面就会超。 */
const SIZE_LIMIT_KB = 512;
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

// 有构建产物就顺便量一下入口包
let sizeLine = '（没找到构建产物，跳过体积检查；先 pnpm --filter @chunlv/web build）';
if (fs.existsSync(ASSETS)) {
  const entries = fs
    .readdirSync(ASSETS)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, kb: fs.statSync(path.join(ASSETS, f)).size / 1024 }));
  if (entries.length) {
    const biggest = entries.sort((a, b) => b.kb - a.kb)[0];
    sizeLine = `入口分包 ${biggest.f} = ${biggest.kb.toFixed(0)}KB（上限 ${SIZE_LIMIT_KB}KB）`;
    if (biggest.kb > SIZE_LIMIT_KB) {
      problems.push(
        `入口分包 ${biggest.kb.toFixed(0)}KB 超过上限 ${SIZE_LIMIT_KB}KB —— ` +
          '多半是某个页面 / 大库又被同步 import 进来了。',
      );
    }
  }
}

if (problems.length) {
  console.error('[splitting] ✖ 路由分包回归：');
  for (const p of problems) console.error('            ' + p);
  console.error('            首屏多背 1MB 没人看得见，但所有人的启动都慢一截。');
  process.exit(1);
}
console.log(`[splitting] ✔ 页面全部懒加载（${lazyCount} 个）；${sizeLine}`);
