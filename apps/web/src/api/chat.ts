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
}

export interface ServerMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export const chatApi = {
  listConversations() {
    return http.get<{ data: { conversations: ConversationSummary[] } }>('/chat/conversations');
  },

  createConversation(participantId: string) {
    return http.post<{ data: { id: string } }>('/chat/conversations', { participantId });
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

  getUserProfile(userId: string) {
    return http.get<{ data: ParticipantInfo }>(`/chat/users/${userId}/profile`);
  },
};
