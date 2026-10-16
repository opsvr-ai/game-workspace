import { create } from 'zustand';
import type { LoginRequest, UserInfo } from '@chunlv/shared';
import { authApi, clearStoredSession } from '../api/client';

/**
 * 把「这台电脑现在是谁在用」写进客户端本地。
 *
 * 陪玩端台账里的 loginUser 只认客户端本地这一个值（machine-agent 的 getLoginUser 读
 * config.json 的 currentUsername）。以前只有 login() 那一刻写 —— 会话恢复（网页热更刷新、
 * 令牌续期、打开就在登录态）全都不写，于是那台机器在「机器管理」里的 loginUser 永远是空的，
 * 服务器就没法把账号挂到真机器上（2026-10-17 老板问「孙可馨在哪台电脑」时实测：
 * BF-202406300325 那台 loginUser 就是空的，她只能以一行「孙可馨 的电脑（不可诊断）」顶着）。
 * 现在凡是拿到登录态就补写一次：页面一刷新、台账最迟 5 分钟后就能认人。
 */
function rememberClientUser(user: UserInfo | null | undefined): void {
  if (!user?.id || !user?.username) return;
  try { (window as any).electronAPI?.setCurrentUser?.(user.id, user.username); } catch {}
}

/**
 * 把「这个账号是什么角色」告诉客户端**外壳**（老板 2026-10-17：「登录什么就是什么」）。
 *
 * 外壳拿它干两件事：
 *   ① 开关陪玩专属能力 —— 录屏 / 锁屏 / 进程管控 / 陪玩状态上报，全是 `currentRole === 'COMPANION'`
 *      才跑（main.ts 里那几处判断）。客服账号登在陪玩端壳里，这些本来就该关掉。
 *   ② 心跳里报的 `loginRole` 就是这个值 —— 服务端靠它认「这台电脑现在是什么端」。
 *
 * 以前这里只在 `login()` 那一刻调一次，而网页热更刷新 / 令牌续期走的是 `fetchUser()` ——
 * 那条路径不调，外壳的 currentRole 就一直停在初始值 `COMPANION`。于是：客服账号的电脑
 * 热更一轮之后**又被当成陪玩**（陪玩专属能力重新打开、台账继续认错端）。跟
 * `rememberClientUser` 是同一个病根，一起修：登录 / 会话恢复 / setUser 三条路径都写。
 */
function rememberClientRole(user: UserInfo | null | undefined): void {
  const role = String(user?.role || '').trim();
  if (!role) return;
  try { (window as any).electronAPI?.setRole?.(role); } catch {}
}

interface AuthState {
  user: UserInfo | null;
  isAuthenticated: boolean;
  login: (dto: LoginRequest) => Promise<UserInfo>;
  logout: () => void;
  fetchUser: () => Promise<UserInfo | null>;
  setUser: (user: UserInfo) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: !!sessionStorage.getItem('accessToken'),

  login: async (dto: LoginRequest) => {
    const { data } = await authApi.login(dto);
    const { accessToken, refreshToken, user } = data.data;

    sessionStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    try { (window as any).electronAPI?.storeSet('token', accessToken); } catch {}
    try { (window as any).electronAPI?.storeSet('refreshToken', refreshToken); } catch {}
    rememberClientUser(user);
    rememberClientRole(user);
    try { (window as any).electronAPI?.setStudioName?.(user.studioName || ''); } catch {}
    try { (window as any).electronAPI?.onLoggedIn?.(); } catch {}

    set({ user, isAuthenticated: true });
    return user;
  },

  logout: async () => {
    const ea = (window as any).electronAPI;
    const role = get().user?.role;
    // 只有陪玩端需要管理员密码退出；客服/店长/老板直接退出
    if (role === 'COMPANION' && typeof ea?.promptLogoutPassword === 'function') {
      await ea.promptLogoutPassword();
    }
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    // 清除已保存的账号密码，避免退出后又被自动登录
    try { await ea?.logout?.(); } catch {}
    try { await ea?.clearSavedCredentials?.(); } catch {}
    set({ user: null, isAuthenticated: false });
  },

  fetchUser: async () => {
    try {
      const { data } = await authApi.me();
      const user = data.data;
      set({ user, isAuthenticated: true });
      rememberClientUser(user);
      rememberClientRole(user);
      try { (window as any).electronAPI?.setStudioName?.(user.studioName || ''); } catch {}
      return user;
    } catch (err: any) {
      // 只有服务端明确说「这个身份不认了」（401/403，且拦截器已经试过用 refreshToken 续期）
      // 才清登录态。以前是任何异常都清 —— 断网、25 秒超时、服务端重启的 5xx 全都算，
      // 于是办公室那条网一抖，所有人被踢回登录页，还得重新打密码。
      // 这就是「动不动就不自动登录 / 动不动就掉线」的根之一。
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        clearStoredSession();
        set({ user: null, isAuthenticated: false });
      }
      return null;
    }
  },

  setUser: (user: UserInfo) => {
    set({ user, isAuthenticated: true });
    rememberClientUser(user);
    rememberClientRole(user);
  },
}));
