import { create } from 'zustand';

interface ChatState {
  chatActive: boolean;
  chatPartner: string;
  chatCompanionIds: string[];
  chatUnread: Record<string, number>;
  lastReadTs: Record<string, number>;
  isChatOpen: boolean;
  setChatActive: (active: boolean, partner?: string) => void;
  addChatCompanion: (companionId: string) => void;
  clearChatCompanions: () => void;
  addChatUnread: (companionId: string) => void;
  clearChatUnread: (companionId: string) => void;
  markRead: (key: string, msgCount?: number) => void;
  setChatOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chatActive: false,
  chatPartner: '',
  chatCompanionIds: [],
  chatUnread: {},
  lastReadTs: {},
  isChatOpen: false,

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
  addChatUnread: (companionId: string) => set((s) => ({
    chatUnread: { ...s.chatUnread, [companionId]: (s.chatUnread[companionId] || 0) + 1 },
  })),
  clearChatUnread: (companionId: string) => set((s) => {
    const { [companionId]: _, ...rest } = s.chatUnread;
    return { chatUnread: rest };
  }),
  markRead: (key: string, msgCount?: number) => {
    const count = msgCount ?? 0;
    localStorage.setItem(`chat-lastRead-${key}`, String(count));
    set((s) => ({ lastReadTs: { ...s.lastReadTs, [key]: count } as Record<string, number> }));
  },
  setChatOpen: (open: boolean) => set({ isChatOpen: open }),
}));
