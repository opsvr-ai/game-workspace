# Chat Store

## Overview

Single Zustand store for all chat state. No component-local message state. No localStorage for messages.

## State Shape

```typescript
interface ConversationState {
  id: string;
  participant: { userId: string; username: string; displayName?: string; avatar?: string; role: string };
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
}
```

## Actions

### receiveMessage(msg)

THE single write path. Called only by:
- WebSocket `chat:message` handler (AppLayout)
- HTTP send response handler (ChatInput)

Logic:
1. If conversation not in store, create entry
2. If message with `msg.id` already exists in messages[], return (dedup by server UUID)
3. Append to messages[]
4. Update lastMessage, lastMessageAt
5. Move conversation to top of conversationOrder
6. If `msg.senderId !== currentUserId && conversation.id !== activeConversationId`: unreadCount++, totalUnread++
7. If `conversation.id === activeConversationId`: auto-mark as read

### setConversations(list)

Called on app init and reconnect. Sets all conversations from server response.

### openConversation(id, participant)

Called when user opens a chat:
1. Set activeConversationId
2. Fetch history from GET /conversations/:id/messages
3. Call `loadMessages()` to populate store
4. POST /conversations/:id/read (fire-and-forget)
5. Call `markRead()` locally

### closeConversation()

Called when chat modal closes:
1. If activeConversationId, call `markRead()`
2. Set activeConversationId = null

### markRead(convId)

1. Set conversation.unreadCount = 0
2. Recalculate totalUnread

### reset()

Clear all state. Called on logout.

## Requirements

- Messages keyed by server-assigned UUID — no local ID generation
- Dedup by message.id only — no text+timestamp comparison
- `unreadCount` incremented only when sender != current user AND conversation not active
- UI reads from store only — no separate component-level message arrays
