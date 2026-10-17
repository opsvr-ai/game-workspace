// craftsman-ignore: TS001,TS002
/**
 * useSocket 共享连接回归测试（2026-10-17，前端实时链路整治）。
 *
 * 当时的问题：`useSocket` 每被调用一次就 `io()` 新建一条连接 —— AppLayout /
 * ChatProvider / DevicesPanel / CSDispatchView 同时挂着时，同一账号开 3~4 条连接，
 * 每条各自 30 秒发一次 `companion:heartbeat`、各自跑一遍令牌续期。
 *
 * 改造后这批行为是靠「模块级单例 + 引用计数」做出来的，看不见也摸不着，
 * 最容易在后续重构里被悄悄改回「一人一条连接」。这里用打桩的 socket.io-client
 * 把下面这些**契约**钉住（全部离线跑，不连网络、不用真睡眠）：
 *
 *  1. 多个消费者只建 1 个 Manager；同一 namespace 拿到同一个 Socket 实例；
 *  2. 不同 namespace（`/` 与 `/chat`）复用同一个 Manager（同一条物理连接）；
 *  3. 心跳定时器只有一个，`connect` 时 emit 一次，重复 connect 不叠加；
 *  4. 卸载一个消费者只摘自己的监听（不误伤别人、也不会被重复触发）；
 *     StrictMode 双挂载之后一次事件只回调一次；
 *  5. 最后一个消费者卸载：令牌还在 → 15 秒宽限内不断线；令牌已清空（退出登录）→ 立刻断；
 *  6. token 变了以后再 acquire → 强制 disconnect + connect 按新令牌重新鉴权（不新开连接）；
 *  7. 全部释放后重新挂载能建新 Manager；
 *  8. `auth:replaced` 延迟 800ms 并比对当前令牌：旧会话被顶的通知不会清掉新会话。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

/** 打桩模块创建出来的 Manager / Socket 实例（每个用例前清空）。 */
const h = vi.hoisted(() => ({
  sockets: [] as any[],
  managers: [] as any[],
}));

/** 记录 setInterval / clearInterval：30 秒心跳只允许有一个活跃定时器。 */
const timer = vi.hoisted(() => ({
  intervals: [] as Array<{ id: any; ms: number }>,
  cleared: new Set<any>(),
}));

vi.mock('socket.io-client', () => {
  class FakeSocket {
    auth: { token?: string };
    connected = false;
    active = false;
    handlers = new Map<string, any[]>();
    emit = vi.fn();

    constructor(public manager: any, public nsp: string, opts: any) {
      this.auth = opts?.auth;
    }

    on(ev: string, fn: any) {
      const list = this.handlers.get(ev) ?? [];
      list.push(fn);
      this.handlers.set(ev, list);
      return this;
    }

    off(ev: string, fn: any) {
      this.handlers.set(ev, (this.handlers.get(ev) ?? []).filter((f) => f !== fn));
      return this;
    }

    /** 客户端主动连接：模拟握手成功后触发一次 'connect'。 */
    connect = vi.fn(() => {
      this.active = true;
      if (this.connected) return this;
      this.connected = true;
      this.dispatch('connect');
      return this;
    });

    /** 客户端主动断开（受控断开不会触发自动重连）。 */
    disconnect = vi.fn(() => {
      this.active = false;
      this.connected = false;
      this.dispatch('disconnect', 'io client disconnect');
      return this;
    });

    /** 测试里手动派发服务端事件 / 重连。 */
    dispatch(ev: string, ...args: any[]) {
      for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...args);
    }

    /** 当前挂在这个事件上的监听数。 */
    count(ev: string) {
      return (this.handlers.get(ev) ?? []).length;
    }
  }

  class FakeManager {
    nsps: Record<string, FakeSocket> = {};
    constructor(public uri: string, public opts: any) {
      h.managers.push(this);
    }
    socket(nsp: string, opts: any) {
      // 和真 socket.io 一样：同一 namespace 已存在就复用（不会再建第二条连接）
      if (!this.nsps[nsp]) {
        this.nsps[nsp] = new FakeSocket(this, nsp, opts);
        h.sockets.push(this.nsps[nsp]);
      }
      return this.nsps[nsp];
    }
  }

  return { Manager: FakeManager };
});

vi.mock('../api/client', () => {
  const http = {
    get: vi.fn(() => Promise.resolve({ data: { data: {} } })),
    post: vi.fn(() => Promise.resolve({ data: { data: {} } })),
  };
  return {
    default: http,
    markSessionReplaced: vi.fn(),
    clearStoredSession: vi.fn(),
    redirectToLogin: vi.fn(),
  };
});

import { useSocket } from '../hooks/useSocket';
import { markSessionReplaced, redirectToLogin } from '../api/client';

const TOKEN_A = 'token-a';
const TOKEN_B = 'token-b';

/** 把 socket 初始化里的 /auth/me 续期（若干层 Promise）跑完。 */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
};

const latestManager = () => h.managers[h.managers.length - 1];

const heartbeatCount = (socket: any) =>
  socket.emit.mock.calls.filter((call: any[]) => call[0] === 'companion:heartbeat').length;

const activeIntervals = (ms: number) =>
  timer.intervals.filter((t) => t.ms === ms && !timer.cleared.has(t.id)).length;

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('accessToken', TOKEN_A);
  h.sockets.length = 0;
  h.managers.length = 0;
  timer.intervals.length = 0;
  timer.cleared.clear();

  vi.useFakeTimers();
  // 包一层 setInterval / clearInterval，用来数「30 秒心跳到底有几个定时器」。
  const fakeSetInterval = globalThis.setInterval;
  const fakeClearInterval = globalThis.clearInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: any, ms?: any, ...rest: any[]) => {
    const id = (fakeSetInterval as any)(fn, ms, ...rest);
    timer.intervals.push({ id, ms: Number(ms) });
    return id;
  }) as any);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: any) => {
    timer.cleared.add(id);
    return (fakeClearInterval as any)(id);
  }) as any);
});

afterEach(async () => {
  // 令牌清空 = 「退出登录」路径：卸载会立刻 dispose，保证下一个用例从零开始。
  sessionStorage.clear();
  cleanup();
  // 兜底：万一还有挂在宽限期里的连接，把 15 秒走完让它自己回收。
  await advance(15_000);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSocket 共享连接（单 Manager / 单心跳 / 引用计数）', () => {
  it('多个消费者只建 1 个 Manager；同 namespace 同一个 socket；不同 namespace 复用同一 Manager', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    const b = renderHook(() => useSocket({ onOrderGrabbed: () => {} }));
    const c = renderHook(() => useSocket({ namespace: '/chat', onChatBroadcast: () => {} }));
    await flush();

    // 三个消费者 → 只有一条物理连接（一个 Manager）
    expect(h.managers).toHaveLength(1);
    const shared = latestManager();
    // 两个 namespace 各一个 Socket 实例，但都挂在同一个 Manager 上
    expect(Object.keys(shared.nsps).sort()).toEqual(['/', '/chat']);
    expect(h.sockets).toHaveLength(2);
    expect(shared.nsps['/'].manager).toBe(shared);
    expect(shared.nsps['/chat'].manager).toBe(shared);

    // 同 namespace 的消费者拿到的是同一个 Socket 实例
    expect(a.result.current.current).toBe(shared.nsps['/']);
    expect(b.result.current.current).toBe(shared.nsps['/']);
    expect(a.result.current.current).toBe(b.result.current.current);
    expect(c.result.current.current).toBe(shared.nsps['/chat']);
  });

  it('心跳只在 connect 时 emit 一次、30 秒定时器只有一个，重复 connect 不叠加', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    const b = renderHook(() => useSocket({ onStatusBroadcast: () => {} }));
    const c = renderHook(() => useSocket({ namespace: '/chat', onChatBroadcast: () => {} }));
    await flush();

    const main = latestManager().nsps['/'];
    const chat = latestManager().nsps['/chat'];

    expect(main.connected).toBe(true);
    // 3 个消费者加起来也只发一次心跳，且只在默认命名空间（服务端只在那里收）
    expect(heartbeatCount(main)).toBe(1);
    expect(heartbeatCount(chat)).toBe(0);
    expect(activeIntervals(30_000)).toBe(1);

    // 模拟断线重连：再发一次 connect 事件
    main.dispatch('connect');
    expect(heartbeatCount(main)).toBe(2);
    expect(activeIntervals(30_000)).toBe(1); // 旧定时器被清掉，没有越积越多

    // 30 秒后按间隔再发一次
    await advance(30_000);
    expect(heartbeatCount(main)).toBe(3);
  });

  it('卸载一个消费者只摘自己的监听；StrictMode 双挂载后一次事件只回调一次', async () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    const a = renderHook(() => useSocket({ onOrderNew: cbA }));
    const b = renderHook(() => useSocket({ onOrderNew: cbB }));
    await flush();

    const main = latestManager().nsps['/'];
    expect(main.count('order:new')).toBe(2); // 每个消费者一条自己的包装

    main.dispatch('order:new', { id: 1 });
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);

    // 卸载 a：只摘 a 的那条，b 照常收
    a.unmount();
    expect(main.count('order:new')).toBe(1);
    main.dispatch('order:new', { id: 2 });
    expect(cbA).toHaveBeenCalledTimes(1); // 已卸载的消费者不再被触发
    expect(cbB).toHaveBeenCalledTimes(2);

    // StrictMode 双挂载：effect 会 mount→cleanup→mount，监听必须仍只有一条
    const cbStrict = vi.fn();
    const poolBefore = main.count('order:pool_updated');
    const strict = renderHook(() => useSocket({ onOrderPoolUpdated: cbStrict }), { wrapper: StrictMode });
    await flush();
    expect(main.count('order:pool_updated')).toBe(poolBefore + 1);
    main.dispatch('order:pool_updated', {});
    expect(cbStrict).toHaveBeenCalledTimes(1); // 一次事件只回调一次（没有重复绑定）
    strict.unmount();
    expect(main.count('order:pool_updated')).toBe(poolBefore);
  });

  it('最后一个消费者卸载：令牌还在 → 15 秒宽限内不断线，到点才断；之后重新挂载建新 Manager', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();
    const firstManager = latestManager();
    const main = firstManager.nsps['/'];
    expect(main.connected).toBe(true);

    a.unmount();
    expect(main.disconnect).not.toHaveBeenCalled(); // 不立刻断（StrictMode / 路由切换友好）

    await advance(14_999);
    expect(main.disconnect).not.toHaveBeenCalled(); // 宽限期内保持
    await advance(1);
    expect(main.disconnect).toHaveBeenCalledTimes(1); // 到点才断
    expect(activeIntervals(30_000)).toBe(0); // 心跳定时器一起清掉

    // 全部释放后再挂载 → 新的 Manager（新的一条物理连接）
    renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();
    expect(h.managers).toHaveLength(2);
    expect(latestManager()).not.toBe(firstManager);
    expect(latestManager().nsps['/']).not.toBe(main);
  });

  it('令牌已清空（退出登录）时，最后一个消费者卸载立刻断线，不留宽限', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();
    const main = latestManager().nsps['/'];
    expect(main.connected).toBe(true);

    sessionStorage.removeItem('accessToken');
    a.unmount();
    expect(main.disconnect).toHaveBeenCalledTimes(1); // 立刻断，不等 15 秒
    expect(activeIntervals(30_000)).toBe(0);

    await advance(15_000);
    expect(main.disconnect).toHaveBeenCalledTimes(1); // 不会重复断
  });

  it('token 变了以后再 acquire：强制 disconnect + connect 重新鉴权，不新开第二条连接', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();
    const main = latestManager().nsps['/'];
    expect(h.managers).toHaveLength(1);
    expect(main.connect).toHaveBeenCalledTimes(1);
    expect(main.disconnect).not.toHaveBeenCalled();
    expect(main.auth).toEqual({ token: TOKEN_A });

    // 同一 SPA 里「退出 → 换个号登录」：token 变了，但连接还在宽限期内
    sessionStorage.setItem('accessToken', TOKEN_B);
    const b = renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();

    // 还是同一条连接，没有新开 Manager / Socket
    expect(h.managers).toHaveLength(1);
    expect(h.sockets).toHaveLength(1);
    expect(latestManager().nsps['/']).toBe(main);
    // 但必须断开重连，按新令牌重新握手（只改 auth 服务端仍会按旧身份推送）
    expect(main.disconnect).toHaveBeenCalledTimes(1);
    expect(main.connect).toHaveBeenCalledTimes(2);
    expect(main.auth).toEqual({ token: TOKEN_B });
    expect(b.result.current.current).toBe(main);
  });

  // 注意：这条用例会把模块级 `replacedHandled` 置位（顶号处理全进程只做一次），
  // 所以它必须放在本文件最后，前面不要再加会触发 auth:replaced 的用例。
  it('auth:replaced 延迟 800ms 且比对当前令牌：旧会话的被顶通知不会清掉新会话', async () => {
    const a = renderHook(() => useSocket({ onOrderNew: () => {} }));
    await flush();
    const main = latestManager().nsps['/'];

    // 场景 1：通知到达时 sessionStorage 里已经是新令牌 → 被顶掉的是上一个会话，忽略
    sessionStorage.setItem('accessToken', TOKEN_B);
    main.dispatch('auth:replaced');
    await advance(800);
    expect(vi.mocked(markSessionReplaced)).not.toHaveBeenCalled();
    expect(vi.mocked(redirectToLogin)).not.toHaveBeenCalled();

    // 场景 2：真被顶号（令牌还是自己的）→ 800ms 后确认令牌没变才回登录页
    sessionStorage.setItem('accessToken', TOKEN_A);
    main.dispatch('auth:replaced');
    await advance(799);
    expect(vi.mocked(redirectToLogin)).not.toHaveBeenCalled(); // 先等一拍
    await advance(1);
    expect(vi.mocked(markSessionReplaced)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(redirectToLogin)).toHaveBeenCalledTimes(1);
    void a;
  });
});
