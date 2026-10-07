/**
 * 「页面在不在写」这个登记处 + 给客户端主进程的查询口（老板 2026-10-08）。
 *
 * 为什么值得单独测：陪玩端主进程每次想整页重载之前都会问一句
 * `window.__chunlvBusyGuard.isBusy()`（见 apps/companion-electron/electron/reload-policy.ts）。
 * 这个**名字和形状**是两边约定的接口，改坏了不会有任何报错 —— 只会表现为
 * 「打字打一半又被刷掉」重新出现。所以在这里钉住。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  exposeBusyGuard,
  installUnloadGuard,
  isAnyBusy,
  resetBusyForTest,
  setBusy,
} from './busyGuard';

afterEach(() => {
  resetBusyForTest();
  delete (window as any).__chunlvBusyGuard;
});

describe('「有人在写」登记处', () => {
  it('登记了就忙，撤销了就不忙', () => {
    expect(isAnyBusy()).toBe(false);
    setBusy('order-draft', true);
    expect(isAnyBusy()).toBe(true);
    setBusy('order-draft', false);
    expect(isAnyBusy()).toBe(false);
  });

  it('空 id 不登记（避免写出「谁都不是」这种查不出来的状态）', () => {
    setBusy('', true);
    expect(isAnyBusy()).toBe(false);
  });
});

describe('客户端主进程的查询口 window.__chunlvBusyGuard', () => {
  it('挂上以后能问出真实状态（主进程就是靠这个决定「这一轮先不刷」）', () => {
    exposeBusyGuard();
    const guard = (window as any).__chunlvBusyGuard;
    expect(typeof guard.isBusy).toBe('function');
    expect(guard.isBusy()).toBe(false);
    setBusy('chat-draft', true);
    expect(guard.isBusy()).toBe(true);
    setBusy('chat-draft', false);
    expect(guard.isBusy()).toBe(false);
  });

  it('installUnloadGuard 会顺手把查询口挂上（AppLayout 一挂载就有）', () => {
    const off = installUnloadGuard();
    expect((window as any).__chunlvBusyGuard?.isBusy()).toBe(false);
    off();
  });
});

describe('beforeunload 守卫：有没提交的内容就拦下这次刷新', () => {
  it('没人写 → 不拦（换版刷新照常）', () => {
    const off = installUnloadGuard();
    const e = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    off();
  });

  it('有人在写 → 拦住（Electron 会因此取消主进程这次 reload）', () => {
    setBusy('order-draft', true);
    const off = installUnloadGuard();
    const e = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    off();
  });

  it('解绑之后不再拦', () => {
    setBusy('order-draft', true);
    const off = installUnloadGuard();
    off();
    const e = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
