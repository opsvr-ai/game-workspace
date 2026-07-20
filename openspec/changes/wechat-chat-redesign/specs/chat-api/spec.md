# Chat API

## Overview

REST API at `/api/chat`. All endpoints JWT-guarded. All identifiers are User.id (UUID).

## Endpoints

### GET /conversations

Returns all conversations for the authenticated user, ordered by lastMessageAt desc.

Response: `{ conversations: [{ id, participant: { userId, username, displayName, avatar, role }, lastMessage, lastMessageAt, unreadCount }] }`

### GET /conversations/:id/messages

Returns messages for a conversation. Cursor-based pagination.

Query: `before` (DateTime cursor, optional), `limit` (default 50, max 100)

Response: `{ messages: [{ id, senderId, text, createdAt }], hasMore: boolean }`

### POST /conversations/:id/messages

Send a message. Validates sender is a conversation participant.

Body: `{ text: string }` (1-5000 chars, non-empty after trim)

Response: `{ message: { id, senderId, text, createdAt } }`

Side effects: Updates Conversation.lastMessage/lastMessageAt. Emits `chat:message` WebSocket event to the OTHER participant.

### POST /conversations

Create or get existing conversation. Idempotent — returns existing conversation if one already exists for the user pair.

Body: `{ participantId: string }` (User.id to chat with)

Response: `{ conversation: { id, ... } }`

### POST /conversations/:id/read

Mark conversation as read for the authenticated user. Updates `aReadAt` or `bReadAt` based on which participant the user is.

Response: `{ ok: true }`

### GET /unread-count

Returns total unread count across all conversations for the authenticated user.

Response: `{ total: number }`

### GET /users/:userId/profile

Resolves User.id to display info for chat UI.

Response: `{ userId, username, displayName, avatar, role }`

## Requirements

- Sender must be a participant of the conversation (403 otherwise)
- Messages ordered by createdAt ASC
- `conversations` endpoint resolves participant info (username, avatar) for the OTHER user
- `lastMessage` on conversation is a text preview, truncated to 100 chars
