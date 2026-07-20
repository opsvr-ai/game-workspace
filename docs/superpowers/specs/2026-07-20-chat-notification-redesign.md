# Chat Notification System Redesign — Companion-Centric Message Architecture

**Date:** 2026-07-20
**Status:** Approved

---

## Problem Statement

CS dispatch workbench, bell notification, and floating chat widget show **inconsistent message content** for the same companion. Root cause: messages are keyed by `orderId`, but different codepaths resolve different `orderId` values for the same companion.

| Entry Point | orderId Source | Bug |
|---|---|---|
| Dispatch companion click | `last-orderId-{id}` or any matching order | Fallback can match stale order |
| Bell notification click | `last-orderId-{id}` only | **Silent fail** if key missing |
| Poll loop message storage | Server picks most-recent-message's orderId | orderId can be wrong companion's |
| ChatModal real-time receive | Strict `msg.orderId === partner.orderId` | Mismatch → **messages silently dropped** |

Additionally, when unread messages exist, the bell icon lacks visible animation effects.

---

## Design — Companion-Centric Architecture

### 1. Data Model (chatStore rewrite)

**Old:** Messages scattered in localStorage keyed by orderId. Notifications stored separately as summaries.

**New:** All messages live in Zustand store, indexed by `companionId`.

```typescript
interface ChatMessage {
  id: string;
  companionId: string;
  companionName: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
  read: boolean;
}

interface CompanionChat {
  companionId: string;
  companionName: string;
  messages: ChatMessage[];     // max 200, sorted by timestamp
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: number;
}

interface ChatState {
  chats: Record<string, CompanionChat>;   // companionId → chat data
  totalUnread: number;
  activeCompanionId: string | null;
  isChatOpen: boolean;
  lastSoundPlayedAt: Record<string, number>;

  addMessage(msg: Omit<ChatMessage, 'id' | 'read'>): void;
  loadHistory(companionId: string, messages: ChatMessage[]): void;
  markAllRead(companionId: string): void;
  openChat(companionId: string): void;
  closeChat(): void;
}
```

**Key changes:**
- Messages indexed by companionId, not orderId — all messages from/to same companion merge into one view
- In-memory store (Zustand) as single source of truth, not localStorage
- Built-in read/unread tracking per message

### 2. Single Write Path

All 3 message arrival paths converge on `chatStore.addMessage()`:

```
WebSocket chat:notify ─┐
WebSocket chat:new    ─┼──→ chatStore.addMessage(msg) ──→ chats[companionId].messages
Poll chat-pending     ─┘         │
                                  ├── unreadCount++ (if chat not open)
                                  ├── totalUnread++
                                  ├── Update notification UI (bell + bubble)
                                  └── Play sound (if conditions met)
```

`addMessage()` logic: dedup by text+timestamp, append to messages (cap 200), increment unreadCount if companionId !== activeCompanionId, update lastMessage.

### 3. Unified Chat Open

All 3 entry points use the same `chatStore.openChat(companionId)`:

```
Bell click ──→ chatStore.openChat(companionId) ──→ ChatModal reads from store
Bubble click ──→
Dispatch click ──→
```

- ChatModal reads messages from `chats[companionId].messages` — no localStorage, no server poll
- `openChat()` sets `activeCompanionId`, fetches full history from new API `GET /chat/history/:companionId`, merges into store
- `closeChat()` calls `markAllRead(companionId)` — clears unread, marks all messages read
- ChatPartner simplified: `{ companionId, companionName, avatar? }` — no more orderId

### 4. Visual Effects

**Bell icon:**
- Independent glow container div for `pulse-glow` animation (not on Button)
- Unread: blue breathing glow (2s infinite) + bell shake (0.8s once) + Badge count
- All effects stop instantly on click/read

**Floating bubble:**
- `totalUnread > 0` drives continuous pulse animation
- `totalUnread` increment triggers bounce animation
- Hover: scale 1.08 + enhanced shadow
- Drag: opacity 0.7 while dragging

### 5. Message Center Panel (new)

Bell click opens a message center panel instead of just a notification list:

```
┌─ 消息中心 ──────────────────────────┐
│  📌 未读 (3)            [全部已读]  │
│                                     │
│  🔴 张三                     2条   │
│     最新消息预览...          1分钟前  │
│                                     │
│  🔴 李四                     1条   │
│     在吗？                  5分钟前  │
│                                     │
│  ── 已读 ──                         │
│    王五                             │
│    好的收到                  昨天    │
└─────────────────────────────────────┘
```

Features: unread/read grouping, "Mark all read" button, click to open ChatModal, empty state, 340px × 480px max.

### 6. Server Changes

**New API:** `GET /api/chat/history/:companionId`
- Returns all messages involving this companion (across all orders), ascending, max 200
- SQL: messages sent BY companion OR messages in orders assigned TO companion, within same studio

**Existing:** `POST /companions/chat-notify` and `GET /companions/chat-pending` kept mostly unchanged, simplified on frontend side.

---

## Implementation Plan

| Step | Files | Description |
|------|-------|-------------|
| 1 | `chatStore.ts` | Rewrite: ChatMessage + CompanionChat model, addMessage/markAllRead/openChat/closeChat |
| 2 | `chat.service.ts` | Add `getMessagesByCompanion(studioId, companionId)` |
| 3 | `companions.controller.ts` | Add `GET /chat/history/:companionId` endpoint |
| 4 | `ChatModal.tsx` | Read from store, remove localStorage, remove server poll in useEffect |
| 5 | `AppLayout.tsx` | Simplify poll + WS handlers → `addMessage()`; rewrite bell styling; new MessageCenterPanel |
| 6 | `FloatingChatWidget.tsx` | Read from store, `totalUnread`-driven animations |
| 7 | `CSDispatchView.tsx` | Remove custom orderId resolution, use `chatStore.openChat()` |
| 8 | `global.css` | Optimize pulse-glow container, bounce trigger, message center styles |

---

## Verification

1. `tsc --noEmit` — zero new type errors
2. CS login → dispatch workbench → click companion → ChatModal shows correct messages
3. Bell notification → click → same ChatModal, same messages (not different orderId)
4. Floating bubble → click → same messages
5. Unread badge: bell + bubble both show correct count, decrement on read
6. Bell: blue glow visible when unread > 0, stops when cleared
7. Bubble: pulse when unread > 0, bounce on new message arrival
8. Companion login → receives notifications, sees messages correctly
9. Sound: plays once per new message, suppressed when chat open
