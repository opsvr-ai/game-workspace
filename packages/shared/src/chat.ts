/** Shared types for WeChat-style chat system */

export interface ParticipantDTO {
  userId: string;
  username: string;
  displayName?: string;
  avatar?: string;
  role: string;
}

export interface ConversationSummaryDTO {
  id: string;
  participant: ParticipantDTO;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface MessageDTO {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface SendMessageRequest {
  text: string;
}

export interface CreateConversationRequest {
  participantId: string;
}
