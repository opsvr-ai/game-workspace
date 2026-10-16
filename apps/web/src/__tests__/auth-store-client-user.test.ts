import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 「这台电脑现在是谁在用」必须写进客户端本地（2026-10-17 老板问「孙可馨在哪台电脑」）。
 *
 * 背景：陪玩端台账里的 loginUser 只认客户端本地 config.json 的 currentUsername
 * （machine-agent 的 getLoginUser）。写这个值以前只有「手动/自动登录那一刻」，
 * 而客户端**网页热更后只刷新页面**（不重登），走的是 fetchUser 恢复会话 ——
 * 于是那台机器在「机器管理」里 loginUser 永远是空的，服务器没法把账号挂到真机器上，
 * 老板想问「谁在哪台电脑」只能一行行猜。
 *
 * 这三条测试锁的就是：登录、会话恢复、直接 setUser，三条路径都得写。
 */

const loginMock = vi.fn();
const meMock = vi.fn();

vi.mock('../api/client', () => ({
  authApi: {
    login: (...args: unknown[]) => loginMock(...args),
    me: (...args: unknown[]) => meMock(...args),
  },
  clearStoredSession: vi.fn(),
}));

import { useAuthStore } from '../stores/authStore';

const user = { id: 'u-1', username: '孙可馨', role: 'CS', studioName: '蠢驴电竞' } as never;

const setCurrentUser = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    setCurrentUser,
    setRole: vi.fn(),
    setStudioName: vi.fn(),
    storeSet: vi.fn(),
    onLoggedIn: vi.fn(),
  };
});

describe('authStore · 客户端本地记「谁在用这台电脑」', () => {
  it('登录成功写入 userId + 用户名', async () => {
    loginMock.mockResolvedValue({
      data: { data: { accessToken: 'a', refreshToken: 'r', user } },
    });
    await useAuthStore.getState().login({ username: '孙可馨', password: 'x' } as never);
    expect(setCurrentUser).toHaveBeenCalledWith('u-1', '孙可馨');
  });

  it('会话恢复（fetchUser）也要写入 —— 网页热更刷新后台账才认得出人', async () => {
    meMock.mockResolvedValue({ data: { data: user } });
    await useAuthStore.getState().fetchUser();
    expect(setCurrentUser).toHaveBeenCalledWith('u-1', '孙可馨');
  });

  it('setUser 也要写入', () => {
    useAuthStore.getState().setUser(user);
    expect(setCurrentUser).toHaveBeenCalledWith('u-1', '孙可馨');
  });

  it('不在客户端里（没有 electronAPI）不许报错', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    expect(() => useAuthStore.getState().setUser(user)).not.toThrow();
  });
});
