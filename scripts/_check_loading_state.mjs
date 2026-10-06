#!/usr/bin/env node
/**
 * 加载态冻结检查（配合 docs/REFACTOR-PLAN.md「加载态统一」那一批）。
 *
 * 为什么要有它：
 *   全站的「正在加载」原来有四种画法 —— 光秃秃一个转圈飘在白框中间、
 *   `<Spin tip="加载中...">`、塞进 `<Card>` 再补一句 `padding: 50`、
 *   有的地方干脆拿空态插画冒充加载中。同一种「还没来」在不同页面长得都不一样，
 *   而且没有一处写明最少占多高，于是**一加载整页就跳一下**。
 *   统一到 LoadingState 之后，只要还能随手写裸 `<Spin />`，下一个页面就会照抄回去 ——
 *   所以这里把「裸转圈」冻成基线：只能减、不能增。
 *
 * 规则：
 *   - 裸的 `<Spin />` / `<Spin size="large" />`（不是 `<Spin spinning>` 那种「刷新遮罩」，
 *     那是另一种语义，不算）→ 一律改用 components/LoadingState.tsx；
 *   - 骨架屏（`<Skeleton>`）**不算违规**：形状可预判的地方（表单 / 详情页 / 表格）
 *     骨架屏比转圈更稳、看着更「快」；优先用共用的 TableSkeleton / CardSkeleton。
 *
 * 用法：
 *   node scripts/_check_loading_state.mjs            # 只报告
 *   node scripts/_check_loading_state.mjs --check    # 与基线比对（CI 用）
 *   node scripts/_check_loading_state.mjs --update   # 数量降下来后把基线调低
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'web', 'src');
const BASELINE_FILE = path.join(ROOT, 'docs', 'LOADING-STATE-BASELINE.json');

/** 这几个文件本来就该画转圈 —— 它们是「统一加载态」的实现处。 */
const ALLOWED_FILES = new Set([
  'components/LoadingState.tsx',
  'components/CardSkeleton.tsx',
  'components/TableSkeleton.tsx',
]);

/** 行尾写这个注释可豁免（真需要手写转圈时，写明理由）。 */
const ESCAPE = 'loading-manual-ok';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉注释，但**保留行数**（报错要指到真实行号）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function scan() {
  const byFile = {};
  const detail = [];
  let bareSpin = 0;
  let skeleton = 0;

  for (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const lines = stripComments(fs.readFileSync(abs, 'utf8')).split('\n');
    let n = 0;
    lines.forEach((line, i) => {
      if (line.includes(ESCAPE)) return;
      for (const m of line.matchAll(/<Spin\b[^>]*>/g)) {
        if (/\bspinning\b/.test(m[0])) continue;
        n++;
        bareSpin++;
        detail.push(`  裸 <Spin />          ${rel}:${i + 1}`);
      }
      for (const _ of line.matchAll(/<Skeleton\b/g)) {
        void _;
        skeleton++;
        detail.push(`  骨架屏 <Skeleton />   ${rel}:${i + 1}`);
      }
    });
    if (n) byFile[rel] = n;
  }
  return { bareSpin, skeleton, byFile, detail };
}

const args = new Set(process.argv.slice(2));
const result = scan();

if (args.has('--update')) {
  const payload = {
    _comment:
      '加载态基线：页面 / 组件里**裸写的 <Spin />** 只能减不能增。' +
      '统一用 apps/web/src/components/LoadingState.tsx（形状可预判时用 TableSkeleton / CardSkeleton）。' +
      '降下来后跑 node scripts/_check_loading_state.mjs --update 调低。',
    _updatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10),
    bareSpin: result.bareSpin,
    total: result.bareSpin,
    byFile: result.byFile,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[loading] 基线已更新：裸 Spin=${result.bareSpin}`);
  process.exit(0);
}

if (args.has('--check')) {
  const base = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : null;
  if (!base) {
    console.error('[loading] 找不到基线文件，先跑一次 --update');
    process.exit(1);
  }
  if (result.bareSpin > (base.bareSpin ?? 0)) {
    console.error(
      `[loading] ✖ 裸写的 <Spin /> 变多了：${base.bareSpin ?? 0} → ${result.bareSpin}（+${result.bareSpin - (base.bareSpin ?? 0)}）`,
    );
    for (const [f, n] of Object.entries(result.byFile)) {
      const b = (base.byFile && base.byFile[f]) || 0;
      if (n > b) console.error(`            ${f}  ${b} → ${n}`);
    }
    console.error(
      '            「正在加载」请用 apps/web/src/components/LoadingState.tsx；' +
        '形状可预判（表格 / 卡片）用 TableSkeleton / CardSkeleton。' +
        '确实要手写转圈，就在那一行写 // ' + ESCAPE + ' 并说明理由。',
    );
    process.exit(1);
  }
  console.log(
    `[loading] ✔ 没变多（裸 Spin ${result.bareSpin} / 基线 ${base.bareSpin ?? 0}）` +
      `；另有 ${result.skeleton} 处骨架屏（允许）`,
  );
  process.exit(0);
}

console.log(`[loading] 裸 <Spin /> ${result.bareSpin} 处，骨架屏 ${result.skeleton} 处`);
for (const d of result.detail) console.log(d);
