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
    try { (window as any).electronAPI?.onLoggedIn?.(); } catch {}

    set({ user, isAuthenticated: true });
    return user;
  },

  logout: async () => {
    const ea = (window as any).electronAPI;
    const role = get().user?.role;
    if (role === 'COMPANION' && ea?.promptLogoutPassword) {
      await ea.promptLogoutPassword();
    }
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    try { await ea?.logout(); } catch {}
    set({ user: null, isAuthenticated: false });
  },

  fetchUser: async () => {
    try {
      const { data } = await authApi.me();
      const user = data.data;
      set({ user, isAuthenticated: true });
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
