#!/usr/bin/env node
/**
 * 提示层出口冻结（docs/REFACTOR-PLAN.md P2-8「反馈层无统一出口」）。
 *
 * 为什么要有它：全站 600 多处提示以前都写 import { message } from 'antd' 直接调。
 * 谁都能弹、弹完就走 —— 于是「同一句话连着弹两条」「想改提示时长得全局搜 600 处」
 * 这类问题没法收口。统一到 apps/web/src/utils/feedback.ts 之后，只要还能从 'antd'
 * 直接 import，下一个人就会照抄回去 —— 所以这里把它冻成 0：**一个都不许留**。
 *
 * 规则：
 *   从 'antd'（或 'antd/es/message' / 'antd/lib/message'）import message → 违规。
 *   改成：import { message } from '<相对路径>/utils/feedback'（调用点一个字不用改）。
 *   确有必要（例如就是在测 antd 本身），行尾写 feedback-layer-ok 并写理由。
 *
 * 用法：
 *   node scripts/_check_feedback_layer.mjs           # 报告
 *   node scripts/_check_feedback_layer.mjs --check   # CI 用（有违规即退出码 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'web', 'src');
const BASELINE_FILE = path.join(ROOT, 'docs', 'FEEDBACK-LAYER-BASELINE.json');

/** 提示层自己当然要从 antd 拿真身。 */
const ALLOWED_FILES = new Set(['utils/feedback.ts']);

const ESCAPE = 'feedback-layer-ok';

const ANTD_SOURCES = new Set(['antd', 'antd/es/message', 'antd/lib/message']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function scan() {
  const detail = [];
  let count = 0;
  for (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const text = stripComments(fs.readFileSync(abs, 'utf8'));
    const lines = text.split('\n');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      const names = m[1];
      const src = m[2];
      if (!ANTD_SOURCES.has(src)) continue;
      if (!/(?<![A-Za-z0-9_$])message(?![A-Za-z0-9_$])/.test(names)) continue;
      const at = (m.index ?? 0);
      const lineNo = text.slice(0, at).split('\n').length;
      if (lines[lineNo - 1].includes(ESCAPE)) continue;
      count++;
      detail.push(
        '  从 ' + src + " 直接 import message  " + rel + ':' + lineNo +
          "  → 改用 utils/feedback（调用点不用改）",
      );
    }
  }
  return { count, detail };
}

const args = process.argv.slice(2);
const result = scan();

if (args.includes('--update')) {
  fs.writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        _comment:
          '提示层出口基线：从 antd 直接 import message 的地方（目标恒为 0）。全部走 apps/web/src/utils/feedback.ts。',
        _updatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
        count: result.count,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log('[feedback] 基线已更新：' + result.count);
  process.exit(0);
}

const head = '[feedback] 从 antd 直接 import message 的地方 ' + result.count + ' 处（目标 0）';

if (!args.includes('--check')) {
  console.log(head);
  for (const line of result.detail) console.log(line);
  console.log('\n统一出口见 apps/web/src/utils/feedback.ts（同名同形，调用点不用改；同一句话 2.5 秒内只弹一次）。');
  process.exit(0);
}

if (result.count > 0) {
  console.error('[feedback] ✘ ' + head);
  for (const line of result.detail) console.error(line);
  console.error('\n改法：import { message } from "<相对路径>/utils/feedback";——调用点一个字都不用改。');
  console.error('确有必要（就是在测 antd 本身）的，行尾写 ' + ESCAPE + ' 并写明理由。');
  process.exit(1);
}
console.log('[feedback] ✔ 提示只有一个出口（全部走 utils/feedback）');
