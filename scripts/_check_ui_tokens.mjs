#!/usr/bin/env node
/**
 * UI 硬编码色值冻结检查（配合 docs/REFACTOR-PLAN.md 第 15.3 节 P2-7）。
 *
 * 为什么要有它：
 *   界面「漂移」的根因是颜色到处手写 —— 曾经同时存在三套主色（品牌紫 #7C4DFF、
 *   Ant Design 默认蓝 #1677ff、另一个蓝 #2563EB）在打架。光靠「这次清一批」不够，
 *   只要还能随手写十六进制色值，过不了多久又会漂回去。
 *
 *   所以这里把当前剩余数量「冻结」成一个基线：CI 每次都比一遍，
 *   **只能减、不能增** —— 谁新写了硬编码色值，CI 直接红，改动的人自己看得见。
 *   数量真的降下来了，跑 `--update` 把基线调低（这一步是有意的，逼着人想清楚）。
 *
 * 唯一真源：apps/web/src/styles/tokens.ts（页面 / 组件从这里取，或读 var(--color-*)）。
 *
 * 用法：
 *   node scripts/_check_ui_tokens.mjs            # 只报告（数量 / 分布 / 重灾区）
 *   node scripts/_check_ui_tokens.mjs --check    # 与基线比对（CI 用）；变多则退出码 1
 *   node scripts/_check_ui_tokens.mjs --update   # 把当前数量写回基线（只应在数量下降后跑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'web', 'src');
const BASELINE_FILE = path.join(ROOT, 'docs', 'UI-TOKEN-BASELINE.json');

/**
 * 这几个文件本来就该「写死色值」，不算违规：
 *  - styles/tokens.ts    设计令牌层（唯一真源，色值就定义在这）
 *  - styles/commander.ts 陪玩端窗口那套深色主题的调色板
 *  - index.css           `:root` 的「首屏兜底」（必须写死，否则自己引用自己等于没定义）
 */
const ALLOWED_FILES = new Set([
  'styles/tokens.ts',
  'styles/commander.ts',
  'index.css',
]);

const HEX_COLOR = /#[0-9A-Fa-f]{3,8}\b/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉注释：块注释整段去掉，行首 `//` 的整行去掉（不动字符串里的 http:// 那种）。 */
function stripComments(text, isCss) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return out;
}

/** 扫一遍，返回每文件命中数 + 出现的不同色值。 */
function scan() {
  const byFile = {};
  const distinct = new Set();
  let total = 0;

  for (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const text = stripComments(raw, rel.endsWith('.css'));
    const hits = text.match(HEX_COLOR);
    if (!hits) continue;
    byFile[rel] = hits.length;
    total += hits.length;
    for (const h of hits) distinct.add(h.toUpperCase());
  }
  return { total, distinct: distinct.size, byFile };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

const args = new Set(process.argv.slice(2));
const result = scan();
const top = Object.entries(result.byFile).sort((a, b) => b[1] - a[1]);

if (args.has('--update')) {
  const payload = {
    _comment:
      'UI 硬编码色值基线。只能减不能增；降下来后跑 node scripts/_check_ui_tokens.mjs --update 调低。',
    // 本地日期（Asia/Shanghai），跟 CHANGELOG 的日期对得上
    _updatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10),
    total: result.total,
    distinct: result.distinct,
    byFile: Object.fromEntries(top),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[ui-tokens] 基线已更新：total=${result.total} distinct=${result.distinct}`);
  console.log(`[ui-tokens] → ${path.relative(ROOT, BASELINE_FILE).split(path.sep).join('/')}`);
  process.exit(0);
}

const distinctList = [...new Set([...Object.keys(result.byFile)])];

if (args.has('--check')) {
  const base = loadBaseline();
  if (!base) {
    console.error('[ui-tokens] 找不到基线文件，先跑一次 --update');
    process.exit(1);
  }
  if (result.total > base.total) {
    console.error(
      `[ui-tokens] ✖ 硬编码色值变多了：${base.total} → ${result.total}（+${result.total - base.total}）`,
    );
    // 指出是哪些文件变多了，方便直接定位
    const increased = top.filter(([f, n]) => n > (base.byFile[f] || 0));
    for (const [f, n] of increased.slice(0, 20)) {
      console.error(`            ${f}  ${base.byFile[f] || 0} → ${n}`);
    }
    console.error(
      '            颜色请从 apps/web/src/styles/tokens.ts 取，或读 var(--color-*)。',
    );
    process.exit(1);
  }
  const delta = base.total - result.total;
  if (delta > 0) {
    console.log(
      `[ui-tokens] ✔ 没变多（还少了 ${delta}）。当前 ${result.total} / 基线 ${base.total}；` +
        '可以把基线调低：node scripts/_check_ui_tokens.mjs --update',
    );
  } else {
    console.log(`[ui-tokens] ✔ 没变多（当前 ${result.total} / 基线 ${base.total}）`);
  }
  process.exit(0);
}

// 默认：只报告
console.log(`[ui-tokens] 硬编码色值：${result.total} 处，${result.distinct} 个不同色值`);
console.log(`[ui-tokens] 涉及 ${distinctList.length} 个文件；重灾区：`);
for (const [f, n] of top.slice(0, 25)) console.log(`            ${String(n).padStart(4)}  ${f}`);
