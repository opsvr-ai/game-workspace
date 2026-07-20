# WeChat-Style Chat System Redesign

## Context

Current chat system has fundamental flaws: companionId vs userId confusion, 3 separate message handlers, polling-based fallback, fragile dedup. User wants a complete WeChat-style redesign.

## Architecture Decision

**A conversation is between two Users, identified exclusively by `User.id` (UUID).**

Key design rules:
1. ONE write path: `chatStore.receiveMessage()`
2. ONE read path: store → components
3. ONE ID type: userId (User.id), never Companion table ID
4. ONE WS event: `chat:message`
5. NO polling
6. ALL message IDs from server, no local generation
7. NO optimistic updates

## Database — New Models

```prisma
model Conversation {
  id             String    @id @default(uuid())
  studioId       String
  participantA   String    // smaller User.id UUID
  participantB   String    // larger User.id UUID
  aReadAt        DateTime?
  bReadAt        DateTime?
  lastMessageAt  DateTime?
  lastMessage    String?
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
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}
```

## API — 7 endpoints under `/api/chat`

| Method | Path | Purpose |
|--------|------|---------|
| GET | /conversations | List my conversations |
| GET | /conversations/:id/messages?before=&limit=50 | Message history |
| POST | /conversations/:id/messages | Send message |
| POST | /conversations | Create/get conversation |
| POST | /conversations/:id/read | Mark read |
| GET | /unread-count | Total unread |
| GET | /users/:userId/profile | User display info |

## WebSocket

Single event: `chat:message { conversationId, message: { id, senderId, text, createdAt } }`

## State — chatStore rewrite

```
conversations: { [id]: { messages[], unreadCount, lastMessage, participant... } }
conversationOrder: string[]  // sorted by lastMessageAt
activeConversationId: string | null
totalUnread: number

receiveMessage(msg) — SINGLE write path
openConversation(id, participant) — load history + mark read
closeConversation() — mark read
reset() — on logout
```

## Components

- **ConversationList** — WeChat-style chat list (full + mini for bell/bubble popovers)
- **ChatModal** — store-driven, WeChat-style bubbles
- **MessageBubble** — left (gray) / right (blue) bubbles with timestamps
- **ChatInput** — textarea + emoji + upload + send
- **BellIcon** → popover → ConversationList
- **FloatingChatWidget** → popover → ConversationList

## Migration — 3 phases

1. **Backend** — new models + endpoints, old endpoints preserved
2. **Frontend** — new components + store, old code removed
3. **Cleanup** — drop old ChatMessage table, remove old endpoints

## Files Changed

| File | Action |
|------|--------|
| `apps/server/prisma/schema.prisma` | Add Conversation + new ChatMessage |
| `apps/server/src/chat/chat.module.ts` | New |
| `apps/server/src/chat/chat.controller.ts` | New |
| `apps/server/src/chat/chat.service.ts` | Rewrite |
| `apps/server/src/ws/ws.gateway.ts` | Add notifyNewMessage |
| `apps/web/src/api/chat.ts` | New |
| `apps/web/src/stores/chatStore.ts` | Rewrite |
| `apps/web/src/components/ConversationList.tsx` | New |
| `apps/web/src/components/MessageBubble.tsx` | New |
| `apps/web/src/components/ChatInput.tsx` | New |
| `apps/web/src/components/ChatModal.tsx` | Rewrite |
| `apps/web/src/layouts/AppLayout.tsx` | Remove poll, simplify WS |
| `apps/web/src/components/FloatingChatWidget.tsx` | Update |
| `apps/web/src/components/MessageCenterPanel.tsx` | Update |
| `apps/web/src/hooks/useSocket.ts` | Simplify |

## Verification

1. `tsc --noEmit` both projects — zero errors
2. CS sends to companion → real-time delivery, WeChat-style bubbles
3. Companion sends to CS → same
4. Logout/login → all history preserved
5. Bell badge clears on open chat, not before
6. Sound only when chat not focused
7. No duplicate messages on any path
