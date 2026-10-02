// craftsman-ignore: TS001
import http from './client';

export interface ParticipantInfo {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  role: string;
}

export interface ConversationSummary {
  id: string;
  participant: ParticipantInfo;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  orderInfo?: string;
  pinned?: boolean;
  isGroup?: boolean;
  groupName?: string;
  groupAvatar?: string;
}

export interface ServerMessage {
  id: string;
  senderId: string;
  text: string;
  content?: string;
  type?: string;
  seq?: number;
  mentions?: string[];
  replyTo?: { id: string; type: string; content: string; senderId: string; seq: number };
  deletedAt?: string;
  attachments?: any[];
  reactions?: any[];
  createdAt: string;
}

export const chatApi = {
  // ── Chat 3.0 endpoints ──

  /** List rooms (Chat 3.0) */
  listRooms(pinned?: boolean, search?: string) {
    return http.get<{ data: { rooms: ConversationSummary[] } }>('/chat/rooms', {
      params: { pinned: pinned ? '1' : undefined, search: search || undefined },
    });
  },

  /** Get or create the current studio's group chat. */
  getStudioGroup() {
    return http.get<{ data: { id: string; groupName: string; isGroup: boolean } }>('/chat/studio-group');
  },

  /** Update room metadata (Chat 3.0) */
  updateRoom(roomId: string, data: { pinned?: boolean; archived?: boolean; orderInfo?: string }) {
    return http.patch<{ data: { room: any } }>(`/chat/rooms/${roomId}`, data);
  },

  /** Create or get existing room (Chat 3.0) */
  createRoom(participantId: string, orderInfo?: string | null) {
    return http.post<{ data: { room: { id: string } } }>('/chat/rooms', { participantId, orderInfo });
  },

  /** Get room messages (Chat 3.0) */
  getRoomMessages(roomId: string, before?: number, after?: number, limit = 50) {
    return http.get<{ data: { messages: ServerMessage[]; hasMore: boolean; peerReadSeq?: number } }>(`/chat/rooms/${roomId}/messages`, {
      params: { before, after, limit },
    });
  },

  /** Send message (Chat 3.0) */
  sendRoomMessage(
    roomId: string,
    data: {
      type?: string;
      content?: string;
      attachments?: any[];
      replyToId?: string;
      mentionUserIds?: string[];
    },
  ) {
    return http.post<{ data: { message: ServerMessage } }>(`/chat/rooms/${roomId}/messages`, data);
  },

  /**
   * 群聊广播：客服/店长在群聊里发一条广播。
   * 内容进群聊，同时本工作室所有在线陪玩的电脑右下角会弹 Windows 提醒（5 秒后自动消失）。
   */
  studioBroadcast(content: string) {
    return http.post<{ data: { roomId: string; messageId: string } }>('/chat/studio-broadcast', { content });
  },

  /** List members of a group room (for @ mentions). */
  getGroupMembers(roomId: string) {
    return http.get<{ data: { members: ParticipantInfo[] } }>(`/chat/rooms/${roomId}/members`);
  },

  /** Mark room read (Chat 3.0) */
  markRoomRead(roomId: string) {
    return http.post<{ data: { readSeq: number } }>(`/chat/rooms/${roomId}/read`);
  },

  /** Mark all rooms read */
  markAllRead() {
    return http.post<{ data: { ok: boolean } }>('/chat/rooms/read-all');
  },

  /** Sync missed messages across rooms */
  syncRooms(rooms: Array<{ roomId: string; lastKnownSeq: number }>) {
    return http.post<{ data: { missedMessages: ServerMessage[]; updatedRooms: any[] } }>('/chat/sync', { rooms });
  },

  /** Upload file */
  uploadFile(file: File) {
    const form = new FormData();
    form.append('file', file);
    return http.post<{
      data: {
        url: string;
        thumbnailUrl?: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        width?: number;
        height?: number;
        duration?: number;
      };
    }>('/chat/upload', form);
  },

  /** Delete (recall) a room message */
  deleteRoomMessage(roomId: string, msgId: string) {
    return http.delete<{ data: { ok: boolean } }>(`/chat/rooms/${roomId}/messages/${msgId}`);
  },

  /** Add reaction to a message */
  addReaction(roomId: string, msgId: string, emoji: string) {
    return http.post<{ data: { reactions: any[] } }>(`/chat/rooms/${roomId}/messages/${msgId}/reactions`, { emoji });
  },

  /** Remove reaction from a message */
  removeReaction(roomId: string, msgId: string, emoji: string) {
    return http.delete<{ data: { reactions: any[] } }>(`/chat/rooms/${roomId}/messages/${msgId}/reactions/${emoji}`);
  },

  /** Search messages */
  searchMessages(query: string, roomId?: string) {
    return http.get<{ data: { results: ServerMessage[] } }>('/chat/search', {
      params: { q: query, roomId },
    });
  },

  /** Get unread summary (Chat 3.0) */
  getUnreadSummary() {
    return http.get<{ data: { totalUnread: number } }>('/chat/unread-summary');
  },

  getUserProfile(userId: string) {
    return http.get<{ data: ParticipantInfo }>(`/chat/users/${userId}/profile`);
  },

  // ── Legacy compatibility (keep existing code working during migration) ──

  listConversations() {
    return http.get<{ data: { conversations: ConversationSummary[] } }>('/chat/conversations');
  },

  /**
   * 开一个会话。orderInfo 的三种叫法（老板 2026-09-30）：
   *   · 传一段订单信息 = 从订单点「沟通」，把这个房间的「这一单」设成它；
   *   · 传 null / 空串   = 明确清掉（人员列表、派单工作台的普通聊天）；
   *   · 压根不传         = 别动服务端记着的那一单（从会话列表、通知铃铛点进来）。
   * 返回里带上 orderInfo：前端据此知道这个房间现在挂着哪一单（服务端是唯一权威）。
   */
  createConversation(participantId: string, orderInfo?: string | null) {
    return http.post<{ data: { id: string; orderInfo?: string | null } }>('/chat/conversations', {
      participantId,
      orderInfo,
    });
  },

  getMessages(conversationId: string, before?: string, limit = 50) {
    // peerReadSeq = 对方读到哪一条（用于「已阅读 / 未读」回执）
    // myReadSeq   = 我自己进来之前读到哪一条（未读起点，用于「跳未读」）
    return http.get<{ data: { messages: ServerMessage[]; hasMore: boolean; peerReadSeq?: number; myReadSeq?: number } }>(
      `/chat/conversations/${conversationId}/messages`,
      { params: { before, limit } },
    );
  },

  sendMessage(conversationId: string, text: string) {
    return http.post<{ data: { message: ServerMessage } }>(`/chat/conversations/${conversationId}/messages`, { text });
  },

  markRead(conversationId: string) {
    return http.post<{ data: { ok: boolean } }>(`/chat/conversations/${conversationId}/read`);
  },

  getUnreadCount() {
    return http.get<{ data: { total: number } }>('/chat/unread-count');
  },
};
