#!/usr/bin/env node
/**
 * 统计卡冻结检查（配合 docs/REFACTOR-PLAN.md「统计卡统一」那一批）。
 *
 * 为什么要有它：
 *   设计规范里其实一直有「统计卡」这个东西（原 styles/global.css 的 `.stat-card`），
 *   但看板各写各的 —— 同一套系统里同时存在四种长相：
 *     ① 运营看板：自己写的 `Kpi`（白卡 + 左侧竖条 + 圆点标签）；
 *     ② 陪玩端首页：自己写的 `Kpi`（antd Card，没竖条没圆点）；
 *     ③ 客户看板：自己写的 `statCard()`（淡色底 + 同色描边）；
 *     ④ 支出审核：`<Card><Statistic /></Card>`（antd 默认样式）。
 *   老板在几个看板之间来回切，同一个「今日消费」一会儿一个长相。统一到
 *   `apps/web/src/components/StatCard.tsx` 之后，只要还能随手拼一个 div 或再写个
 *   `const Kpi = ...`，下一个看板就会抄回去 —— 所以这里把它冻成基线：**只能减、不能增**。
 *
 * 规则：
 *   ① 自己定义 `Kpi` / `statCard` 这类「统计卡」组件 → 一律改用 components/StatCard.tsx（基线 0）；
 *   ② `<Card>` 里直接放 `<Statistic>`（= 手写统计卡）→ 计数，只能减不能增。
 *      注意：`<Statistic>` 本身不违规 —— 详情面板 / 抽屉里那种「一个数字带说明」不算统计卡，
 *      只有「`<Card>` 包 `<Statistic>`」才是这次要收的形状。
 *   行尾写 `stat-card-manual-ok` 可豁免（真需要手拼时，写明理由）。
 *
 * 用法：
 *   node scripts/_check_stat_cards.mjs            # 只报告（列出还剩谁）
 *   node scripts/_check_stat_cards.mjs --check    # 与基线比对（CI 用）
 *   node scripts/_check_stat_cards.mjs --update   # 数量降下来后把基线调低
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'web', 'src');
const BASELINE_FILE = path.join(ROOT, 'docs', 'STAT-CARD-BASELINE.json');

/** 统计卡组件本身就在这里，允许它有内部实现。 */
const ALLOWED_FILES = new Set(['components/StatCard.tsx']);

/** 行尾写这个注释可豁免。 */
const ESCAPE = 'stat-card-manual-ok';

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

/** 去掉注释但保留行数（报错要指到真实行号）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function scan() {
  const detail = [];
  const byFile = {};
  let localImpl = 0;
  let cardStatistic = 0;

  for (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const text = stripComments(fs.readFileSync(abs, 'utf8'));
    const lines = text.split('\n');
    const lineOf = (idx) => text.slice(0, idx).split('\n').length;
    let n = 0;
    // ① 自己写一个统计卡组件
    lines.forEach((line, i) => {
      if (line.includes(ESCAPE)) return;
      if (/^\s*(?:const|function)\s+(?:Kpi|StatCard|statCard|MetricCard)\b/.test(line)) {
        n++;
        localImpl++;
        detail.push(`  自己写的统计卡组件  ${rel}:${i + 1}  → 改用 components/StatCard.tsx`);
      }
    });
    // ② <Card> 里直接放 <Statistic>（允许中间只有空白 / 换行 —— 手写统计卡两种写法都有）
    for (const m of text.matchAll(/<Card\b[^>]*>\s*<Statistic\b/g)) {
      const at = m.index ?? 0;
      if (lines[lineOf(at) - 1].includes(ESCAPE)) continue;
      n++;
      cardStatistic++;
      detail.push(`  <Card><Statistic/>   ${rel}:${lineOf(at)}  → 改用 components/StatCard.tsx`);
    }
    if (n) byFile[rel] = n;
  }
  return { localImpl, cardStatistic, total: localImpl + cardStatistic, byFile, detail };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { localImpl: 0, cardStatistic: 0, total: 0 };
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

const args = process.argv.slice(2);
const result = scan();
const baseline = loadBaseline();

if (args.includes('--update')) {
  fs.writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        _comment:
          '统计卡基线：自己写的统计卡组件（Kpi/statCard/MetricCard）+「<Card><Statistic/>」写法，只能减不能增。统一用 apps/web/src/components/StatCard.tsx。降下来后跑 node scripts/_check_stat_cards.mjs --update 调低。',
        _updatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
        localImpl: result.localImpl,
        cardStatistic: result.cardStatistic,
        total: result.total,
        byFile: result.byFile,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`[stat-cards] 基线已更新：自己写的组件 ${result.localImpl} / <Card><Statistic/> ${result.cardStatistic}`);
  console.log(`[stat-cards] → ${path.relative(ROOT, BASELINE_FILE)}`);
  process.exit(0);
}

const head = `[stat-cards] 自己写的统计卡组件 ${result.localImpl} / <Card><Statistic/> ${result.cardStatistic}（合计 ${result.total}）`;

if (!args.includes('--check')) {
  console.log(head);
  for (const line of result.detail) console.log(line);
  console.log('\n统一写法见 apps/web/src/components/StatCard.tsx（实物在 /ui-kit 的「卡片 / 统计卡」）。');
  process.exit(0);
}

const problems = [];
if (result.localImpl > (baseline.localImpl ?? 0)) {
  problems.push(`自己写的统计卡组件变多了：${result.localImpl} > 基线 ${baseline.localImpl}`);
}
if (result.cardStatistic > (baseline.cardStatistic ?? 0)) {
  problems.push(`<Card><Statistic/> 变多了：${result.cardStatistic} > 基线 ${baseline.cardStatistic}`);
}

if (problems.length) {
  console.error('[stat-cards] ✘ ' + head);
  for (const line of result.detail) console.error(line);
  for (const p of problems) console.error('  ' + p);
  console.error('\n改法：看板上的大数字一律用 components/StatCard.tsx（label / value / sub / tint，');
  console.error('淡色底那套用 variant="tinted"）。确有必要手拼的，行尾写 ' + ESCAPE + ' 并写明理由。');
  process.exit(1);
}
console.log(
  `[stat-cards] ✔ 没变多（自己写的 ${result.localImpl} / 基线 ${baseline.localImpl ?? 0}；` +
    `<Card><Statistic/> ${result.cardStatistic} / 基线 ${baseline.cardStatistic ?? 0}）`,
);