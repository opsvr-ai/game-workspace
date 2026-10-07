/**
 * 「打字打一半被自动刷新打断、输入全没了」的防线（老板 2026-10-08）。
 *
 * 老板原话：「发布订单或者聊天的时候 软件经常会刷新一下 然后好不容易输入的东西就全没了」。
 * 查出两条根因都不在业务代码里：
 *   ① 陪玩端主进程每 5 分钟问一次网页版号，**一变就 webContents.reload()**（我们一天发好几次版号）；
 *   ② 系统休眠唤醒后主进程还会再 reload() 一次。
 * 网页治不了主进程主动发起的 reload，但 Electron 会因为页面的 beforeunload 取消这次 reload ——
 * 所以这里把三条防线钉死：
 *   * utils/draft.ts       —— 没提交的内容存草稿 / 捡回来；
 *   * utils/busyGuard.ts   —— 「谁在写东西」的登记处 + beforeunload 守卫；
 *   * utils/buildRefresh.ts —— 网页自己换版刷新的判定（有人在写就不刷）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatComposer from '../components/chat/ChatComposer';
import {
  DRAFT_TTL_MS,
  draftStorageKey,
  hasDraft,
  loadDraft,
  saveDraft,
  useDraftSaver,
} from '../utils/draft';
import {
  UNSAVED_NOTICE,
  busyIds,
  installUnloadGuard,
  isAnyBusy,
  resetBusyForTest,
  setBusy,
} from '../utils/busyGuard';
import {
  RELOAD_MIN_INTERVAL_MS,
  RELOAD_MIN_PAGE_AGE_MS,
  decideBuildRefresh,
} from '../utils/buildRefresh';

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock('../utils/feedback', () => {
  const message = { success: vi.fn(), error: vi.fn(), warning: warnSpy, info: vi.fn(), raw: {} };
  return { message, default: message, FEEDBACK_DEDUP_MS: 2500, resetFeedbackDedup: vi.fn() };
});

beforeEach(() => {
  localStorage.clear();
  resetBusyForTest();
});

describe('草稿存档（utils/draft.ts）', () => {
  it('存了能原样取回来', () => {
    expect(saveDraft('k1', { a: 1, customerNickname: '小红' })).toBe(true);
    expect(loadDraft('k1')).toEqual({ a: 1, customerNickname: '小红' });
  });

  it('空内容 / 清空 = 删除，不留一条空草稿把刷新拦住', () => {
    saveDraft('k1', { a: 1 });
    expect(saveDraft('k1', {})).toBe(false);
    expect(loadDraft('k1')).toBeNull();
    expect(localStorage.getItem(draftStorageKey('k1'))).toBeNull();
  });

  it('超过 3 天的草稿自动作废（顺手清掉）', () => {
    const t0 = 1_700_000_000_000;
    saveDraft('k2', { a: 1 }, t0);
    expect(loadDraft('k2', t0 + DRAFT_TTL_MS - 1)).toEqual({ a: 1 });
    expect(loadDraft('k2', t0 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(draftStorageKey('k2'))).toBeNull();
  });

  it('存的是坏数据也不会把页面读崩', () => {
    localStorage.setItem(draftStorageKey('k3'), '{ 这不是 json');
    expect(loadDraft('k3')).toBeNull();
    expect(localStorage.getItem(draftStorageKey('k3'))).toBeNull();
  });

  it('序列化不了（循环引用）就整体不存 —— 宁可不存，也不存坏的', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(saveDraft('k4', cyclic)).toBe(false);
    expect(localStorage.getItem(draftStorageKey('k4'))).toBeNull();
  });
});

describe('「谁在写东西」登记（utils/busyGuard.ts）', () => {
  const Probe = ({ value }: { value: string }) => {
    useDraftSaver('probe', value, { busy: value.trim().length > 0 });
    return null;
  };

  it('有没提交的内容时登记、清空后撤销', () => {
    const { rerender } = render(<Probe value="" />);
    expect(isAnyBusy()).toBe(false);

    rerender(<Probe value="打了一半的字" />);
    expect(busyIds()).toContain(draftStorageKey('probe'));
    expect(isAnyBusy()).toBe(true);

    rerender(<Probe value="" />);
    expect(isAnyBusy()).toBe(false);
  });

  it('有人在写的时候，beforeunload 会把刷新拦下来（Electron 就靠这个取消主进程发的 reload）', () => {
    const off = installUnloadGuard();

    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    setBusy('probe', true);
    const writing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(writing);
    expect(writing.defaultPrevented).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(UNSAVED_NOTICE);

    setBusy('probe', false);
    const idleAgain = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idleAgain);
    expect(idleAgain.defaultPrevented).toBe(false);

    off();
  });
});

describe('网页换版刷新判定（utils/buildRefresh.ts）', () => {
  const NOW = 1_700_000_000_000;
  const base = {
    prev: 'build-1',
    next: 'build-2',
    pageAgeMs: RELOAD_MIN_PAGE_AGE_MS + 1,
    lastReloadAt: 0,
    inService: false,
    busy: false,
    now: NOW,
  };

  it('有新版本、现在安全 → 刷，并记下新构建号', () => {
    const d = decideBuildRefresh(base);
    expect(d.reload).toBe(true);
    expect(d.remember).toBe(true);
  });

  it('有还没提交的内容 → 不刷，也不记（留到下一轮再判断）', () => {
    const d = decideBuildRefresh({ ...base, busy: true });
    expect(d.reload).toBe(false);
    expect(d.remember).toBe(false);
  });

  it('正在接单 / 服务中 → 不刷', () => {
    const d = decideBuildRefresh({ ...base, inService: true });
    expect(d.reload).toBe(false);
    expect(d.remember).toBe(true);
  });

  it('页面刚打开 2 分钟内 → 不刷，也不记', () => {
    const d = decideBuildRefresh({ ...base, pageAgeMs: RELOAD_MIN_PAGE_AGE_MS - 1 });
    expect(d.reload).toBe(false);
    expect(d.remember).toBe(false);
  });

  it('5 分钟内刚刷过 → 不刷，也不记', () => {
    const d = decideBuildRefresh({ ...base, lastReloadAt: NOW - (RELOAD_MIN_INTERVAL_MS - 1) });
    expect(d.reload).toBe(false);
    expect(d.remember).toBe(false);
  });

  it('同一个构建 / 第一次见 / 没拿到构建号 → 一律不动', () => {
    expect(decideBuildRefresh({ ...base, next: 'build-1' })).toMatchObject({ reload: false, remember: false });
    expect(decideBuildRefresh({ ...base, prev: null })).toMatchObject({ reload: false, remember: true });
    expect(decideBuildRefresh({ ...base, next: undefined })).toMatchObject({ reload: false, remember: false });
  });
});

describe('聊天输入框的草稿（ChatComposer）', () => {
  it('刷新后能把没发出去的字捡回来，并提示一句', () => {
    saveDraft('chat:r1', '这条还没发出去');
    render(<ChatComposer draftKey="chat:r1" onSend={vi.fn()} />);

    expect(screen.getByText(/已恢复你上次没发出去的内容/)).toBeInTheDocument();
    const box = screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
    expect(box.value).toBe('这条还没发出去');
    // 有没发出去的字 → 自动刷新会被拦下
    expect(isAnyBusy()).toBe(true);
  });

  it('发出去以后草稿清掉，也不再拦刷新', () => {
    saveDraft('chat:r1', '这条还没发出去');
    const onSend = vi.fn();
    render(<ChatComposer draftKey="chat:r1" onSend={onSend} />);

    const box = screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('这条还没发出去', undefined, []);
    expect(hasDraft('chat:r1')).toBe(false);
    expect(isAnyBusy()).toBe(false);
  });

  it('没人写的时候不登记「有人没提交」', () => {
    render(<ChatComposer draftKey="chat:r2" onSend={vi.fn()} />);
    expect(screen.queryByText(/已恢复你上次没发出去的内容/)).toBeNull();
    expect(isAnyBusy()).toBe(false);
  });
});
