#!/usr/bin/env node
/**
 * 表格横滚兜底检查（配合 docs/REFACTOR-PLAN.md 第 24 批）。
 *
 * 为什么要有它：
 *   1024 宽的窗口下，内容区真正能用的宽度只有 763px 左右（左侧栏 216px + 卡片内边距）。
 *   表格的列一旦按 `width` 写死、合计超过这个数，它就会「比卡片还宽」—— 而 antd 只有在
 *   写了 `scroll={{ x }}` 时才会给表格套一层横向滚动（`overflow-x: auto`）。
 *   没写就是硬溢出：右边那几列（通常是「操作」）**直接被切掉，连滚都滚不到**。
 *   2026-10-07 的界面体检就是这么发现的 —— 工作室管理页的「操作」列整列看不见。
 *
 * 规则：
 *   `<Table>` 没有 `scroll` 属性时，把它的列宽（`columns` 里的数字 `width`）加起来；
 *   合计 > 760 就是缺陷：**要么加 scroll={{ x: <合计> }}，要么减列**。
 *   这一条只认「写死的数字宽度」—— `width: someVar` 这种静态算不出来的，只报告、不判红，
 *   免得误伤（报在「未能判定」那一栏里，人工看一眼）。
 *   确实不需要横滚的（例如只有 1~2 列、或者表格在很宽的弹窗里），在 `<Table` 那一行写
 *   table-scroll-ok 并说明理由。
 *
 * 用法：
 *   node scripts/_check_table_scroll.mjs            # 只报告
 *   node scripts/_check_table_scroll.mjs --check    # CI 用；有超宽表格退出码 1
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'web', 'src');
const require = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'));
const ts = require('typescript');

/** 1024 宽窗口下内容区可用宽度实测约 763px；取 760 作为「必须给横滚兜底」的线。 */
const LIMIT = 760;
const ESCAPE = 'table-scroll-ok';

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

/** 剥掉 `as any` / 括号 / 非空断言这些壳，露出真正的表达式。 */
function unwrap(node) {
  let n = node;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  return n;
}

/** 从 `useMemo(() => [...], [])` 里把那份数组掏出来。 */
function resolveArray(node) {
  const e = unwrap(node);
  if (ts.isArrayLiteralExpression(e)) return e;
  if (ts.isCallExpression(e)) {
    const callee = e.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    if (name === 'useMemo' && e.arguments.length) {
      const fn = unwrap(e.arguments[0]);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        const body = unwrap(fn.body);
        if (ts.isArrayLiteralExpression(body)) return body;
        if (ts.isBlock(body)) {
          for (const st of body.statements) {
            if (ts.isReturnStatement(st) && st.expression) {
              const r = unwrap(st.expression);
              if (ts.isArrayLiteralExpression(r)) return r;
            }
          }
        }
      }
    }
  }
  return null;
}

/** 把文件里所有「变量 = 数组字面量」记下来，供 `columns={xxx}` 反查。 */
function collectArrayVars(sf) {
  const map = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      const arr = resolveArray(node.initializer);
      if (arr && !map.has(node.name.text)) map.set(node.name.text, arr);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return map;
}

/** 数一份 columns 数组里的数字宽度。 */
function sumWidths(sf, arr) {
  let sum = 0;
  let cols = 0;
  let unknown = 0;
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!prop.name || prop.name.getText(sf) !== 'width') continue;
      if (ts.isNumericLiteral(prop.initializer)) sum += Number(prop.initializer.text);
      else unknown += 1;
      cols += 1;
    }
  }
  return { sum, cols, unknown };
}

function scan() {
  const over = [];
  const unknown = [];
  for (const abs of walk(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    const text = fs.readFileSync(abs, 'utf8');
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const arrVars = collectArrayVars(sf);
    const lines = text.split(/\r?\n/);
    const visit = (node) => {
      const isJsx = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
      if (isJsx) {
        const tag = node.tagName.getText(sf);
        if (tag === 'Table' || /\.Table$/.test(tag)) {
          const attrs = node.attributes.properties;
          const names = attrs.map((a) => a.name && a.name.getText(sf)).filter(Boolean);
          if (!names.includes('scroll')) {
            const start = node.getStart(sf);
            const line = sf.getLineAndCharacterOfPosition(start).line;
            const escaped = (lines[line] || '').includes(ESCAPE) || (lines[line - 1] || '').includes(ESCAPE);
            const colAttr = attrs.find((a) => a.name && a.name.getText(sf) === 'columns');
            let info = { sum: 0, cols: 0, unknown: 0, how: '没写 columns' };
            const init = colAttr && colAttr.initializer;
            if (init && ts.isJsxExpression(init) && init.expression) {
              const e = unwrap(init.expression);
              const inline = resolveArray(e);
              if (inline) {
                info = { ...sumWidths(sf, inline), how: '内联数组' };
              } else if (ts.isIdentifier(e) && arrVars.has(e.text)) {
                info = { ...sumWidths(sf, arrVars.get(e.text)), how: e.text };
              } else {
                info = { sum: 0, cols: 0, unknown: 1, how: '表达式（算不出）' };
              }
            }
            if (!escaped) {
              const where = rel + ':' + (line + 1);
              if (info.unknown > 0 && info.sum === 0) unknown.push('  ' + where + '  columns=' + info.how + '（宽度不是写死的数字，静态算不出，人工看一眼）');
              else if (info.sum > LIMIT) over.push({ where, sum: info.sum, cols: info.cols, how: info.how, unknown: info.unknown });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  over.sort((a, b) => b.sum - a.sum);
  return { over, unknown };
}

const args = process.argv.slice(2);
const result = scan();
const head = '[table-scroll] 列宽超过 ' + LIMIT + ' 却没开横向滚动的表格：' + result.over.length + ' 张';

if (!args.includes('--check')) {
  console.log(head);
  for (const o of result.over) {
    console.log('  ' + o.where + '  列宽合计 ' + o.sum + '（' + o.cols + ' 列' + (o.unknown ? '，另有 ' + o.unknown + ' 列宽度算不出' : '') + '，来自 ' + o.how + '）');
  }
  if (result.unknown.length) {
    console.log('\n未能判定（仅供参考，不判红）：');
    for (const u of result.unknown) console.log(u);
  }
  console.log('\n改法：给这个 <Table> 加 scroll={{ x: <列宽合计> }}（1024 宽窗口下能横着滚，不被切掉）；');
  console.log('或者把次要列收起来。确实不需要横滚的，在 <Table 那一行写 ' + ESCAPE + ' 并说明理由。');
  process.exit(0);
}

if (result.over.length) {
  console.error('[table-scroll] ✘ ' + head);
  for (const o of result.over) {
    console.error('  ' + o.where + '  列宽合计 ' + o.sum + '（' + o.cols + ' 列，来自 ' + o.how + '）→ 加 scroll={{ x: ' + o.sum + ' }} 或减列');
  }
  console.error('\n说明：1024 宽窗口下内容区可用宽度实测约 763px（左侧栏 216px + 卡片内边距）。');
  console.error('表格列宽合计超过它、又没写 scroll={{ x }} 时，antd 不会给横滚，右边几列会被直接切掉。');
  process.exit(1);
}
console.log('[table-scroll] ✔ 没有超宽表格（列宽合计 > ' + LIMIT + ' 的：0 张）');
if (result.unknown.length) console.log('[table-scroll] 另有 ' + result.unknown.length + ' 张表的列宽静态算不出（不判红）');
