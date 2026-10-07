// craftsman-ignore: TS002
import { describe, expect, it } from 'vitest';
import {
  decideBannerRoute,
  isFullscreenKicked,
  resolveBannerMode,
  type ForegroundProbe,
} from './banner-policy';

const inGame = (exe = 'deltaforce', exclusive = false): ForegroundProbe => ({
  full: true,
  exe,
  exclusive,
});
const notGame: ForegroundProbe = { full: false, exe: 'explorer', exclusive: false };

describe('设置迁移：老布尔键 → 三档', () => {
  it('新键直接认', () => {
    expect(resolveBannerMode('auto')).toBe('auto');
    expect(resolveBannerMode('hold')).toBe('hold');
    expect(resolveBannerMode('show')).toBe('show');
  });

  it('老开关开着（true）＝ 全屏不弹 → hold', () => {
    expect(resolveBannerMode(undefined, true)).toBe('hold');
  });

  it('老开关关过（false）＝ 照旧弹在游戏上面 → show', () => {
    expect(resolveBannerMode(undefined, false)).toBe('show');
  });

  it('两个键都没设过 → auto（新默认，自己判断）', () => {
    expect(resolveBannerMode(undefined, undefined)).toBe('auto');
    expect(resolveBannerMode(null, null)).toBe('auto');
  });

  it('新键是坏值（老客户端返回 undefined、或者被人乱写）→ 回落到老键 / auto', () => {
    expect(resolveBannerMode('乱写', true)).toBe('hold');
    expect(resolveBannerMode('乱写', undefined)).toBe('auto');
  });
});

describe('决定弹不弹', () => {
  it('没在全屏打游戏：三档都照常弹', () => {
    for (const mode of ['auto', 'hold', 'show'] as const) {
      expect(decideBannerRoute({ mode, probe: notGame })).toBe('show');
    }
  });

  it('探测不出来（PowerShell 挂了）：照常弹，绝不吞新单', () => {
    for (const mode of ['auto', 'hold', 'show'] as const) {
      expect(decideBannerRoute({ mode, probe: null })).toBe('show');
    }
    expect(decideBannerRoute({ mode: 'hold', probe: null, learnedKick: true })).toBe('show');
  });

  it('auto + 独占全屏（童祥瑞那台）→ 压住，不弹', () => {
    expect(decideBannerRoute({ mode: 'auto', probe: inGame('deltaforce', true) })).toBe('hold');
  });

  it('auto + 无边框全屏（别人那些机器）→ 照旧弹在游戏上面，行为一个字不变', () => {
    expect(decideBannerRoute({ mode: 'auto', probe: inGame('deltaforce', false) })).toBe('show');
  });

  it('auto + 这台机器以前被顶出去过 → 压住（Windows 认不出独占全屏时靠它兜底）', () => {
    expect(
      decideBannerRoute({ mode: 'auto', probe: inGame('unknowngame', false), learnedKick: true }),
    ).toBe('hold');
  });

  it('hold：全屏时一律压住', () => {
    expect(decideBannerRoute({ mode: 'hold', probe: inGame('deltaforce', false) })).toBe('hold');
  });

  it('show：明确要求照弹，全屏也弹', () => {
    expect(decideBannerRoute({ mode: 'show', probe: inGame('deltaforce', true) })).toBe('show');
  });
});

describe('复查：游戏是不是被这张横幅顶出去了', () => {
  it('被顶回桌面（不再铺满整屏）→ 认定为被顶出去', () => {
    expect(isFullscreenKicked(inGame('deltaforce'), notGame)).toBe(true);
  });

  it('顶回窗口模式（前台换成别的进程）→ 认定为被顶出去', () => {
    expect(
      isFullscreenKicked(inGame('deltaforce'), { full: true, exe: 'explorer', exclusive: false }),
    ).toBe(true);
  });

  it('游戏还在全屏、还是同一个游戏 → 没被顶出去', () => {
    expect(isFullscreenKicked(inGame('deltaforce'), inGame('deltaforce'))).toBe(false);
  });

  it('弹之前就不在全屏 → 不记（跟横幅无关）', () => {
    expect(isFullscreenKicked(notGame, notGame)).toBe(false);
    expect(isFullscreenKicked(null, notGame)).toBe(false);
  });

  it('复查探不出来 → 不记（宁可漏记一次，也不能记错）', () => {
    expect(isFullscreenKicked(inGame('deltaforce'), null)).toBe(false);
  });
});
