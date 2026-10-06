#!/usr/bin/env node
/**
 * 从 apps/web/src/router.tsx 静态导出「页面路由表」，并做 CI 冻结比对。
 *
 * 为什么要有它（和 scripts/_export_api_contract.mjs 是同一个道理）：
 *   路由路径是**四端共用的契约** —— 陪玩端 / 客服端的内嵌窗口、看门狗、老板收藏的链接、
 *   客服发给别人的地址，都直接写死这些 URL。router.tsx 里现在塞了 70 个路由、每个都被
 *   <Suspense> 包一层，重构时最容易「顺手」把某条老路径删掉或改名 —— 而**没有任何测试拦得住**。
 *   所以先把「有哪些路径、各渲染哪个页面」导成 docs/WEB-ROUTES.json：
 *   CI 重新生成一次再比对，路径少了 / 改了 / 换了页面，直接红。
 *
 * 用法：
 *   node scripts/_export_web_routes.mjs            # 重新生成 docs/WEB-ROUTES.json
 *   node scripts/_export_web_routes.mjs --check    # 只比对（CI 用）；有差异退出码 1
 *
 * 只做静态扫描（读 router.tsx 的字面量），不启动 vite、不 import 任何页面组件 ——
 * 所以它能在 node 里秒跑，也不会被 antd / 浏览器 API 拖住。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER_FILE = path.join(ROOT, 'apps', 'web', 'src', 'router.tsx');
const OUT_FILE = path.join(ROOT, 'docs', 'WEB-ROUTES.json');

/** 这几个只是壳，不算「这一条路由渲染的页面」。 */
const WRAPPER_TAGS = new Set(['Suspense', 'SuspenseFallback', 'SuspenseOutlet', 'RouteErrorBoundary']);

/** 去掉 // 行注释与 块注释（字符串里的不算），否则注释里的中文会被当成字段名。 */
function stripComments(text) {
  let out = '';
  let str = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      out += ch;
      if (ch === '\\') {
        out += text[++i] ?? '';
        continue;
      }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      str = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 按「顶层」逗号切分：括号 / 花括号 / 方括号里的逗号不算，字符串里的也不算。 */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let str = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      cur += ch;
      if (ch === '\\') {
        cur += text[++i] ?? '';
        continue;
      }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      str = ch;
      cur += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

/** 取出最外层的那一对括号里面的内容（'[ ... ]' / '{ ... }' / '( ... )'）。 */
function unwrap(text, open, close) {
  const i = text.indexOf(open);
  const j = text.lastIndexOf(close);
  if (i < 0 || j < i) return null;
  return text.slice(i + 1, j);
}

function literalOf(value) {
  const m = /^\s*'([^']*)'\s*$/.exec(value) || /^\s*"([^"]*)"\s*$/.exec(value);
  return m ? m[1] : null;
}

/** 从 element 的 JSX 里认出「渲染哪个页面」或「重定向到哪」。 */
function elementInfo(value) {
  const redirect = /<Navigate\s+to=(?:"([^"]+)"|'([^']+)')/.exec(value);
  if (redirect) return { kind: 'redirect', target: redirect[1] ?? redirect[2] };
  const tags = [...value.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]);
  const comp = tags.find((t) => !WRAPPER_TAGS.has(t));
  if (comp) return { kind: 'page', component: comp };
  if (tags.includes('SuspenseOutlet')) return { kind: 'layout', component: 'AppLayout' };
  return { kind: 'unknown', component: null };
}

function parseObject(text) {
  const body = unwrap(text, '{', '}');
  if (body === null) throw new Error('不是一个对象字面量：' + text.slice(0, 60));
  const node = {};
  for (const entry of splitTop(body)) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(entry);
    if (!m) throw new Error('认不出的字段：' + entry.slice(0, 60));
    const [, key, value] = m;
    if (key === 'path') {
      const lit = literalOf(value);
      if (lit === null) throw new Error('path 必须是字符串字面量（变量拼接会被静默漏掉）：' + value.slice(0, 60));
      node.path = lit;
    } else if (key === 'element') {
      node.element = value;
    } else if (key === 'errorElement') {
      node.hasErrorElement = true;
    } else if (key === 'children') {
      const inner = unwrap(value, '[', ']');
      if (inner === null) throw new Error('children 必须是数组字面量');
      node.children = splitTop(inner).map((t) => parseObject(t));
    } else if (key === 'index') {
      node.index = literalOf(value) ?? value.trim();
    } else {
      throw new Error('router.tsx 里出现了脚本不认识的字段「' + key + '」，请同步本脚本，别静默漏掉');
    }
  }
  return node;
}

function joinPath(parent, own) {
  if (own === '' || own === undefined) return parent;
  if (own.startsWith('/')) return own;
  return (parent === '/' ? '' : parent) + '/' + own;
}

function flatten(node, parentPath, out) {
  const full = joinPath(parentPath, node.path);
  if (node.path !== undefined || parentPath === '') {
    const info = node.element ? elementInfo(node.element) : { kind: 'layout', component: null };
    out.push({
      path: full,
      kind: node.index !== undefined ? 'index' : info.kind,
      component: info.component ?? null,
      redirectTo: info.kind === 'redirect' ? info.target : null,
      hasErrorElement: Boolean(node.hasErrorElement),
    });
  }
  for (const child of node.children ?? []) flatten(child, full, out);
}

function exportRoutes() {
  // 先剥掉注释：router.tsx 里有大量中文注释，不剥掉会被 splitTop 当成字段名。
  const text = stripComments(fs.readFileSync(ROUTER_FILE, 'utf8'));
  const marker = 'createBrowserRouter(';
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('router.tsx 里找不到 createBrowserRouter(，脚本要跟着改');
  const arrayText = unwrap(text.slice(at + marker.length), '[', ']');
  if (arrayText === null) throw new Error('createBrowserRouter(...) 的参数不是数组字面量');

  const routes = [];
  for (const item of splitTop(arrayText)) {
    if (item.trim() === '') continue;
    flatten(parseObject(item), '', routes);
  }

  // 「出错不静默」：源码里出现 N 个 path: 就应该导出 N 条（index 路由没有 path）。
  // 注意别用 /^\s*path:/gm —— 像 `{ path: '', element: <Navigate ... /> }` 这种单行路由
  // 前面还有 `{ `，行首正则数不到，会白白少算几条（这里踩过一次）。
  const pathCount = (text.match(/(?:^|[{,\s])path\s*:/g) || []).length;
  const indexCount = (text.match(/[{,\s]index\s*:\s*true/g) || []).length;
  const exported = routes.filter((r) => r.kind !== 'index').length;
  if (exported !== pathCount) {
    throw new Error(
      '路由条数对不上：源码 ' + pathCount + ' 个 path，导出 ' + exported + ' 条 —— ' +
        '多半是某条路由写成了变量 / 条件展开，脚本读不出来。不要输出一份「看起来对」的表。',
    );
  }
  if (routes.filter((r) => r.kind === 'index').length !== indexCount) {
    throw new Error('index 路由条数对不上：源码 ' + indexCount + ' 个，导出 ' +
      routes.filter((r) => r.kind === 'index').length + ' 条');
  }

  routes.sort((a, b) => (a.path === b.path ? a.kind.localeCompare(b.kind) : a.path.localeCompare(b.path)));
  return routes;
}

const routes = exportRoutes();

if (process.argv.includes('--update') || !process.argv.includes('--check')) {
  const payload = {
    _comment:
      '网页端路由表（四端共用的导航契约）。只能加、不能悄悄删改：改路由会动到这里，请确认陪玩端 / 客服端没有依赖老路径。',
    _exportedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    count: routes.length,
    routes,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('[web-routes] 已导出 ' + routes.length + ' 条 → ' + path.relative(ROOT, OUT_FILE).split(path.sep).join('/'));
  process.exit(0);
}

const base = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).routes : [];
const key = (r) => r.path + '|' + r.kind + '|' + (r.component ?? '') + '|' + (r.redirectTo ?? '');
const before = new Set(base.map(key));
const after = new Set(routes.map(key));
const added = routes.filter((r) => !before.has(key(r)));
const removed = base.filter((r) => !after.has(key(r)));

if (added.length || removed.length) {
  console.error('[web-routes] ✖ 路由契约变了：+' + added.length + ' / -' + removed.length);
  for (const r of added) console.error('            + ' + r.path + '  → ' + (r.component ?? r.redirectTo ?? r.kind));
  for (const r of removed) console.error('            - ' + r.path + '  → ' + (r.component ?? r.redirectTo ?? r.kind));
  console.error('            确认过没有客户端依赖老路径后，跑 node scripts/_export_web_routes.mjs 重新导出。');
  process.exit(1);
}
console.log('[web-routes] ✔ 路由契约未变（' + routes.length + ' 条）');
