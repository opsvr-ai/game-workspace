import { create } from 'zustand';
import { chatApi, type ConversationSummary, type ServerMessage, type ParticipantInfo } from '../api/chat';

export interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: number; // ms timestamp
}

export interface ConversationState {
  id: string;
  participant: ParticipantInfo;
  messages: Message[];
  hasMore: boolean;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: number;
}

interface ChatState {
  conversations: Record<string, ConversationState>;
  conversationOrder: string[];
  activeConversationId: string | null;
  totalUnread: number;
  myUserId: string | null;

  /** THE single write path — called by WS handler and send response */
  receiveMessage: (convId: string, msg: ServerMessage) => void;

  setConversations: (list: ConversationSummary[]) => void;
  loadMessages: (convId: string, msgs: ServerMessage[], hasMore: boolean) => void;
  prependMessages: (convId: string, msgs: ServerMessage[], hasMore: boolean) => void;

  openConversation: (id: string, participant: ParticipantInfo) => Promise<void>;
  closeConversation: () => void;
  markRead: (convId: string) => void;
  setMyUserId: (id: string) => void;
  reset: () => void;
}

function ensureConv(s: ChatState, id: string, participant?: ParticipantInfo): ChatState {
  if (s.conversations[id]) return s;
  return {
    ...s,
    conversations: {
      ...s.conversations,
      [id]: {
        id,
        participant: participant || { userId: '', username: '...', role: '' },
        messages: [],
        hasMore: true,
        unreadCount: 0,
        lastMessage: '',
        lastMessageAt: 0,
      },
    },
  };
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: {},
  conversationOrder: [],
  activeConversationId: null,
  totalUnread: 0,
  myUserId: null,

  receiveMessage: (convId: string, msg: ServerMessage) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];

      // Dedup by server UUID
      if (conv.messages.some((m) => m.id === msg.id)) return s2;

      const newMsg: Message = {
        id: msg.id,
        senderId: msg.senderId,
        text: msg.text,
        createdAt: new Date(msg.createdAt).getTime(),
      };

      const isActive = s2.activeConversationId === convId;
      const isMine = msg.senderId === s2.myUserId;
      const shouldIncrementUnread = !isActive && !isMine;

      const updatedConv: ConversationState = {
        ...conv,
        messages: [...conv.messages, newMsg].slice(-200),
        unreadCount: shouldIncrementUnread ? conv.unreadCount + 1 : conv.unreadCount,
        lastMessage: msg.text,
        lastMessageAt: newMsg.createdAt,
      };

      // Move to top of order
      const order = [convId, ...s2.conversationOrder.filter((id) => id !== convId)];

      return {
        conversations: { ...s2.conversations, [convId]: updatedConv },
        conversationOrder: order,
        totalUnread: shouldIncrementUnread ? s2.totalUnread + 1 : s2.totalUnread,
      };
    }),

  setConversations: (list: ConversationSummary[]) =>
    set((s) => {
      const conversations: Record<string, ConversationState> = {};
      const order: string[] = [];
      let totalUnread = 0;
      for (const item of list) {
        const existing = s.conversations[item.id];
        conversations[item.id] = {
          id: item.id,
          participant: item.participant,
          messages: existing?.messages || [],
          hasMore: existing?.hasMore ?? true,
          unreadCount: item.unreadCount,
          lastMessage: item.lastMessage || existing?.lastMessage || '',
          lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : existing?.lastMessageAt || 0,
        };
        order.push(item.id);
        totalUnread += item.unreadCount;
      }
      return { conversations, conversationOrder: order, totalUnread };
    }),

  loadMessages: (convId: string, msgs: ServerMessage[], hasMore: boolean) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];
      const existingIds = new Set(conv.messages.map((m) => m.id));
      const newMsgs = msgs
        .filter((m) => !existingIds.has(m.id))
        .map((m) => ({
          id: m.id,
          senderId: m.senderId,
          text: m.text,
          createdAt: new Date(m.createdAt).getTime(),
        }));
      const merged = [...conv.messages, ...newMsgs].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
      return {
        conversations: {
          ...s2.conversations,
          [convId]: { ...conv, messages: merged, hasMore },
        },
      };
    }),

  prependMessages: (convId: string, msgs: ServerMessage[], hasMore: boolean) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];
      const existingIds = new Set(conv.messages.map((m) => m.id));
      const olderMsgs = msgs
        .filter((m) => !existingIds.has(m.id))
        .map((m) => ({
          id: m.id,
          senderId: m.senderId,
          text: m.text,
          createdAt: new Date(m.createdAt).getTime(),
        }));
      const merged = [...olderMsgs, ...conv.messages].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
      return {
        conversations: {
          ...s2.conversations,
          [convId]: { ...conv, messages: merged, hasMore },
        },
      };
    }),

  openConversation: async (id: string, participant: ParticipantInfo) => {
    set((s) => {
      const s2 = ensureConv(s, id, participant);
      return {
        ...s2,
        activeConversationId: id,
        conversations: {
          ...s2.conversations,
          [id]: { ...s2.conversations[id], participant },
        },
      };
    });
    // Load history
    try {
      const { data } = await chatApi.getMessages(id);
      const msgs = data?.data?.messages || [];
      const hasMore = data?.data?.hasMore ?? false;
      if (msgs.length > 0) {
        useChatStore.getState().loadMessages(id, msgs, hasMore);
      }
    } catch {}
    // Mark read
    chatApi.markRead(id).catch(() => {});
    useChatStore.getState().markRead(id);
  },

  closeConversation: () =>
    set((s) => {
      if (!s.activeConversationId) return { activeConversationId: null };
      const conv = s.conversations[s.activeConversationId];
      if (!conv) return { activeConversationId: null };
      const unread = conv.unreadCount;
      return {
        activeConversationId: null,
        conversations: {
          ...s.conversations,
          [s.activeConversationId]: { ...conv, unreadCount: 0 },
        },
        totalUnread: Math.max(0, s.totalUnread - unread),
      };
    }),

  markRead: (convId: string) =>
    set((s) => {
      const conv = s.conversations[convId];
      if (!conv) return s;
      const unread = conv.unreadCount;
      return {
        conversations: {
          ...s.conversations,
          [convId]: { ...conv, unreadCount: 0 },
        },
        totalUnread: Math.max(0, s.totalUnread - unread),
      };
    }),

  setMyUserId: (id: string) => set({ myUserId: id }),

  reset: () =>
    set({
      conversations: {},
      conversationOrder: [],
      activeConversationId: null,
      totalUnread: 0,
    }),
}));
