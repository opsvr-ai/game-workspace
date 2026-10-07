#!/usr/bin/env node
/**
 * 一键全站界面体检（把「改完必复查」做成一条命令）。
 *
 * 为什么要有它：
 *   2026-10-07 修「窄屏下表格被切掉」时发现：以前只按 1280 体检，1024 那几页是盲区。
 *   而人眼盯 74 个页面的截图根本不靠谱（缩放一下就误判）。所以把「逐页体检」固化下来：
 *   一次跑完 74 个页面 × 若干宽度，把「横向溢出 / 文字被截断 / 页面没标题」量成数字，
 *   **有任何一处就退出码 1** —— 改完 UI 自己先跑这一条，别让老板去发现。
 *
 * 用法（先开假后台，见 scripts/_mock_api.mjs）：
 *   node scripts/_sweep_ui.mjs                                  # 1024 + 1280，老板视角
 *   node scripts/_sweep_ui.mjs --widths=1280
 *   node scripts/_sweep_ui.mjs --pre=scripts/_shot_seed_companion.js
 *   node scripts/_sweep_ui.mjs --from-json=tmp_shots/b24/audit-1024.json   # 离线：只看已有结果
 *
 * 只允许打本地地址（和 scripts/_ui_audit.mjs 一样）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_FILE = path.join(ROOT, 'docs', 'WEB-ROUTES.json');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : d;
};
const base = opt('base', 'http://127.0.0.1:8123');
const pre = opt('pre', 'scripts/_shot_seed_owner.js');
const outDir = path.resolve(ROOT, opt('out', 'tmp_shots/sweep'));
const widths = String(opt('widths', '1024,1280')).split(',').map((s) => Number(s.trim())).filter(Boolean);
const fromJson = opt('from-json', '');

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
  console.error('只允许本地地址：' + base);
  process.exit(2);
}
if (!widths.length) {
  console.error('--widths 为空');
  process.exit(2);
}

/** 列表页（带 :id 的详情页要真实 id，跳过）。 */
function listRoutes() {
  const raw = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
  const routes = raw.routes || raw;
  return routes
    .filter((r) => r.kind === 'page' && !r.path.includes(':') && !r.path.includes('*'))
    .map((r) => r.path);
}

/** 不在 app 框架里的页面（登录 / 资料页 / 独立聊天窗）没有 .app-content，跳过。 */
function isOutOfShell(page) {
  return (page.issues || []).some((s) => String(s).includes('.app-content'));
}

function loadPages(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.pages || raw.results || [];
}

function collect(label, file) {
  const all = loadPages(file);
  const pages = all.map((p) => ({ ...p, width: label }));
  return pages;
}

let runs = [];
if (fromJson) {
  runs = [{ label: path.basename(fromJson), file: path.resolve(ROOT, fromJson.replace(/\\/g, '/')) }];
  if (!fs.existsSync(runs[0].file)) {
    console.error('找不到：' + runs[0].file);
    process.exit(2);
  }
} else {
  fs.mkdirSync(outDir, { recursive: true });
  const routes = listRoutes();
  console.log('[sweep] ' + routes.length + ' 个页面 × ' + widths.join('/') + ' 宽度 → ' + path.relative(ROOT, outDir));
  for (const w of widths) {
    const out = path.join(outDir, 'w' + w + '.json');
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', '_ui_audit.mjs'),
        '--base=' + base,
        '--pre=' + pre,
        '--w=' + w,
        '--h=' + (w >= 1280 ? 800 : 768),
        '--wait=1600',
        '--json=' + out,
        ...routes,
      ],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) {
      console.error('[sweep] ✘ ' + w + ' 宽这一轮体检本身没跑完（退出码 ' + r.status + '）');
      process.exit(1);
    }
    runs.push({ label: String(w), file: out });
  }
}

const problems = [];
let checked = 0;
let skipped = 0;
for (const run of runs) {
  for (const page of collect(run.label, run.file)) {
    if (isOutOfShell(page)) {
      skipped++;
      continue;
    }
    checked++;
    const bad = [];
    if ((page.overflow || []).length) bad.push('横向溢出 ' + page.overflow.length);
    if ((page.clipped || []).length) bad.push('文字被截断 ' + page.clipped.length);
    if (page.noTitle) bad.push('没有页面标题');
    if ((page.issues || []).length) bad.push('异常：' + page.issues.join('；'));
    if ((page.menuClipped || []).length) bad.push('侧栏菜单文字被截断 ' + page.menuClipped.length);
    if (bad.length) problems.push('  ' + run.label + 'px  ' + page.path + '  → ' + bad.join(' / '));
  }
}

console.log('\n[sweep] 体检了 ' + checked + ' 个「页面 × 宽度」组合，跳过 ' + skipped + ' 个不在框架里的页面（登录 / 资料 / 独立聊天窗）');
if (problems.length) {
  console.error('[sweep] ✘ 有 ' + problems.length + ' 处问题：');
  for (const p of problems) console.error(p);
  console.error('\n改法：横向溢出多为「列宽超出内容区却没写 scroll={{ x }}」（见 pnpm table-scroll:check）；');
  console.error('文字被截断多为容器太窄；没有标题说明这一页没走 PageHeader。');
  process.exit(1);
}
console.log('[sweep] ✔ 全部干净（横向溢出 / 文字截断 / 缺标题 都是 0）');
