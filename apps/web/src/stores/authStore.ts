import { create } from 'zustand';
import type { LoginRequest, UserInfo } from '@chunlv/shared';
import { authApi } from '../api/client';

interface AuthState {
  user: UserInfo | null;
  isAuthenticated: boolean;
  chatActive: boolean;
  chatPartner: string;
  login: (dto: LoginRequest) => Promise<UserInfo>;
  logout: () => void;
  fetchUser: () => Promise<UserInfo | null>;
  setUser: (user: UserInfo) => void;
  setChatActive: (active: boolean, partner?: string) => void;
  chatCompanionIds: string[];
  addChatCompanion: (companionId: string) => void;
  clearChatCompanions: () => void;
  chatUnread: Record<string, number>;
  addChatUnread: (companionId: string) => void;
  clearChatUnread: (companionId: string) => void;
  lastReadTs: Record<string, number>;
  markRead: (key: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!sessionStorage.getItem('accessToken'),
  chatActive: false,
  chatPartner: '',
  chatCompanionIds: [],

  login: async (dto: LoginRequest) => {
    const { data } = await authApi.login(dto);
    const { accessToken, refreshToken, user } = data.data;

    sessionStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);

    set({ user, isAuthenticated: true });
    return user;
  },

  logout: () => {
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
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
  setChatActive: (active: boolean, partner?: string) => {
    set({ chatActive: active, chatPartner: partner || '' });
  },
  addChatCompanion: (companionId: string) => {
    set((s) => ({
      chatCompanionIds: s.chatCompanionIds.includes(companionId)
        ? s.chatCompanionIds
        : [companionId, ...s.chatCompanionIds],
    }));
  },
  clearChatCompanions: () => set({ chatCompanionIds: [] }),
  chatUnread: {},
  addChatUnread: (companionId: string) => set((s) => ({
    chatUnread: { ...s.chatUnread, [companionId]: (s.chatUnread[companionId] || 0) + 1 },
  })),
  clearChatUnread: (companionId: string) => set((s) => {
    const { [companionId]: _, ...rest } = s.chatUnread;
    return { chatUnread: rest };
  }),
  lastReadTs: {},
  markRead: (key: string) => {
    const now = Date.now();
    localStorage.setItem(`chat-lastRead-${key}`, String(now));
    set((s) => ({ lastReadTs: { ...s.lastReadTs, [key]: now } }));
  },
}));
