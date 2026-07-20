import { create } from 'zustand';

// ── Types ──

export interface ChatMessage {
  id: string;
  companionId: string;
  companionName: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
  read: boolean;
}

export interface CompanionChat {
  companionId: string;
  companionName: string;
  messages: ChatMessage[];
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: number;
}

interface AddMessageInput {
  companionId: string;
  companionName: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
}

// ── Helpers ──

let msgIdCounter = Date.now();
function nextId(): string {
  return `msg-${++msgIdCounter}`;
}

// ── Store ──

interface ChatState {
  chats: Record<string, CompanionChat>;
  totalUnread: number;
  activeCompanionId: string | null;
  isChatOpen: boolean;
  lastSoundPlayedAt: Record<string, number>;

  addMessage: (msg: AddMessageInput) => void;
  loadHistory: (companionId: string, companionName: string, messages: Omit<ChatMessage, 'read'>[]) => void;
  markAllRead: (companionId: string) => void;
  markAllUnreadClean: () => void;
  openChat: (companionId: string) => void;
  closeChat: () => void;
  markSoundPlayed: (companionId: string, timestamp: number) => void;
}

function ensureChat(s: ChatState, companionId: string, companionName: string): ChatState {
  if (s.chats[companionId]) return s;
  return {
    ...s,
    chats: {
      ...s.chats,
      [companionId]: {
        companionId,
        companionName,
        messages: [],
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: 0,
      },
    },
  };
}

export const useChatStore = create<ChatState>((set) => ({
  chats: {},
  totalUnread: 0,
  activeCompanionId: null,
  isChatOpen: false,
  lastSoundPlayedAt: {},

  addMessage: (input: AddMessageInput) =>
    set((s) => {
      const s2 = ensureChat(s, input.companionId, input.companionName);
      const chat = s2.chats[input.companionId];

      // Dedup
      const exists = chat.messages.some((m) => m.text === input.text && m.timestamp === input.timestamp);
      if (exists) return s2;

      const msg: ChatMessage = {
        ...input,
        id: nextId(),
        read: s2.activeCompanionId === input.companionId,
      };

      const isActive = s2.activeCompanionId === input.companionId;
      const updatedMessages = [...chat.messages, msg].slice(-200);
      const updatedChat: CompanionChat = {
        ...chat,
        messages: updatedMessages,
        unreadCount: isActive ? chat.unreadCount : chat.unreadCount + 1,
        lastMessage: input.text,
        lastMessageTime: input.timestamp,
      };

      return {
        chats: { ...s2.chats, [input.companionId]: updatedChat },
        totalUnread: isActive ? s2.totalUnread : s2.totalUnread + 1,
      };
    }),

  loadHistory: (companionId: string, companionName: string, msgs: Omit<ChatMessage, 'read'>[]) =>
    set((s) => {
      const s2 = ensureChat(s, companionId, companionName);
      const chat = s2.chats[companionId];
      const existingIds = new Set(chat.messages.map((m) => m.id));
      const newMsgs = msgs.filter((m) => !existingIds.has(m.id)).map((m) => ({ ...m, read: true })); // history is always read
      const merged = [...chat.messages, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp).slice(-200);
      return {
        chats: {
          ...s2.chats,
          [companionId]: { ...chat, messages: merged },
        },
      };
    }),

  markAllRead: (companionId: string) =>
    set((s) => {
      const chat = s.chats[companionId];
      if (!chat) return s;
      const unreadBefore = chat.unreadCount;
      return {
        chats: {
          ...s.chats,
          [companionId]: {
            ...chat,
            messages: chat.messages.map((m) => ({ ...m, read: true })),
            unreadCount: 0,
          },
        },
        totalUnread: Math.max(0, s.totalUnread - unreadBefore),
      };
    }),

  markAllUnreadClean: () =>
    set((s) => {
      let total = 0;
      const chats: Record<string, CompanionChat> = {};
      for (const key of Object.keys(s.chats)) {
        const c = s.chats[key];
        const msgs = c.messages.map((m) => ({ ...m, read: true }));
        chats[key] = { ...c, messages: msgs, unreadCount: 0 };
        total += c.unreadCount;
      }
      return { chats, totalUnread: 0 };
    }),

  openChat: (companionId: string) =>
    set(() => ({
      activeCompanionId: companionId,
      isChatOpen: true,
    })),

  closeChat: () =>
    set((s) => {
      const companionId = s.activeCompanionId;
      if (!companionId) return { isChatOpen: false, activeCompanionId: null };
      // Mark all read for the closing chat
      const chat = s.chats[companionId];
      const unread = chat?.unreadCount ?? 0;
      return {
        isChatOpen: false,
        activeCompanionId: null,
        chats: chat
          ? {
              ...s.chats,
              [companionId]: {
                ...chat,
                messages: chat.messages.map((m) => ({ ...m, read: true })),
                unreadCount: 0,
              },
            }
          : s.chats,
        totalUnread: Math.max(0, s.totalUnread - unread),
      };
    }),

  markSoundPlayed: (companionId: string, timestamp: number) =>
    set((s) => ({
      lastSoundPlayedAt: { ...s.lastSoundPlayedAt, [companionId]: timestamp },
    })),
}));
