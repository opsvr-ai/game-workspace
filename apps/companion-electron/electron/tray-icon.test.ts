import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * 托盘图标：陪玩端必须是「绿色方块 + 白驴」，而且要真的打进安装包。
 *
 * 老板 2026-10-15 报「右下角两个驴图标长得一模一样，分不清哪个是陪玩哪个是客服」。
 * 现在两端各用一张图区分（陪玩绿、客服蓝），但**这张图要是没进 extraResources**，
 * 运行时读不到就会退回老的 donkey.png —— 两个客户端又变回一模一样，界面上还不会报任何错，
 * 下次又得靠老板肉眼发现。所以这里机械地盯住「文件在不在、有没有打包、是不是优先用新的」。
 */

const appRoot = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(appRoot, f), 'utf-8');

/** 从 electron-builder.yml 的 extraResources: 里抠出「- from: xxx」。 */
function extraResourceFroms(): string[] {
  const lines = read('electron-builder.yml').split(/\r?\n/);
  const start = lines.findIndex((l) => /^extraResources:\s*$/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // 回到顶层键
    const m = /^\s*-\s*from:\s*(\S+)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('陪玩端托盘图标（绿色那张）', () => {
  it('public/tray-companion.png 真的在仓库里', () => {
    expect(fs.existsSync(path.join(appRoot, 'public', 'tray-companion.png'))).toBe(true);
  });

  it('tray-companion.png 在 extraResources 里 —— 漏了就静默退回老驴图', () => {
    expect(extraResourceFroms()).toContain('public/tray-companion.png');
  });

  it('托盘优先用新图，老 donkey.png 只排在后面兜底', () => {
    const src = read(path.join('electron', 'tray.ts'));
    const fresh = src.indexOf('tray-companion.png');
    const legacy = src.indexOf("'donkey.png'");
    expect(fresh).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(fresh);
  });
});
