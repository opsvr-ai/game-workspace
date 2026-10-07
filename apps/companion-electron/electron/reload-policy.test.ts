// craftsman-ignore: TS001,TS002
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAGE_BUSY_PROBE, decidePageReload } from './reload-policy';

/**
 * 「换版刷新 / 唤醒刷新」要不要动的判断（老板 2026-10-08）。
 *
 * 这段逻辑在本机没法真跑（要真打字、真休眠唤醒、真发一次版号），但它错了的后果很直观：
 * 轻则**打字打一半被刷掉**（老板报过），重则**被 beforeunload 拦下后版号已经记了、再也不重试**，
 * 机器永远停在旧界面。所以这里把每种情形都钉住。
 */

/** 网页那份登记处（主进程要问的那个口子得和它同名同形）。不用 import.meta —— electron 的 tsconfig 不认。 */
const webGuardPath = [
  resolve(process.cwd(), '../web/src/utils/busyGuard.ts'),
  resolve(process.cwd(), 'apps/web/src/utils/busyGuard.ts'),
].find((f) => existsSync(f));

const base = { kind: 'frontend-version' as const, hasWindow: true, quitting: false, pageBusy: false };

describe('decidePageReload —— 换版刷新前先看有没有人在写', () => {
  it('没人写 + 窗口在 + 没退出 → 刷', () => {
    expect(decidePageReload(base)).toEqual({ reload: true, deferred: false, reason: 'ok' });
  });

  it('页面正在写（发布订单 / 聊天有没提交的内容）→ 不刷，而且算「推后」', () => {
    const d = decidePageReload({ ...base, pageBusy: true });
    expect(d.reload).toBe(false);
    // deferred = 调用方这次**不许记版号**，否则下一个周期不会再发现换版，机器就停在旧界面
    expect(d.deferred).toBe(true);
    expect(d.reason).toBe('page-busy');
  });

  it('窗口已经销毁 → 不刷，但不算推后（没什么可刷的，版号照记）', () => {
    const d = decidePageReload({ ...base, hasWindow: false });
    expect(d.reload).toBe(false);
    expect(d.deferred).toBe(false);
    expect(d.reason).toBe('no-window');
  });

  it('正在退出程序 → 不刷，也不算推后', () => {
    const d = decidePageReload({ ...base, quitting: true });
    expect(d.reload).toBe(false);
    expect(d.deferred).toBe(false);
    expect(d.reason).toBe('quitting');
  });

  it('退出中即使有人在写也不刷（关机路上别弹提示、别跳页面）', () => {
    const d = decidePageReload({ ...base, quitting: true, pageBusy: true });
    expect(d.reload).toBe(false);
    expect(d.reason).toBe('quitting');
  });

  it('休眠唤醒：有人在写就不刷（老板 2026-10-08 第二条：不再无条件重载）', () => {
    expect(decidePageReload({ ...base, kind: 'system-resume', pageBusy: true }).reload).toBe(false);
    expect(decidePageReload({ ...base, kind: 'system-resume' }).reload).toBe(true);
  });
});

describe('主进程问页面用的那段 JS（两边名字必须一致）', () => {
  it('探针问的是 window.__chunlvBusyGuard.isBusy()', () => {
    expect(PAGE_BUSY_PROBE).toContain('window.__chunlvBusyGuard');
    expect(PAGE_BUSY_PROBE).toContain('.isBusy()');
  });

  it('网页侧（apps/web/src/utils/busyGuard.ts）真的挂了同一个名字 —— 不然主进程永远问不出「在写」', () => {
    if (!webGuardPath) throw new Error('找不到网页侧的 apps/web/src/utils/busyGuard.ts');
    const web = readFileSync(webGuardPath, 'utf8');
    expect(web).toContain('__chunlvBusyGuard');
    expect(web).toContain('__chunlvBusyGuard =');
    expect(web).toContain('isBusy');
  });
});
