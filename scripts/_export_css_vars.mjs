#!/usr/bin/env node
/**
 * index.css 里 :root 兜底块（CSS 变量）的自动生成 / 校验。
 *
 * 为什么要有它：
 *   tokens.ts 是颜色的唯一真源，但「JS 还没跑起来」的那一瞬间（首屏）页面读不到令牌，
 *   所以 index.css 里要放一份**字面量**兜底值。以前这份兜底是手抄的，抄漏了没人知道 ——
 *   2026-10-07 就抓到两个：--grad-brand-hover / --grad-brand-active 根本没人定义，
 *   于是「主按钮悬浮变亮」这条规则里的 background: var(--grad-brand-hover) !important
 *   是**无效声明**，浏览器直接丢掉 —— 悬浮态从来就没生效过，而且不报错。
 *
 *   所以这里反过来：从 tokens.ts 算出全部 CSS 变量，直接写进 index.css 的标记区，
 *   既能保证兜底不漏，又顺手校验「CSS 里 var(--x) 用到的变量必须真有定义」。
 *
 * 用法：
 *   node scripts/_export_css_vars.mjs            # 重新生成 index.css 的 :root 区
 *   node scripts/_export_css_vars.mjs --check    # CI：与文件比对 + 变量定义完整性检查
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');
const TOKENS_FILE = path.join(WEB_SRC, 'styles', 'tokens.ts');
const TARGET_FILE = path.join(WEB_SRC, 'index.css');

const MARK_BEGIN =
  '/* ↓↓↓ 以下 :root 由 scripts/_export_css_vars.mjs 从 styles/tokens.ts 生成 —— 勿手改，改 tokens.ts 后跑 pnpm css:vars ↓↓↓ */';
const MARK_END = '/* ↑↑↑ 生成结束 ↑↑↑ */';

/** 把 tokens.ts 当纯 JS 跑一遍，拿到 CSS_VARS。 */
function loadCssVars() {
  let src = fs.readFileSync(TOKENS_FILE, 'utf8');
  src = src.replace(/\/\*\*[\s\S]*?\*\//g, ''); // 文档注释（含表达式说明，不影响求值）
  src = src.split('function applyTokenCssVars')[0]; // 生成器函数本身不用求值
  src = src.replace(/^export\s+/gm, '');
  src = src.replace(/\bas const\b/g, '');
  // tokens.ts 只允许这些 TS 语法（多出来的写法要在下面补规则，否则这里直接报错）：
  //   1) 对象字面量 + \`as const\`  2) \`Record<string, string>\` 类型标注
  //   3) 函数的参数类型与返回值类型（比如 badgeGlow(color: string): string）
  src = src.replace(/:\s*Record<[^>]*>/g, '');
  src = src.replace(/\)\s*:\s*[A-Za-z_$][\w$<>|[\]., ]*\s*\{/g, ') {');
  src = src.replace(/([A-Za-z_$][\w$]*)\s*:\s*(string|number|boolean|void)\s*(?=[,)])/g, '$1');
  try {
    // eslint-disable-next-line no-new-func
    return new Function(src + '\nreturn CSS_VARS;')();
  } catch (e) {
    console.error('[css-vars] ✖ 读不懂 apps/web/src/styles/tokens.ts：' + e.message);
    console.error('            这个脚本用「剥掉类型标注再当 JS 跑」的办法取值，tokens.ts 里出现了它没见过的 TS 写法。');
    console.error('            往 scripts/_export_css_vars.mjs 的 loadCssVars() 里补一条剥离规则即可。');
    process.exit(1);
  }
}

/** 生成 marker 之间的文本。 */
function render(cssVars) {
  const lines = [MARK_BEGIN, ':root {'];
  for (const [name, value] of Object.entries(cssVars)) {
    lines.push(`  ${name}: ${value};`);
  }
  lines.push('}', MARK_END);
  return lines.join('\n');
}

/** 扫一遍 CSS，返回「用了 var(--x) 但没人定义、也没写兜底」的清单。 */
function findUndefinedVars(cssVars) {
  const defined = new Set(Object.keys(cssVars));
  const missing = new Map();
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        out.push(...walk(full));
      } else if (entry.name.endsWith('.css')) out.push(full);
    }
    return out;
  };
  const files = walk(WEB_SRC);
  // CSS 自己也能定义变量（比如 global.css 里那三个 --data-* 字号），一并算「已定义」
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
  }
  for (const file of files) {
    const rel = path.relative(WEB_SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)([^)]*)\)/g)) {
      if (defined.has(m[1]) || m[2].includes(',')) continue;
      if (!missing.has(m[1])) missing.set(m[1], new Set());
      missing.get(m[1]).add(rel);
    }
  }
  return missing;
}

const check = process.argv.slice(2).includes('--check');
const cssVars = loadCssVars();
const block = render(cssVars);
const raw = fs.readFileSync(TARGET_FILE, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const begin = raw.indexOf(MARK_BEGIN);
const end = raw.indexOf(MARK_END);

const missing = findUndefinedVars(cssVars);
if (missing.size) {
  console.error('[css-vars] ✖ 有变量用了但没定义（var 里也没写兜底）：');
  for (const [name, files] of missing) console.error(`            ${name}  ←  ${[...files].join(', ')}`);
  console.error('            请在 apps/web/src/styles/tokens.ts 里补上，再跑 pnpm css:vars');
  process.exit(1);
}

if (begin === -1 || end === -1) {
  console.error('[css-vars] ✖ index.css 里找不到生成标记，先手工加上下面两行再跑：');
  console.error('            ' + MARK_BEGIN);
  console.error('            ' + MARK_END);
  process.exit(1);
}

const current = raw.slice(begin, end + MARK_END.length).split(nl).join('\n');

if (!check) {
  fs.writeFileSync(TARGET_FILE, raw.slice(0, begin) + block + raw.slice(end + MARK_END.length), 'utf8');
  console.log(`[css-vars] ✔ 已写入 ${Object.keys(cssVars).length} 个变量 → apps/web/src/index.css`);
  process.exit(0);
}

if (current !== block) {
  console.error('[css-vars] ✖ index.css 里的 :root 兜底和 tokens.ts 不一致 —— 跑 pnpm css:vars 重新生成');
  const cur = current.split('\n');
  const want = block.split('\n');
  for (let i = 0; i < Math.max(cur.length, want.length); i++) {
    if (cur[i] !== want[i]) {
      console.error(`            第 ${i + 1} 行：文件里是 ${JSON.stringify(cur[i])}，应该是 ${JSON.stringify(want[i])}`);
      break;
    }
  }
  process.exit(1);
}
console.log(`[css-vars] ✔ index.css 的 :root 与 tokens.ts 一致（${Object.keys(cssVars).length} 个变量）`);
