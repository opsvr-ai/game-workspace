import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * 「打包清单别漏文件」—— 客服端的装机版是一台台真机器上的程序，漏打一个文件，
 * 后果是**那台机器上的客服端一启动就 require 不到、直接崩**（而且因为客户端崩了，
 * 它连「上报我崩了」都做不到，只能等人报「打不开」）。
 *
 * electron-builder.yml 的 files: 是白名单：只有列出来的文件才会进安装包。
 * 所以「main.js 里 require 了谁」和「files: 里列了谁」必须对得上 —— 这里机械地对一遍。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');

/** 从 electron-builder.yml 里抠出 files: 下面那一串「- xxx」（白名单本身的格式很简单）。 */
function packagedFiles() {
  const lines = read('electron-builder.yml').split(/\r?\n/);
  const start = lines.findIndex((l) => /^files:\s*$/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // 回到顶层键（extraResources / win / nsis …）
    const m = /^\s*-\s*(\S+)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('打包白名单（electron-builder.yml 的 files:）', () => {
  const entries = packagedFiles();

  it('白名单里列出来的文件都真的存在（写错文件名 = 打包时才报错）', () => {
    for (const entry of entries) {
      expect(fs.existsSync(path.join(here, entry)), entry + ' 不存在').toBe(true);
    }
  });

  it('main.js / machine-agent.js 里 require 的本地文件都在白名单里', () => {
    const missing = [];
    for (const file of ['main.js', 'machine-agent.js', 'update-decisions.js']) {
      const src = read(file);
      for (const m of src.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) {
        const rel = m[1];
        const candidate = rel.endsWith('.js') ? rel : rel + '.js';
        if (!entries.includes(candidate)) missing.push(file + ' → ' + candidate);
      }
    }
    expect(missing).toEqual([]);
  });

  it('更新决策真的被打进去了（这是 2026-10-07 抽出来的那一层）', () => {
    expect(entries).toContain('update-decisions.js');
  });
});

/** 从 electron-builder.yml 的 extraResources: 里抠出「- from: xxx」。 */
function extraResourceFroms() {
  const lines = read('electron-builder.yml').split(/\r?\n/);
  const start = lines.findIndex((l) => /^extraResources:\s*$/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // 回到顶层键
    const m = /^\s*-\s*from:\s*(\S+)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('托盘图标（蓝色那张）必须真的进安装包', () => {
  // 老板 2026-10-15：右下角两个驴图标长得一模一样，分不清哪个是陪玩哪个是客服。
  // 现在客服端用蓝色方块、陪玩端用绿色方块 —— 但这份图要是没进 extraResources，
  // 运行时读不到就会退回老的 donkey.ico，两个客户端又变回一模一样，而且不报任何错。
  it('public/tray-cs.png 真的在仓库里', () => {
    expect(fs.existsSync(path.join(here, 'public', 'tray-cs.png'))).toBe(true);
  });

  it('tray-cs.png 在 extraResources 里（打包时会被拷进 resources/）', () => {
    expect(extraResourceFroms()).toContain('public/tray-cs.png');
  });

  it('托盘优先用新图，老 donkey.ico 只排在后面兜底', () => {
    const src = read('main.js');
    const fresh = src.indexOf('tray-cs.png');
    const legacy = src.indexOf('donkey.ico');
    expect(fresh).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(fresh);
  });
});
