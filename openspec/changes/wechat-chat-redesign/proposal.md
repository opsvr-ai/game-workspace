## Why

The current chat system has fundamental architectural flaws — companionId/UserId confusion, 3 redundant message handlers, polling fallback with orderId gaps, fragile text+timestamp dedup — causing a cascade of bugs (duplicate messages, missing history, unread persistence). Each fix exposes another issue. Rather than continuing incremental patches, we need a clean-sheet redesign modeled on WeChat's proven interaction patterns.

## What Changes

- **New data model**: `Conversation` + `ChatMessage` tables with deterministic participant pairing (User.id only, never Companion table ID)
- **New REST API** (`/api/chat/*`): 7 clean endpoints for conversations, messages, read status, and user profiles
- **Single WebSocket event** (`chat:message`): replaces `chat:notify`, `chat:new`, and `chat:send` — no polling
- **Single write path**: `chatStore.receiveMessage()` — every message arrival (WS, HTTP response) converges here
- **Single read path**: all components read from store, no component-local message state
- **WeChat-style UI**: ChatModal with left/right bubbles, ConversationList with unread badges, MessageBubble component
- **Zero local ID generation**: all message IDs from server, dedup by UUID
- **Server-confirmed sends**: no optimistic updates (simplifies state, ~50ms latency on localhost)
- **Removal of**: companionId-as-chat-key, orderId on messages, 10s polling, component-local state, text+timestamp dedup
- **BREAKING**: Old ChatMessage database table replaced; old `/companions/chat-*` endpoints deprecated (kept during migration)

## Capabilities

### New Capabilities

- `conversation-model`: Conversation data model with deterministic participant pairing, read tracking, and message storage
- `chat-api`: REST API for conversations (list, create, read-status) and messages (send, history)
- `chat-realtime`: Single WebSocket event for real-time message delivery, no polling
- `chat-store`: Single Zustand store with receiveMessage() as sole write path, conversation state, unread tracking
- `chat-ui-wechat`: WeChat-style chat UI — ConversationList, ChatModal with bubbles, MessageBubble, ChatInput, BellIcon badge, FloatingChatWidget

### Modified Capabilities

None — this is a greenfield redesign within the existing chat feature. Old endpoints preserved during migration.

## Impact

- **Database**: New `Conversation` + `ChatMessage` models (Prisma migration). Old `ChatMessage` renamed to `ChatMessageLegacy` during migration.
- **Server**: New `ChatModule` (controller + service). `WsGateway` gains `notifyNewMessage()`. `CompanionsController` chat endpoints deprecated.
- **Frontend**: `chatStore` rewritten. `ChatModal` rewritten. New components: `ConversationList`, `MessageBubble`, `ChatInput`. `AppLayout` simplified (poll removed, single WS handler). `FloatingChatWidget` + `MessageCenterPanel` updated. `useSocket` simplified.
- **Packages/shared**: New `chat.ts` with shared types.
