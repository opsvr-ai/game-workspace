import { create } from 'zustand';
import type { LoginRequest, UserInfo } from '@chunlv/shared';
import { authApi } from '../api/client';

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
    try { (window as any).electronAPI?.setRole?.(user.role); } catch {}
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
      try { (window as any).electronAPI?.setStudioName?.(user.studioName || ''); } catch {}
      return user;
    } catch {
      sessionStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      set({ user: null, isAuthenticated: false });
      return null;
    }
  },

  setUser: (user: UserInfo) => {
    set({ user, isAuthenticated: true });
  },
}));
