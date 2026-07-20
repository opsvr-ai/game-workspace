## Context

Current chat uses companionId (Companion table PK) as conversation key, but senderId stores User PK — these are different ID namespaces. Messages delivered via 3 parallel paths (WS chat:notify, WS chat:new, 10s poll), each with different field names. Dedup is fragile (text+timestamp). History query only fetches one participant's messages. Each fix exposes another bug.

## Goals / Non-Goals

**Goals:**
- Single source of truth for all chat state (Zustand store)
- All message arrivals converge on one function: `receiveMessage()`
- Conversation identified exclusively by User.id pair (deterministic A/B ordering)
- WeChat-style UI: left/right bubbles, conversation list, unread badges
- Real-time delivery via single WebSocket event, no polling
- Server-assigned UUIDs for dedup
- History survives logout/login

**Non-Goals:**
- File/image sharing beyond existing upload capability (keep current, enhance later)
- Read receipts / typing indicators (WeChat ✓✓ — future scope)
- Group chat (only 1-on-1 conversations)
- Message deletion or editing
- End-to-end encryption

## Decisions

### 1. Conversation model: participantA/participantB deterministic ordering

One row per user pair. A is lexicographically smaller UUID, B is larger. This prevents duplicate conversations and makes lookup O(1) with composite unique constraint.

### 2. HTTP POST for send, WebSocket for receive

Sending goes through HTTP for reliability (the server confirms persistence). Receiving goes through WebSocket for real-time. This avoids the complexity of WS-based send with retry/ack logic.

### 3. Server-assigned message IDs

All message IDs are UUIDs from the database. No client-side ID generation. Dedup is simply: check if `id` already exists in messages array.

### 4. No optimistic updates on send

Wait for server confirmation before showing the message in the store. On localhost this is ~50ms. The send button stays enabled (no artificial UI blocking). Messages appear when the server confirms.

### 5. Single store action: receiveMessage()

Called by:
- WebSocket `chat:message` handler in AppLayout
- HTTP send response handler in ChatInput
- History load (uses `loadMessages` instead, which sets all messages at once)

No other code path adds messages. No component-local state.

### 6. Read tracking: per-conversation lastReadAt on server

Server stores `aReadAt` and `bReadAt` on Conversation. Unread count = messages where `createdAt > myReadAt`. This survives logout, works across devices.

### 7. WeChat-style bubble layout

Messages from others: left-aligned, gray background, avatar visible on first in group.
Messages from me: right-aligned, blue/green background, no avatar.
Time dividers between message groups separated by > 3 minutes.

### 8. Migration: backward-compatible

New tables added alongside old. New endpoints at `/api/chat/*`. Old endpoints at `/api/companions/chat-*` preserved during migration. Frontend switches completely to new system.

## Data Model

```prisma
model Conversation {
  id             String    @id @default(uuid())
  studioId       String
  participantA   String    // User.id (smaller UUID)
  participantB   String    // User.id (larger UUID)
  aReadAt        DateTime?
  bReadAt        DateTime?
  lastMessage    String?
  lastMessageAt  DateTime?
  createdAt      DateTime  @default(now())
  messages       ChatMessage[]

  @@unique([studioId, participantA, participantB])
}

model ChatMessage {
  id             String   @id @default(uuid())
  conversationId String
  senderId       String   // User.id
  text           String
  createdAt      DateTime @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id])
}
```

## API Design

All under `/api/chat`, JWT-guarded.

```
GET    /conversations                    → { conversations: ConversationSummary[] }
GET    /conversations/:id/messages       → { messages: MessageDTO[], hasMore: bool }
POST   /conversations/:id/messages       → { message: MessageDTO }
POST   /conversations                    → { conversation: ConversationSummary }
POST   /conversations/:id/read           → { ok: true }
GET    /unread-count                     → { total: number }
GET    /users/:userId/profile            → { userId, username, displayName, avatar, role }
```

## WebSocket

```
Event: chat:message
Payload: { conversationId: string, message: { id, senderId, text, createdAt } }
```

Server emits to recipient's user socket. Look up user socket by userId.

## Component Architecture

```
AppLayout
├── BellIcon (Badge from store.totalUnread)
│   └── Popover → ConversationList
├── FloatingChatWidget (draggable, Badge from store.totalUnread)
│   └── Popover → ConversationList
├── ChatModal
│   ├── MessageBubble[] (left/right, time dividers)
│   └── ChatInput (textarea + emoji + upload + send)
└── MessageCenterPanel → ConversationList
```

## State Management

```typescript
interface ChatState {
  conversations: Record<string, ConversationState>;
  conversationOrder: string[];
  activeConversationId: string | null;
  totalUnread: number;
  receiveMessage(msg: ServerMessage): void;
  setConversations(list: ConversationSummary[]): void;
  loadMessages(convId: string, msgs: ServerMessage[], hasMore: boolean): void;
  openConversation(id: string, participant: ParticipantInfo): Promise<void>;
  closeConversation(): void;
  markRead(convId: string): void;
  reset(): void;
}
```
