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
  mentions?: string[];
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
  isGroup?: boolean;
  groupName?: string;
  groupAvatar?: string;
  lastMentions?: string[];
  lastKnownSeq?: number; // Chat 3.0: for sync gap detection
  /**
   * 对方在这个会话里读到哪一条（Chat 3.0 的 peer read seq）。
   * undefined = 还不知道（别显示「未读」，否则一进会话会闪一片未读）。
   * 用来在「我发的消息」下面标「已阅读 / 未读」。
   */
  peerReadSeq?: number;
}

interface ChatState {
  conversations: Record<string, ConversationState>;
  conversationOrder: string[];
  activeConversationId: string | null;
  totalUnread: number;
  myUserId: string | null;
  syncing: boolean;

  /** THE single write path for incoming messages (WS + send response) */
  receiveMessage: (
    convId: string,
    msg: any,
    orderInfo?: string,
    senderInfo?: any,
    roomMeta?: { isGroup?: boolean; groupName?: string },
  ) => void;

  setConversations: (list: ConversationSummary[]) => void;
  loadMessages: (convId: string, msgs: any[], hasMore: boolean) => void;
  prependMessages: (convId: string, msgs: any[], hasMore: boolean) => void;

  openConversation: (participantId: string, participant: ParticipantInfo, orderInfo?: string | null) => Promise<void>;
  closeConversation: () => void;
  markRead: (convId: string) => void;
  /** 记录对方读到哪一条（服务端返回或 WebSocket 推来） */
  setPeerReadSeq: (convId: string, seq: number) => void;
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
    mentions: msg.mentions || [],
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

  receiveMessage: (
    convId: string,
    msg: any,
    orderInfo?: string,
    senderInfo?: any,
    roomMeta?: { isGroup?: boolean; groupName?: string },
  ) =>
    set((s) => {
      const isGroupRoom = !!roomMeta?.isGroup;
      const groupName = roomMeta?.groupName || '工作室群聊';
      const participant = isGroupRoom
        ? { userId: '', username: groupName, displayName: groupName, role: 'GROUP' }
        : senderInfo
          ? {
              userId: senderInfo.userId,
              username: senderInfo.username || '...',
              displayName: senderInfo.displayName,
              avatar: senderInfo.avatar,
              role: senderInfo.role || '',
            }
          : undefined;
      let s2 = ensureConv(s, convId, participant);
      let conv = s2.conversations[convId];

      // 群聊实时消息要始终按“群”建模，不能把发送者当成会话对象。
      if (isGroupRoom && (!conv.isGroup || conv.participant?.role !== 'GROUP')) {
        conv = {
          ...conv,
          isGroup: true,
          groupName,
          participant: { userId: '', username: groupName, displayName: groupName, role: 'GROUP' },
        };
        s2 = {
          ...s2,
          conversations: { ...s2.conversations, [convId]: conv },
        };
      } else if (participant && conv && !conv.participant.userId) {
        // 首次收到实时消息时，本地还没有会话、participant 是空占位；用发送者信息补全。
        conv = {
          ...conv,
          participant,
        };
        s2 = {
          ...s2,
          conversations: { ...s2.conversations, [convId]: conv },
        };
      }

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
        lastMentions: newMsg.mentions?.length ? newMsg.mentions : conv.lastMentions,
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
          orderInfo: item.orderInfo || undefined,
          pinned: (item as any).pinned,
          isGroup: (item as any).isGroup,
          groupName: (item as any).groupName,
          groupAvatar: (item as any).groupAvatar,
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

  openConversation: async (participantId: string, participant: ParticipantInfo, orderInfo?: string | null) => {
    let convId = participantId;
    // 只有拿到真实 userId 才去服务端建/查会话；否则（例如从通知进入且 participant 缺失）
    // 直接用传入的 roomId，避免把 roomId 当 userId 再建出幽灵会话。
    if (participant?.userId) {
      try {
        const { data } = await chatApi.createConversation(participant.userId, orderInfo ?? undefined);
        convId = data?.data?.id || participantId;
      } catch {}
    }

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
            orderInfo: orderInfo ?? undefined,
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
      // 对方读到哪一条：用来渲染「已阅读 / 未读」
      const peerReadSeq = data?.data?.peerReadSeq;
      if (typeof peerReadSeq === 'number') get().setPeerReadSeq(convId, peerReadSeq);
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

  setPeerReadSeq: (convId: string, seq: number) =>
    set((s) => {
      const conv = s.conversations[convId];
      if (!conv || !Number.isFinite(seq)) return s;
      if ((conv.peerReadSeq ?? -1) >= seq) return s;
      return {
        conversations: { ...s.conversations, [convId]: { ...conv, peerReadSeq: seq } },
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
      myUserId: null,
    }),
}));
