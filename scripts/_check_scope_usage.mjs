#!/usr/bin/env node
/**
 * 服务端「裸 studioId 作用域条件」冻结检查（配合统一作用域 `apps/server/src/common/scope.ts`）。
 *
 * 为什么要有它：
 *   作用域（这条数据该给哪个身份看）以前是每个 service 各写一遍：
 *   `studioId ? { studioId } : {}`、`where.studioId = user.studioId`、
 *   `studioId: { in: [own, ...bridged] }`……同一个意思十几种写法，多写一个 `!` 就是一次越权、
 *   少写一个就是一次空看板（老板 2026-10-04 报的「全站老板点排行榜 500」就是这么来的）。
 *   光靠「这次清一批」不够：只要还能随手往 where 里写 `studioId`，过一阵又会散回去。
 *
 *   所以把当前剩余数量「冻结」成基线：CI 每次比一遍，**只能减、不能增**。
 *   数字真降下来了，跑 `--update` 把基线调低（有意留一步，逼着人想清楚）。
 *   **不要为了降数字去改业务语义** —— 统计口径见下，改语义的「优化」会被 review 挡回来。
 *
 * 统计口径（AST 级，不是 grep：字符串 / 注释里的 = 不算，「读字段」也不算）：
 *   A. 对象字面量里键名为 `studioId` 的成员（含简写 `{ studioId }`），且它处于**查询条件**上下文；
 *   B. `xxx.studioId = ...` 赋值语句（`where.studioId` / `claimedWhere.studioId` 这类）；
 *   以下**不算**（不是「过滤条件」）：
 *   - `select: { studioId: true }` / `include` —— 只是取字段；
 *   - `data:` / `create:` / `update:` 载荷 —— 是写入值，不是作用域；
 *   - 类型定义（interface / type 里的 `studioId: string`）—— 不是运行时条件；
 *   - 测试 / mock（`__tests__`、`__mocks__`）—— 测试本来就要构造各种 studioId。
 *
 * 用法：
 *   node scripts/_check_scope_usage.mjs            # 只报告（总数 / 分布 / 迁移进度）
 *   node scripts/_check_scope_usage.mjs --check    # 与基线比对（CI 用）；变多则退出码 1
 *   node scripts/_check_scope_usage.mjs --update   # 把当前数量写回基线（只应在数量下降后跑）
 *   node scripts/_check_scope_usage.mjs --json     # 机器可读输出（给 CI / 看板用）
 *
 * 退出码：0 = 正常 / 没变多；1 = 变多 / 找不到基线 / 拒绝写更高的基线。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'server', 'src');
const SERVER_DIR = path.join(ROOT, 'apps', 'server');
// 基线放在 docs/（跟 UI-TOKEN / STAT-CARD 等守门基线同一处）：
// scripts/ 下 `_*` 默认被 .gitignore 忽略，基线放这里才不会「本地有、CI 没有」。
const BASELINE_FILE = path.join(ROOT, 'docs', 'SCOPE-USAGE-BASELINE.json');

// typescript 是 apps/server 的 devDependency（pnpm 不会 hoist 到根），从 server 包解析。
const requireFromServer = createRequire(path.join(SERVER_DIR, 'package.json'));
const ts = requireFromServer('typescript');

/** 这些对象属性下面的 `studioId:` 不是作用域过滤条件（取字段 / 写载荷 / 排序）。 */
const NON_FILTER_KEYS = new Set([
  'select',
  'include',
  'omit',
  'data',
  'create',
  'update',
  'upsert',
  'createMany',
  'updateMany',
  'orderBy',
]);

/** 这些属性名下面的 `studioId:` 才是过滤条件（Prisma where / OR / AND / NOT）。 */
const FILTER_KEYS = new Set(['where', 'OR', 'AND', 'NOT']);

/** 变量名 / 属性名像「条件容器」的，也算过滤上下文（`const where = {...}`）。 */
const FILTER_NAME_RE = /where|filter|scope|cond|who/i;

/** 统计「已迁移」用的帮助函数名（scope.ts 对外导出的那些）。 */
const SCOPE_HELPERS = [
  'scopeWhere',
  'visibleStudioIds',
  'assertStudioAccess',
  'canAccessStudio',
  'selfWhere',
  'actorOfUser',
  'actorOfStudio',
];
const SCOPE_HELPER_RE = new RegExp(`\\b(${SCOPE_HELPERS.join('|')})\\s*\\(`, 'g');

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__']);

/**
 * 这些文件里的 `studioId` 不是「业务作用域」，而是**配置存储的行键**：
 * `StudioConfig` 表本来就是 `(studioId, key)` 唯一，按 studioId 取/删配置行天经地义，
 * 不属于本脚本要收敛的「谁能看什么数据」。其它文件一律不许裸写。
 */
const ALLOWED_FILES = new Set(['common/studio-config.ts']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function propName(nameNode) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return null;
}

/**
 * 判断一个 `studioId` 成员是不是「作用域过滤条件」：
 *  - 落在 `select` / `data` 这类非过滤成员下面 → 不是；
 *  - 落在 `where` / `OR` / `AND` / `NOT` 下面，或落在名字像条件容器的变量（`const where = …`）里 → 是；
 *  - 其余（响应体 / 普通对象）→ 不是。
 */
function isFilterContext(node) {
  let cur = node;
  while (cur) {
    if (ts.isPropertyAssignment(cur)) {
      const key = propName(cur.name);
      if (key && NON_FILTER_KEYS.has(key)) return false;
      if (key && FILTER_KEYS.has(key)) return true;
      if (key && FILTER_NAME_RE.test(key)) return true;
    }
    if (ts.isVariableDeclaration(cur)) {
      const name = cur.name && ts.isIdentifier(cur.name) ? cur.name.text : '';
      if (name && FILTER_NAME_RE.test(name)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** 扫一个文件，返回命中列表。 */
function scanFile(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
  const hits = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    // A. 对象字面量成员 `studioId:` / 简写 `{ studioId }`，且处于过滤条件上下文
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      propName(node.name) === 'studioId' &&
      isFilterContext(node)
    ) {
      hits.push({ line: lineOf(node), kind: 'condition' });
    }

    // B. `where.studioId = ...` / `claimedWhere.studioId = ...`
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left) && left.name.text === 'studioId') {
        const target = left.expression.getText(sf);
        // 只算「条件容器」上的赋值：`where.studioId = ...`（`data.studioId = ...` 是写载荷）
        if (FILTER_NAME_RE.test(target) && !/(data|payload|create|update)/i.test(target)) {
          hits.push({ line: lineOf(node), kind: 'assignment' });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return { hits, text };
}

function scan() {
  const byFile = {};
  const helperCalls = {};
  const byDir = {};
  const details = [];
  let total = 0;
  let migratedCalls = 0;

  const files = walk(SRC_DIR);
  for (const abs of files) {
    const rel = path.relative(SRC_DIR, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(rel)) continue;
    const { hits, text } = scanFile(abs);
    if (hits.length) {
      byFile[rel] = hits.length;
      total += hits.length;
      for (const h of hits) details.push({ file: rel, line: h.line, kind: h.kind });
    }
    const helperMatches = text.match(SCOPE_HELPER_RE) || [];
    if (helperMatches.length) {
      helperCalls[rel] = helperMatches.length;
      migratedCalls += helperMatches.length;
    }
    const dir = rel.includes('/') ? rel.split('/')[0] : '(root)';
    if (!byDir[dir]) byDir[dir] = { raw: 0, helpers: 0, files: 0 };
    if (hits.length || helperMatches.length) byDir[dir].files += 1;
    byDir[dir].raw += hits.length;
    byDir[dir].helpers += helperMatches.length;
  }
  return { total, byFile, helperCalls, byDir, migratedCalls, fileCount: files.length, details };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const args = new Set(process.argv.slice(2));
const result = scan();
const top = Object.entries(result.byFile).sort((a, b) => b[1] - a[1]);
const dirRows = Object.entries(result.byDir).sort((a, b) => b[1].raw - a[1].raw);

const summary = {
  metric: 'raw-studioId-scope-conditions',
  total: result.total,
  migratedHelperCalls: result.migratedCalls,
  filesWithRaw: top.length,
  byFile: Object.fromEntries(top),
  byDir: Object.fromEntries(dirRows),
};

if (args.has('--json')) {
  console.log(JSON.stringify(summary, null, 2));
  // 纯 JSON 模式：输出完就退出，别在后面掺人类可读报告（CI / 看板要能直接 JSON.parse）
  if (!args.has('--update') && !args.has('--check')) process.exit(0);
}

if (args.has('--update')) {
  const prev = loadBaseline();
  if (prev && Number.isFinite(prev.total) && result.total > prev.total && !args.has('--force')) {
    console.error(
      `[scope] ✖ 拒绝把基线调高：当前 ${result.total} > 基线 ${prev.total}。` +
        '先解释为什么新增了裸 studioId 条件（正常应该改用 common/scope.ts）；确实必要才加 --force。',
    );
    process.exit(1);
  }
  const payload = {
    _comment:
      '服务端裸 studioId 作用域条件基线（AST 统计）。只能减不能增；降下来后跑 ' +
      'node scripts/_check_scope_usage.mjs --update 调低。迁移请改用 apps/server/src/common/scope.ts。',
    _updatedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    total: result.total,
    byFile: Object.fromEntries(top),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[scope] 基线已更新：${result.total} 处裸 studioId 条件`);
  console.log(`[scope] → ${path.relative(ROOT, BASELINE_FILE).split(path.sep).join('/')}`);
  process.exit(0);
}

const baseline = loadBaseline();

if (args.has('--check')) {
  if (!baseline) {
    console.error('[scope] 找不到基线文件，先跑一次 node scripts/_check_scope_usage.mjs --update');
    process.exit(1);
  }
  if (result.total > baseline.total) {
    console.error(`[scope] ✖ 裸 studioId 条件变多了：${baseline.total} → ${result.total}（+${result.total - baseline.total}）`);
    const increased = top.filter(([f, n]) => n > ((baseline.byFile || {})[f] || 0));
    for (const [f, n] of increased.slice(0, 20)) {
      console.error(`            ${f}  ${(baseline.byFile || {})[f] || 0} → ${n}`);
    }
    console.error('            作用域请改用 apps/server/src/common/scope.ts 的 scopeWhere / visibleStudioIds / assertStudioAccess。');
    process.exit(1);
  }
  const delta = baseline.total - result.total;
  console.log(
    `[scope] ✔ 没变多（当前 ${result.total} / 基线 ${baseline.total}` +
      (delta > 0 ? `，比基线少 ${delta}，可以把基线调低：node scripts/_check_scope_usage.mjs --update）` : '）'),
  );
  process.exit(0);
}

// 默认：只报告（迁移进度）
if (args.has('--list')) {
  console.log('[scope] 逐条明细（文件:行 kind）：');
  for (const d of result.details) console.log(`            ${d.file}:${d.line}  ${d.kind}`);
}
console.log(`[scope] 裸 studioId 作用域条件：${result.total} 处，涉及 ${top.length} 个文件`);
console.log(`[scope] 已迁到 scope 帮助函数的调用点：${result.migratedCalls} 处，涉及 ${Object.keys(result.helperCalls).length} 个文件`);
if (baseline) {
  console.log(`[scope] 基线：${baseline.total} 处（${baseline._updatedAt || '?'}）；当前比基线 ${result.total > baseline.total ? '多' : '少'} ${Math.abs(baseline.total - result.total)} 处`);
} else {
  console.log('[scope] 还没有基线文件，冻结一次：node scripts/_check_scope_usage.mjs --update');
}
console.log('[scope] 按目录（裸条件 / scope 调用点）：');
for (const [dir, row] of dirRows) {
  console.log(
    `            ${dir.padEnd(24)} ${String(row.raw).padStart(4)} / ${String(row.helpers).padStart(4)}`,
  );
}
console.log('[scope] 裸条件最多的文件：');
for (const [f, n] of top.slice(0, 15)) console.log(`            ${String(n).padStart(4)}  ${f}`);
