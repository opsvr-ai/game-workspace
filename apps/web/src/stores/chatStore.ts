// craftsman-ignore: TS001
import { create } from 'zustand';
import { chatApi, type ConversationSummary, type ParticipantInfo } from '../api/chat';
import { cacheMessages, loadCachedMessages, cleanupCache } from '../workers/chat-db';

export interface Message {
  id: string;
  senderId: string;
  text: string; // Backward-compatible alias for content
  content?: string; // Chat 3.0 content field
  type?: string; // TEXT | IMAGE | FILE | AUDIO | ORDER_CARD | SYSTEM
  seq?: number; // Chat 3.0 sequence number
  replyTo?: { id: string; type: string; content: string; senderId: string; seq: number };
  deletedAt?: string;
  attachments?: Array<{
    id: string;
    type: string;
    url: string;
    thumbnailUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    width?: number;
    height?: number;
    duration?: number;
  }>;
  reactions?: Array<{ userId: string; emoji: string }>;
  status?: 'pending' | 'sent' | 'failed'; // Optimistic update status
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
  orderInfo?: string;
  pinned?: boolean;
  lastKnownSeq?: number; // Chat 3.0: for sync gap detection
}

interface ChatState {
  conversations: Record<string, ConversationState>;
  conversationOrder: string[];
  activeConversationId: string | null;
  totalUnread: number;
  myUserId: string | null;
  syncing: boolean;

  /** THE single write path for incoming messages (WS + send response) */
  receiveMessage: (convId: string, msg: any, orderInfo?: string) => void;

  setConversations: (list: ConversationSummary[]) => void;
  loadMessages: (convId: string, msgs: any[], hasMore: boolean) => void;
  prependMessages: (convId: string, msgs: any[], hasMore: boolean) => void;

  openConversation: (participantId: string, participant: ParticipantInfo, orderInfo?: string) => Promise<void>;
  closeConversation: () => void;
  markRead: (convId: string) => void;
  setMyUserId: (id: string) => void;
  setSyncing: (v: boolean) => void;
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

function normalizeMessage(msg: any): Message {
  const text = msg.text || msg.content || '';
  const createdAt = msg.createdAt
    ? typeof msg.createdAt === 'string'
      ? new Date(msg.createdAt).getTime()
      : msg.createdAt
    : Date.now();
  return {
    id: msg.id,
    senderId: msg.senderId,
    text,
    content: msg.content,
    type: msg.type || 'TEXT',
    seq: msg.seq,
    replyTo: msg.replyTo,
    deletedAt: msg.deletedAt,
    attachments: msg.attachments || [],
    reactions: msg.reactions || [],
    status: msg.status,
    createdAt,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  conversationOrder: [],
  activeConversationId: null,
  totalUnread: 0,
  myUserId: null,
  syncing: false,

  receiveMessage: (convId: string, msg: any, orderInfo?: string) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];

      // Dedup by server UUID
      if (conv.messages.some((m) => m.id === msg.id)) return s2;

      const newMsg = normalizeMessage(msg);

      const isActive = s2.activeConversationId === convId;
      const isMine = msg.senderId === s2.myUserId;
      const shouldIncrementUnread = !isActive && !isMine;

      const updatedConv: ConversationState = {
        ...conv,
        messages: [...conv.messages, newMsg].slice(-200),
        unreadCount: shouldIncrementUnread ? conv.unreadCount + 1 : conv.unreadCount,
        lastMessage: newMsg.text.slice(0, 100),
        lastMessageAt: newMsg.createdAt,
        orderInfo: orderInfo || conv.orderInfo,
        lastKnownSeq: msg.seq || conv.lastKnownSeq,
      };

      // Move to top of order
      const order = [convId, ...s2.conversationOrder.filter((id) => id !== convId)];

      // Persist to IndexedDB (fire-and-forget)
      cacheMessages(convId, [newMsg]).catch(() => {});

      return {
        conversations: { ...s2.conversations, [convId]: updatedConv },
        conversationOrder: order,
        totalUnread: shouldIncrementUnread ? s2.totalUnread + 1 : s2.totalUnread,
      };
    }),

  setConversations: (list: ConversationSummary[]) =>
    set((s) => {
      const conversations: Record<string, ConversationState> = { ...s.conversations };
      const orderSet = new Set(s.conversationOrder);
      let totalUnread = 0;

      for (const item of list) {
        const existing = s.conversations[item.id];
        const unread = item.unreadCount ?? 0;

        conversations[item.id] = {
          id: item.id,
          participant: item.participant,
          messages: existing?.messages || [],
          hasMore: existing?.hasMore ?? true,
          unreadCount: unread,
          lastMessage: item.lastMessage || existing?.lastMessage || '',
          lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : existing?.lastMessageAt || 0,
          orderInfo: item.orderInfo || existing?.orderInfo,
          pinned: (item as any).pinned,
          lastKnownSeq: existing?.lastKnownSeq,
        };

        if (!orderSet.has(item.id)) {
          orderSet.add(item.id);
        }
        totalUnread += unread;
      }

      return {
        conversations,
        conversationOrder: [...orderSet],
        totalUnread,
      };
    }),

  loadMessages: (convId: string, msgs: any[], hasMore: boolean) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];
      const existingIds = new Set(conv.messages.map((m) => m.id));
      const newMsgs = msgs.filter((m) => !existingIds.has(m.id)).map(normalizeMessage);
      const merged = [...conv.messages, ...newMsgs].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
      // Persist to IndexedDB
      cacheMessages(convId, newMsgs).catch(() => {});
      cleanupCache().catch(() => {});

      const lastMsg = merged[merged.length - 1];
      return {
        conversations: {
          ...s2.conversations,
          [convId]: {
            ...conv,
            messages: merged,
            hasMore,
            lastKnownSeq: lastMsg?.seq || conv.lastKnownSeq,
          },
        },
      };
    }),

  prependMessages: (convId: string, msgs: any[], hasMore: boolean) =>
    set((s) => {
      const s2 = ensureConv(s, convId);
      const conv = s2.conversations[convId];
      const existingIds = new Set(conv.messages.map((m) => m.id));
      const olderMsgs = msgs.filter((m) => !existingIds.has(m.id)).map(normalizeMessage);
      const merged = [...olderMsgs, ...conv.messages].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
      return {
        conversations: {
          ...s2.conversations,
          [convId]: { ...conv, messages: merged, hasMore },
        },
      };
    }),

  openConversation: async (participantId: string, participant: ParticipantInfo, orderInfo?: string) => {
    let convId = participantId;
    try {
      const { data } = await chatApi.createConversation(participant.userId || participantId, orderInfo);
      convId = data?.data?.id || participantId;
    } catch {}

    set((s) => {
      const s2 = ensureConv(s, convId, participant);
      return {
        ...s2,
        activeConversationId: convId,
        conversations: {
          ...s2.conversations,
          [convId]: {
            ...s2.conversations[convId],
            participant,
            orderInfo: orderInfo || s2.conversations[convId]?.orderInfo,
          },
        },
      };
    });

    // Load from IndexedDB cache first (instant), then sync from API
    loadCachedMessages(convId)
      .then((cached) => {
        if (cached.length > 0) {
          get().loadMessages(convId, cached, true);
        }
      })
      .catch(() => {});

    try {
      const { data } = await chatApi.getMessages(convId);
      const msgs = data?.data?.messages || [];
      const hasMore = data?.data?.hasMore ?? false;
      if (msgs.length > 0) {
        get().loadMessages(convId, msgs, hasMore);
        cacheMessages(convId, msgs).catch(() => {});
      }
    } catch {}

    // Mark read
    chatApi.markRead(convId).catch(() => {});
    get().markRead(convId);
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
  setSyncing: (v: boolean) => set({ syncing: v }),
  reset: () =>
    set({
      conversations: {},
      conversationOrder: [],
      activeConversationId: null,
      totalUnread: 0,
      syncing: false,
    }),
}));
