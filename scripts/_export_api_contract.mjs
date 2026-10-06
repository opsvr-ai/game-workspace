#!/usr/bin/env node
/**
 * 从 NestJS 的 Controller / Gateway 源码里导出「四端共用的契约」：HTTP 路径 + Socket 事件名。
 *
 * 为什么要有它（docs/REFACTOR-PLAN.md 前提 3「契约冻结」）：
 *   接口路径与 Socket 事件名是网页端 / 陪玩端 / 客服端 / 看门狗共用的契约，重构期间不得变更。
 *   但 400 个接口 + 几十个事件靠人记是记不住的（全仓只有 15 个 DTO 文件，类型系统拦不住）。
 *   这个脚本把契约导成 docs/API-CONTRACT.json，CI 里重新生成一次再比对：
 *   谁不小心改了路径或事件名，CI 直接红，改动的人自己看得见。
 *
 * 用法：
 *   node scripts/_export_api_contract.mjs           # 重新生成 docs/API-CONTRACT.json
 *   node scripts/_export_api_contract.mjs --check   # 只比对（CI 用）；有差异退出码 1
 *
 * 只做静态扫描（读装饰器字面量），不启动 Nest、不连数据库、不需要环境变量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps', 'server', 'src');
const OUT_FILE = path.join(ROOT, 'docs', 'API-CONTRACT.json');
const API_PREFIX = '/api';

const HTTP_METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'];
const HTTP_DECORATOR = new RegExp('^@(' + HTTP_METHODS.join('|') + ')\\((.*)\\)$');
const SUBSCRIBE_DECORATOR = /^@SubscribeMessage\((.*)\)$/;
const CONTROLLER_DECORATOR = /^@Controller\((.*)\)$/;
const CLASS_DECL = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const HANDLER_DECL = /^(?:public\s+|private\s+|protected\s+|readonly\s+|async\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\(/;
const EMIT_CALL = /\.emit\(\s*'([^']+)'/;
// 方法体里的 if / for 也会匹配成「标识符 + (」，别把它们当成方法名（否则 emit 的归属会记成 'if'）。
// 只收「后面真会跟一个括号」的那几个；**别把 delete 收进来** —— `async delete(@Param('id') id)`
// 是真实存在的接口方法名。
const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch']);

/** 装饰器参数只认字符串字面量；认不出来就返回 null（调用方要报错，不许静默丢）。 */
function literalOf(arg) {
  const text = String(arg).trim();
  if (text === '') return '';
  const m = /^'([^']*)'$/.exec(text) || /^"([^"]*)"$/.exec(text);
  return m ? m[1] : null;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 拼出对外路径：全局前缀 + @Controller 的 base + @Get/@Post 的 sub。 */
function joinPath(base, sub) {
  const tail = String(sub || '').replace(/^\/+/, '');
  const parts = [API_PREFIX.replace(/^\/+/, ''), String(base || '').replace(/^\/+|\/+$/g, ''), tail]
    .filter((p) => p !== '');
  return '/' + parts.join('/');
}

const BACKSLASH = String.fromCharCode(92);
const QUOTE_CHARS = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)];

/** 括号是否还没闭合：多行装饰器（@UseInterceptors(FileInterceptor(...))）要整段一起看。 */
function parenDelta(text) {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === BACKSLASH) i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (QUOTE_CHARS.includes(ch)) { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
  }
  return depth;
}

/** 扫一个文件：只认上面那几种装饰器写法，复杂写法（变量拼接）会进 problems。 */
function scanFile(relPath, text, acc, isEmitterFile) {
  const lines = text.split(/\r?\n/);
  let pending = [];
  let current = null;
  let handler = '';

  let decoratorBuffer = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    // 装饰器可能是多行的：@UseInterceptors(FileInterceptor('logo', { storage: ... }))
    // 括号没闭合就把后面的行接上来，接完再当成一个装饰器。
    if (decoratorBuffer !== '' || line.startsWith('@')) {
      decoratorBuffer = decoratorBuffer === '' ? line : decoratorBuffer + ' ' + line;
      if (parenDelta(decoratorBuffer) > 0) continue;
      pending.push(decoratorBuffer);
      decoratorBuffer = '';
      continue;
    }

    const classMatch = CLASS_DECL.exec(line);
    if (classMatch) {
      const name = classMatch[1];
      const ctrlDecorator = pending.find((d) => CONTROLLER_DECORATOR.test(d));
      const isGateway = pending.some((d) => d.startsWith('@WebSocketGateway'));
      current = null;
      if (ctrlDecorator) {
        const base = literalOf(CONTROLLER_DECORATOR.exec(ctrlDecorator)[1]);
        if (base === null) acc.problems.push(relPath + ': @Controller 的参数不是字符串字面量 -> ' + ctrlDecorator);
        current = { kind: 'controller', name, file: relPath, base: base || '' };
      } else if (isGateway) {
        current = { kind: 'gateway', name, file: relPath };
      } else {
        current = { kind: 'other', name, file: relPath };
      }
      pending = [];
      handler = '';
      continue;
    }

    const handlerMatch = HANDLER_DECL.exec(line);
    const isBlockKeyword = Boolean(handlerMatch && BLOCK_KEYWORDS.has(handlerMatch[1]));
    if (handlerMatch && current && !isBlockKeyword) {
      handler = handlerMatch[1];
      for (const decorator of pending) {
        const http = HTTP_DECORATOR.exec(decorator);
        if (http && current.kind === 'controller') {
          const sub = literalOf(http[2]);
          if (sub === null) {
            acc.problems.push(relPath + ': ' + decorator + ' 的参数不是字符串字面量，扫描器读不出来');
            continue;
          }
          const base = current.base;
          acc.endpoints.push({
            method: http[1].toUpperCase(),
            path: joinPath(base, sub),
            controller: current.name,
            handler,
            file: relPath,
          });
        }
        const sub2 = SUBSCRIBE_DECORATOR.exec(decorator);
        if (sub2 && current.kind === 'gateway') {
          const event = literalOf(sub2[1]);
          if (event === null) acc.problems.push(relPath + ': ' + decorator + ' 的参数不是字符串字面量');
          else acc.inbound.push({ event, gateway: current.name, handler });
        }
      }
      pending = [];
      continue;
    }

    if (current && isEmitterFile && !isBlockKeyword) {
      const em = EMIT_CALL.exec(line);
      if (em) acc.outbound.push({ event: em[1], emitter: current.name, handler: handler || '(unknown)', file: relPath });
    }
    pending = [];
  }
}

function compareAndSort(items, keyOf) {
  const seen = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

function build() {
  const files = walk(SRC_DIR).sort();
  const acc = { endpoints: [], inbound: [], outbound: [], problems: [] };
  let rawHttpDecorators = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    rawHttpDecorators += (text.match(new RegExp('@(?:' + HTTP_METHODS.join('|') + ')\\(', 'g')) || []).length;
    // 出站事件不只在 gateway 文件里：heartbeat.service.ts 也直接往房间里推
    // （entertainment:warning / status:broadcast）。凡是引用 WsGateway 的文件都算。
    scanFile(rel, text, acc, /wsgateway/i.test(text));
  }

  const http = compareAndSort(acc.endpoints, (e) => e.method + ' ' + e.path);
  const socketInbound = compareAndSort(acc.inbound, (e) => e.event + ' ' + e.gateway + ' ' + e.handler);
  const socketOutbound = compareAndSort(acc.outbound, (e) => e.event + ' ' + e.emitter + ' ' + e.handler);

  if (http.length !== rawHttpDecorators) {
    acc.problems.push('扫出来的接口数（' + http.length + '）与源码里的 HTTP 装饰器数（' + rawHttpDecorators + '）对不上 —— 扫描器漏了写法，先修脚本别信结果');
  }

  return {
    contract: {
      $comment: [
        '本文件由 scripts/_export_api_contract.mjs 自动生成，不要手改（CI 会重新生成并比对）。',
        '这是四端共用的契约：网页端 / 陪玩端 / 客服端 / 看门狗。重构期间路径与事件名不得变更。',
        '改了这里 = 改了对外契约，必须同时确认四个客户端都跟得上（见 docs/REFACTOR-PLAN.md 前提 3）。',
        '出站事件只收录字面量写法 emit(\'order:new\', ...)；gateway 里还有几处用变量转发（emit(event, payload)），',
        '那种事件名在调用方，静态扫不出来 —— 所以出站列表是「至少这些」，不是「只有这些」。',
      ],
      httpPrefix: API_PREFIX,
      stats: {
        controllers: new Set(http.map((e) => e.controller)).size,
        endpoints: http.length,
        socketEmitters: new Set([...socketInbound, ...socketOutbound].map((e) => e.gateway || e.emitter)).size,
        socketInbound: new Set(socketInbound.map((e) => e.event)).size,
        socketOutbound: new Set(socketOutbound.map((e) => e.event)).size,
      },
      http,
      socketInbound,
      socketOutbound,
    },
    problems: acc.problems,
  };
}

function describeDiff(before, after) {
  const lines = [];
  const keyOf = (list, fn) => new Set(list.map(fn));
  const cmp = (label, a, b, fn) => {
    const beforeSet = keyOf(a, fn);
    const afterSet = keyOf(b, fn);
    for (const k of [...afterSet].filter((x) => !beforeSet.has(x)).sort()) lines.push('  + ' + label + ' ' + k);
    for (const k of [...beforeSet].filter((x) => !afterSet.has(x)).sort()) lines.push('  - ' + label + ' ' + k);
  };
  cmp('接口', before.http || [], after.http || [], (e) => e.method + ' ' + e.path);
  cmp('入站事件', before.socketInbound || [], after.socketInbound || [], (e) => e.event);
  cmp('出站事件', before.socketOutbound || [], after.socketOutbound || [], (e) => e.event);
  return lines;
}

function main() {
  const check = process.argv.includes('--check');
  const { contract, problems } = build();
  const next = JSON.stringify(contract, null, 2) + '\n';

  if (problems.length > 0) {
    console.error('契约扫描遇到读不懂的写法，先修脚本（结果不可信）：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  const stats = contract.stats;
  console.log('接口 ' + stats.endpoints + ' 个（' + stats.controllers + ' 个 controller）｜'
    + '入站事件 ' + stats.socketInbound + ' 个｜出站事件 ' + stats.socketOutbound + ' 个');

  if (!check) {
    fs.writeFileSync(OUT_FILE, next, 'utf8');
    console.log('已写入 ' + path.relative(ROOT, OUT_FILE).split(path.sep).join('/'));
    return;
  }

  const beforeText = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (beforeText === next) {
    console.log('契约与 docs/API-CONTRACT.json 一致 ✓');
    return;
  }

  console.error('契约变了，但 docs/API-CONTRACT.json 没跟着更新：');
  let before = {};
  try { before = JSON.parse(beforeText); } catch { console.error('  （旧文件解析不了，按全部新增处理）'); }
  const diff = describeDiff(before, contract);
  if (diff.length === 0) console.error('  （内容有变化但没看出增删，可能是字段顺序或 controller/handler 改名）');
  else for (const line of diff) console.error(line);

  console.error('');
  console.error('改接口路径 / Socket 事件名 = 改四端契约。确认客户端跟得上之后，跑：');
  console.error('  node scripts/_export_api_contract.mjs');
  console.error('再把 docs/API-CONTRACT.json 一起提交。');
  process.exit(1);
}

main();
