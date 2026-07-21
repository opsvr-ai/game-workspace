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
}

export interface ServerMessage {
  id: string;
  senderId: string;
  text: string;
  content?: string;
  type?: string;
  seq?: number;
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

  /** Update room metadata (Chat 3.0) */
  updateRoom(roomId: string, data: { pinned?: boolean; archived?: boolean; orderInfo?: string }) {
    return http.patch<{ data: { room: any } }>(`/chat/rooms/${roomId}`, data);
  },

  /** Create or get existing room (Chat 3.0) */
  createRoom(participantId: string, orderInfo?: string) {
    return http.post<{ data: { room: { id: string } } }>('/chat/rooms', { participantId, orderInfo });
  },

  /** Get room messages (Chat 3.0) */
  getRoomMessages(roomId: string, before?: number, after?: number, limit = 50) {
    return http.get<{ data: { messages: ServerMessage[]; hasMore: boolean } }>(`/chat/rooms/${roomId}/messages`, {
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
    },
  ) {
    return http.post<{ data: { message: ServerMessage } }>(`/chat/rooms/${roomId}/messages`, data);
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
    }>('/chat/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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

  createConversation(participantId: string, orderInfo?: string) {
    return http.post<{ data: { id: string } }>('/chat/conversations', { participantId, orderInfo });
  },

  getMessages(conversationId: string, before?: string, limit = 50) {
    return http.get<{ data: { messages: ServerMessage[]; hasMore: boolean } }>(
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
