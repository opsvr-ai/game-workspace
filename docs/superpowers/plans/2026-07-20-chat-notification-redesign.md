# Chat Notification System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat notification system with a companion-centric Zustand store as single source of truth, eliminating orderId-based message mismatch across all entry points.

**Architecture:** All message arrival paths (WebSocket `chat:notify`, `chat:new`, poll loop) converge on `chatStore.addMessage()`. All chat-open paths (bell, bubble, dispatch) use `chatStore.openChat(companionId)`. ChatModal reads messages directly from store. Messages indexed by `companionId` not `orderId`.

**Tech Stack:** React 18, Zustand 5, Ant Design 5, NestJS, Prisma, PostgreSQL, Socket.IO

## Global Constraints

- Zero new npm dependencies
- All chat state in Zustand store (not localStorage)
- Messages indexed by companionId, never by orderId
- COMPANION role also sees notifications (removed gate in prior commit)
- Sound suppressed when chat is already open (isChatOpen check)
- Follow existing project patterns: inline styles + React.createElement for Ant Design icons
- File paths relative to git root `/data/project/game-workspace`

---

### Task 1: Server — Add getMessagesByCompanion to ChatService

**Files:**
- Modify: `apps/server/src/chat/chat.service.ts`

**Interfaces:**
- Consumes: PrismaService (existing)
- Produces: `getMessagesByCompanion(studioId: string, companionId: string, limit?: number): Promise<ChatMessageData[]>`

- [ ] **Step 1: Add getMessagesByCompanion method**

Append the following method inside the `ChatService` class, after the existing `getRecentMessages` method:

```typescript
/** Get complete chat history for a companion — all orders */
async getMessagesByCompanion(
  studioId: string,
  companionId: string,
  limit = 200,
): Promise<ChatMessageData[]> {
  try {
    return await this.prisma.chatMessage.findMany({
      where: {
        studioId,
        OR: [
          { senderId: companionId },
          { order: { companionId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  } catch (err) {
    logger.error('Failed to fetch companion chat history', {
      studioId,
      companionId,
      error: (err as Error).message,
    });
    return [];
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/server && npx tsc --noEmit 2>&1 | grep -i error | head -5`
Expected: no errors related to `chat.service.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/chat/chat.service.ts
git commit -m "feat: add getMessagesByCompanion to ChatService for companion-centric chat queries"
```

---

### Task 2: Server — Add GET /chat/history/:companionId endpoint

**Files:**
- Modify: `apps/server/src/companions/companions.controller.ts`

**Interfaces:**
- Consumes: ChatService.getMessagesByCompanion (from Task 1)
- Produces: `GET /api/companions/chat-history/:companionId`

- [ ] **Step 1: Add endpoint**

Insert into `CompanionsController`, after the existing `chatPending` endpoint:

```typescript
@Get('chat-history/:companionId')
async chatHistory(
  @Req() req: AuthenticatedRequest,
  @Param('companionId') companionId: string,
) {
  const user = req.user;
  if (!user?.studioId) {
    throw new UnauthorizedException('未登录');
  }
  const messages = await this.chatService.getMessagesByCompanion(
    user.studioId,
    companionId,
    200,
  );
  return { data: { companionId, messages } };
}
```

- [ ] **Step 2: Verify imports**

Check that `Param` is imported from `@nestjs/common` at the top of the file. If not, add it to the existing import line.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/server && npx tsc --noEmit 2>&1 | grep -i error | head -5`
Expected: no errors related to `companions.controller.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/companions/companions.controller.ts
git commit -m "feat: add GET /chat-history/:companionId endpoint for full companion chat history"
```

---

### Task 3: Frontend — Rewrite chatStore with companion-centric model

**Files:**
- Modify: `apps/web/src/stores/chatStore.ts`

**Interfaces:**
- Produces: All types and actions used by Tasks 4-8

- [ ] **Step 1: Replace entire file content**

```typescript
import { create } from 'zustand';

// ── Types ──

export interface ChatMessage {
  id: string;
  companionId: string;
  companionName: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
  read: boolean;
}

export interface CompanionChat {
  companionId: string;
  companionName: string;
  messages: ChatMessage[];
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: number;
}

interface AddMessageInput {
  companionId: string;
  companionName: string;
  senderId: string;
  senderRole: string;
  text: string;
  timestamp: number;
}

// ── Helpers ──

let msgIdCounter = Date.now();
function nextId(): string {
  return `msg-${++msgIdCounter}`;
}

// ── Store ──

interface ChatState {
  chats: Record<string, CompanionChat>;
  totalUnread: number;
  activeCompanionId: string | null;
  isChatOpen: boolean;
  lastSoundPlayedAt: Record<string, number>;

  addMessage: (msg: AddMessageInput) => void;
  loadHistory: (companionId: string, companionName: string, messages: Omit<ChatMessage, 'read'>[]) => void;
  markAllRead: (companionId: string) => void;
  markAllUnreadClean: () => void;
  openChat: (companionId: string) => void;
  closeChat: () => void;
  markSoundPlayed: (companionId: string, timestamp: number) => void;
}

function ensureChat(s: ChatState, companionId: string, companionName: string): ChatState {
  if (s.chats[companionId]) return s;
  return {
    ...s,
    chats: {
      ...s.chats,
      [companionId]: {
        companionId,
        companionName,
        messages: [],
        unreadCount: 0,
        lastMessage: '',
        lastMessageTime: 0,
      },
    },
  };
}

export const useChatStore = create<ChatState>((set) => ({
  chats: {},
  totalUnread: 0,
  activeCompanionId: null,
  isChatOpen: false,
  lastSoundPlayedAt: {},

  addMessage: (input: AddMessageInput) =>
    set((s) => {
      const s2 = ensureChat(s, input.companionId, input.companionName);
      const chat = s2.chats[input.companionId];

      // Dedup
      const exists = chat.messages.some(
        (m) => m.text === input.text && m.timestamp === input.timestamp,
      );
      if (exists) return s2;

      const msg: ChatMessage = {
        ...input,
        id: nextId(),
        read: s2.activeCompanionId === input.companionId,
      };

      const isActive = s2.activeCompanionId === input.companionId;
      const updatedMessages = [...chat.messages, msg].slice(-200);
      const updatedChat: CompanionChat = {
        ...chat,
        messages: updatedMessages,
        unreadCount: isActive ? chat.unreadCount : chat.unreadCount + 1,
        lastMessage: input.text,
        lastMessageTime: input.timestamp,
      };

      return {
        chats: { ...s2.chats, [input.companionId]: updatedChat },
        totalUnread: isActive ? s2.totalUnread : s2.totalUnread + 1,
      };
    }),

  loadHistory: (companionId: string, companionName: string, msgs: Omit<ChatMessage, 'read'>[]) =>
    set((s) => {
      const s2 = ensureChat(s, companionId, companionName);
      const chat = s2.chats[companionId];
      const existingIds = new Set(chat.messages.map((m) => m.id));
      const newMsgs = msgs
        .filter((m) => !existingIds.has(m.id))
        .map((m) => ({ ...m, read: true })); // history is always read
      const merged = [...chat.messages, ...newMsgs]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-200);
      return {
        chats: {
          ...s2.chats,
          [companionId]: { ...chat, messages: merged },
        },
      };
    }),

  markAllRead: (companionId: string) =>
    set((s) => {
      const chat = s.chats[companionId];
      if (!chat) return s;
      const unreadBefore = chat.unreadCount;
      return {
        chats: {
          ...s.chats,
          [companionId]: {
            ...chat,
            messages: chat.messages.map((m) => ({ ...m, read: true })),
            unreadCount: 0,
          },
        },
        totalUnread: Math.max(0, s.totalUnread - unreadBefore),
      };
    }),

  markAllUnreadClean: () =>
    set((s) => {
      let total = 0;
      const chats: Record<string, CompanionChat> = {};
      for (const key of Object.keys(s.chats)) {
        const c = s.chats[key];
        const msgs = c.messages.map((m) => ({ ...m, read: true }));
        chats[key] = { ...c, messages: msgs, unreadCount: 0 };
        total += c.unreadCount;
      }
      return { chats, totalUnread: 0 };
    }),

  openChat: (companionId: string) =>
    set((s) => ({
      activeCompanionId: companionId,
      isChatOpen: true,
    })),

  closeChat: () =>
    set((s) => {
      if (!s.activeCompanionId) return { isChatOpen: false, activeCompanionId: null };
      // Mark all read for the closing chat
      const chat = s.chats[s.activeCompanionId];
      const unread = chat?.unreadCount ?? 0;
      return {
        isChatOpen: false,
        activeCompanionId: null,
        chats: chat
          ? {
              ...s.chats,
              [s.activeCompanionId!]: {
                ...chat,
                messages: chat.messages.map((m) => ({ ...m, read: true })),
                unreadCount: 0,
              },
            }
          : s.chats,
        totalUnread: Math.max(0, s.totalUnread - unread),
      };
    }),

  markSoundPlayed: (companionId: string, timestamp: number) =>
    set((s) => ({
      lastSoundPlayedAt: { ...s.lastSoundPlayedAt, [companionId]: timestamp },
    })),
}));
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "chatStore" | head -5`
Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/chatStore.ts
git commit -m "refactor: rewrite chatStore with companion-centric data model

- ChatMessage and CompanionChat types indexed by companionId
- addMessage() as single write path with dedup and unread tracking
- loadHistory() for server-side message hydration
- openChat/closeChat with automatic read marking
- Replace ChatNotification with CompanionChat"
```

---

### Task 4: Frontend — Simplify ChatModal to read from store

**Files:**
- Modify: `apps/web/src/components/ChatModal.tsx`

**Interfaces:**
- Consumes: ChatMessage, useChatStore (from Task 3)
- Produces: Updated ChatModal component (same props, internal changed)

- [ ] **Step 1: Update ChatPartner interface and remove localStorage helpers**

Replace lines 9-45 (ChatMsg/ChatPartner interfaces + loadMsgs/saveMsgs) with:

```typescript
interface ChatPartner {
  companionId: string;
  companionName: string;
  avatar?: string;
}

interface Props {
  open: boolean;
  partner: ChatPartner | null;
  onClose: () => void;
}
```

Remove the entire `STORAGE_PREFIX`, `loadMsgs`, and `saveMsgs` functions.

- [ ] **Step 2: Rewrite the message-loading useEffect (lines 79-110)**

Replace with:

```typescript
useEffect(() => {
  if (!open || !partner?.companionId) return;
  const store = useChatStore.getState();
  store.openChat(partner.companionId);

  // Load messages from store
  const chat = store.chats[partner.companionId];
  const storedMsgs = chat?.messages.map((m) => ({
    text: m.text,
    time: formatTime(m.timestamp),
    from: m.senderId === user?.id ? 'me' : 'them',
  })) ?? [];
  setMsgs(storedMsgs as any);

  // Fetch full history from server
  http.get(`/companions/chat-history/${partner.companionId}`).then(({ data }) => {
    const serverMsgs: any[] = data?.data?.messages ?? [];
    if (serverMsgs.length > 0) {
      store.loadHistory(
        partner.companionId,
        partner.companionName,
        serverMsgs.map((m: any) => ({
          id: m.id,
          companionId: m.senderId === user?.id ? (m.order?.companionId ?? partner.companionId) : m.senderId,
          companionName: partner.companionName,
          senderId: m.senderId,
          senderRole: m.senderRole,
          text: m.text,
          timestamp: new Date(m.createdAt).getTime(),
        })),
      );
      // Re-read after merge
      const updated = store.chats[partner.companionId];
      const mergedMsgs = updated?.messages.map((m) => ({
        text: m.text,
        time: formatTime(m.timestamp),
        from: m.senderId === user?.id ? 'me' : 'them',
      })) ?? [];
      setMsgs(mergedMsgs as any);
    }
  }).catch(() => {});

  // Listen for new messages from store (poll-driven)
  const unsubscribe = useChatStore.subscribe((state) => {
    const p = partnerRef.current;
    if (!p) return;
    const c = state.chats[p.companionId];
    if (!c) return;
    setMsgs(
      c.messages.map((m) => ({
        text: m.text,
        time: formatTime(m.timestamp),
        from: m.senderId === user?.id ? 'me' : 'them',
      })) as any,
    );
  });

  return () => {
    unsubscribe();
    useChatStore.getState().closeChat();
  };
}, [open, partner?.companionId]);
```

Add helper at top of component:

```typescript
function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

- [ ] **Step 3: Update handleClose (line 203-209)**

Replace with:

```typescript
const handleClose = () => {
  useChatStore.getState().closeChat();
  onClose();
};
```

- [ ] **Step 4: Update send function (line 155-173)**

Replace the body construction with:

```typescript
const body: any = {
  companionId: partner.companionId,
  message: text,
  time,
};
```

- [ ] **Step 5: Remove the chat-message event listener**

The `useEffect` rewrite in Step 2 already replaces the old `handler` + `window.addEventListener('chat-message', handler)` pattern. Verify there are no remaining references to `chat-message` or `CustomEvent` in the file.

- [ ] **Step 6: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "ChatModal" | head -5`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ChatModal.tsx
git commit -m "refactor: simplify ChatModal — read messages from chatStore, remove localStorage

- ChatPartner simplified to { companionId, companionName, avatar? }
- Messages loaded from chatStore.chats[companionId] instead of localStorage
- New chat-history API call to hydrate full history
- Zustand subscribe replaces custom-event listener pattern
- closeChat() auto-marks all messages as read"
```

---

### Task 5: Frontend — Create MessageCenterPanel component

**Files:**
- Create: `apps/web/src/components/MessageCenterPanel.tsx`

**Interfaces:**
- Consumes: useChatStore (from Task 3), useAuthStore (existing)
- Produces: React.FC<{ onOpenChat: (companionId: string, companionName: string) => void; onClose: () => void }>

- [ ] **Step 1: Create the component file**

```typescript
import React from 'react';
import { List, Typography, Button, Badge } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useChatStore } from '../stores/chatStore';

interface Props {
  onOpenChat: (companionId: string, companionName: string) => void;
  onClose: () => void;
}

const MessageCenterPanel: React.FC<Props> = ({ onOpenChat, onClose }) => {
  const { chats, totalUnread, markAllRead, markAllUnreadClean } = useChatStore();

  const items = Object.values(chats)
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

  const unreadItems = items.filter((c) => c.unreadCount > 0);
  const readItems = items.filter((c) => c.unreadCount === 0);

  if (items.length === 0) {
    return (
      <div style={{ width: 300, textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>
        <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>💬</div>
        暂无消息
      </div>
    );
  }

  const panelWidth = 340;
  const maxHeight = 480;

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderItem = (c: typeof items[0]) => (
    <List.Item
      key={c.companionId}
      style={{
        cursor: 'pointer',
        padding: '10px 12px',
        borderRadius: 6,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      onClick={() => {
        markAllRead(c.companionId);
        onOpenChat(c.companionId, c.companionName);
        onClose();
      }}
    >
      <List.Item.Meta
        avatar={
          <div style={{ position: 'relative' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: c.unreadCount > 0 ? 'linear-gradient(135deg, #2563EB, #3B82F6)' : '#CBD5E1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>
                {(c.companionName || '?')[0].toUpperCase()}
              </span>
            </div>
            {c.unreadCount > 0 && (
              <Badge count={c.unreadCount} size="small"
                style={{ position: 'absolute', top: -6, right: -6 }} />
            )}
          </div>
        }
        title={
          <span style={{ fontWeight: c.unreadCount > 0 ? 700 : 500, fontSize: 13 }}>
            {c.companionName}
          </span>
        }
        description={
          <div>
            <Typography.Text style={{ fontSize: 12, color: '#64748B' }} ellipsis>
              {c.lastMessage || ''}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 11, color: '#94A3B8', float: 'right' }}>
              {formatTime(c.lastMessageTime)}
            </Typography.Text>
          </div>
        }
      />
    </List.Item>
  );

  return (
    <div style={{ width: panelWidth, maxHeight, overflowY: 'auto' }}>
      {/* Header with mark-all-read */}
      {totalUnread > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 0 8px', borderBottom: '1px solid #F0F0F0', marginBottom: 4,
        }}>
          <Typography.Text strong style={{ fontSize: 13, color: '#1E293B' }}>
            📌 未读 ({totalUnread})
          </Typography.Text>
          <Button type="link" size="small" icon={React.createElement(CheckOutlined)}
            onClick={(e) => { e.stopPropagation(); markAllUnreadClean(); }}
            style={{ fontSize: 12 }}>
            全部已读
          </Button>
        </div>
      )}

      {/* Unread items */}
      {unreadItems.length > 0 && (
        <List size="small" dataSource={unreadItems} renderItem={renderItem} split={false} />
      )}

      {/* Read divider */}
      {readItems.length > 0 && unreadItems.length > 0 && (
        <Typography.Text style={{
          display: 'block', fontSize: 11, color: '#94A3B8',
          padding: '8px 0 4px', borderTop: '1px solid #F0F0F0',
        }}>
          已读
        </Typography.Text>
      )}

      {/* Read items */}
      {readItems.length > 0 && (
        <List size="small" dataSource={readItems} renderItem={renderItem} split={false} />
      )}
    </div>
  );
};

export { MessageCenterPanel };
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "MessageCenterPanel" | head -5`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/MessageCenterPanel.tsx
git commit -m "feat: add MessageCenterPanel — unified message center with unread/read grouping"
```

---

### Task 6: Frontend — Update AppLayout (simplify handlers, bell styling, message center)

**Files:**
- Modify: `apps/web/src/layouts/AppLayout.tsx`

**Interfaces:**
- Consumes: MessageCenterPanel (Task 5), updated chatStore (Task 3), notificationSound (existing)
- Produces: Updated AppLayout with simplified handlers and new bell

- [ ] **Step 1: Update imports**

Add at top of imports:

```typescript
import { MessageCenterPanel } from '../components/MessageCenterPanel';
```

Remove the inline `NotificationList` component (lines ~181-296), replacing its usage with `MessageCenterPanel`.

Remove unused imports after removing NotificationList: `List` from antd import (if no longer used elsewhere — keep it, it's used for menuItems).

- [ ] **Step 2: Simplify socket event handlers**

Replace the `onChatNotify` handler (lines ~383-406) with:

```typescript
onChatNotify: (data: any) => {
  if (data?.companionId) {
    const store = useChatStore.getState();
    store.addMessage({
      companionId: data.companionId,
      companionName: data.companionName || data.companionId,
      senderId: data.companionId,
      senderRole: 'COMPANION',
      text: data.message || '',
      timestamp: Date.now(),
    });
    if (!store.isChatOpen) {
      const ts = Date.now();
      if (ts > (store.lastSoundPlayedAt[data.companionId] ?? 0)) {
        playMessageSound();
        store.markSoundPlayed(data.companionId, ts);
      }
    }
  }
  if (data?.companionName) {
    notify({ title: data.companionName, body: data.message || '发来一条消息' });
  }
},
```

Replace the `onChatNew` handler (lines ~410-444) with same pattern:

```typescript
onChatNew: (data: any) => {
  const companionId = data.companionId || data.senderId;
  if (!companionId) return;
  const store = useChatStore.getState();
  store.addMessage({
    companionId,
    companionName: data.senderName || companionId,
    senderId: data.senderId,
    senderRole: data.senderRole || 'COMPANION',
    text: data.text || '',
    timestamp: Date.now(),
  });
  if (!store.isChatOpen) {
    const ts = Date.now();
    if (ts > (store.lastSoundPlayedAt[companionId] ?? 0)) {
      playMessageSound();
      store.markSoundPlayed(companionId, ts);
    }
  }
  if (data?.senderName) {
    notify({ title: data.senderName, body: data.text || '新消息' });
  }
},
```

- [ ] **Step 3: Simplify poll loop (lines ~447-533)**

Replace the entire poll loop `useEffect` with:

```typescript
// Global chat poll — dispatches to chatStore.addMessage
useEffect(() => {
  if (!user?.studioId) return;
  const seenKeys = new Set<string>();
  const poll = async () => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) return;
      const res = await fetch(`/api/companions/chat-pending?_t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = await res.json();
      const data = json.data || json;

      if (data?.messages?.length) {
        const store = useChatStore.getState();
        for (const m of data.messages) {
          const dedupKey = `${m.text}|${m.time}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);

          const companionId = data.companionId || m.senderId;
          store.addMessage({
            companionId,
            companionName: data.companionName || companionId,
            senderId: m.senderId,
            senderRole: m.senderRole || 'COMPANION',
            text: m.text,
            timestamp: new Date(m.time || Date.now()).getTime(),
          });
        }

        if (!store.isChatOpen && data.companionId) {
          const ts = Date.now();
          if (ts > (store.lastSoundPlayedAt[data.companionId] ?? 0)) {
            playMessageSound();
            store.markSoundPlayed(data.companionId, ts);
          }
        }
      }
    } catch {}
  };
  poll();
  const t = setInterval(poll, 10000);
  return () => clearInterval(t);
}, [user?.studioId]);
```

- [ ] **Step 4: Update bell Popover to use MessageCenterPanel**

Find the bell Popover (around line 722-750) and replace the `content` prop:

```typescript
content={
  <MessageCenterPanel
    onOpenChat={openChatFromNotification}
    onClose={() => setNotifOpen(false)}
  />
}
```

Remove the old `<NotificationList>` component definition entirely.

- [ ] **Step 5: Update openChatFromNotification**

The `openChatFromNotification` callback already reads `last-orderId-{companionId}`. Simplify it to directly call `chatStore.openChat`:

```typescript
const openChatFromNotification = useCallback((companionId: string, companionName: string) => {
  setNotifOpen(false);
  setGlobalChatPartner({
    companionId,
    companionName,
    orderInfo: user?.role === 'COMPANION' ? `客服` : `陪玩: ${companionName}`,
  });
  useChatStore.getState().markAllRead(companionId);
}, [user?.role]);
```

- [ ] **Step 6: Enhance bell visual styling**

Update the bell Badge area:

```typescript
<Badge count={totalUnread} overflowCount={99} size="default" offset={[-2, 8]}>
  <div
    style={{
      borderRadius: 8,
      ...(totalUnread > 0
        ? {
            animation: 'bell-glow 2s ease-in-out infinite',
            boxShadow: '0 0 12px rgba(37, 99, 235, 0.5)',
          }
        : {}),
    }}
  >
    <Button
      type="text"
      icon={React.createElement(BellOutlined)}
      style={{
        color: totalUnread > 0 ? '#2563EB' : '#64748B',
        fontSize: 20,
      }}
      className={totalUnread > 0 ? 'bell-animate' : ''}
    />
  </div>
</Badge>
```

Note: wrapping the Button in a div for the glow animation ensures `box-shadow` renders properly (Button inline styles can conflict with antd internals).

- [ ] **Step 7: Update `totalUnread` source**

Replace the `totalUnread` computation from `useMemo(() => Object.values(chatUnread).reduce(...))` to read directly from store:

```typescript
const totalUnread = useChatStore((s) => s.totalUnread);
```

- [ ] **Step 8: Update menuItems badge (line 552-588)**

Replace `chatActive` / `chatPartner` references with:

```typescript
const menuItems = useMemo(() => {
  if (!user) return [];
  const items = [...(roleMenus[user.role] || [])];
  return items.map((item) => {
    if ((item.label === '陪玩管理' || item.label === '员工管理') && totalUnread > 0) {
      return {
        ...item,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {item.label}
            <Badge count={totalUnread} size="small" overflowCount={99}
              style={{ boxShadow: totalUnread > 0 ? '0 0 10px #FF4757' : undefined }} />
          </span>
        ),
      };
    }
    return item;
  });
}, [user, totalUnread]);
```

- [ ] **Step 9: Update ChatModal rendering**

Update the global ChatModal partner prop format:

```typescript
<ChatModal
  open={!!globalChatPartner}
  partner={
    globalChatPartner
      ? {
          companionId: globalChatPartner.companionId,
          companionName: globalChatPartner.companionName,
        }
      : null
  }
  onClose={() => setGlobalChatPartner(null)}
/>
```

- [ ] **Step 10: Update FloatingChatWidget props**

Update to pass `onOpenChat` callback (same as before, no changes needed).

- [ ] **Step 11: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "AppLayout" | head -10`
Expected: no errors related to our changes

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/layouts/AppLayout.tsx
git commit -m "refactor: simplify AppLayout chat handlers — all paths through chatStore.addMessage

- WebSocket and poll handlers converge on chatStore.addMessage()
- Bell popover uses MessageCenterPanel instead of inline NotificationList
- openChatFromNotification simplified — no more orderId dependency
- Bell glow wrapped in dedicated div container for reliable rendering
- Menu badge driven by totalUnread from store"
```

---

### Task 7: Frontend — Update FloatingChatWidget for new store API

**Files:**
- Modify: `apps/web/src/components/FloatingChatWidget.tsx`

**Interfaces:**
- Consumes: useChatStore (from Task 3) — `chats`, `totalUnread`, `markAllRead`
- Produces: Updated component using new store shape

- [ ] **Step 1: Update imports and data reads**

Replace the destructured store reads:

```typescript
const { chats, totalUnread } = useChatStore();
```

Remove `chatNotifications` and `chatUnread` — they no longer exist.

- [ ] **Step 2: Update notification list to read from chats**

Replace the `deduped` computation with:

```typescript
const notificationItems = Object.values(chats)
  .filter((c) => c.messages.length > 0)
  .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
  .slice(0, 10);
```

- [ ] **Step 3: Update bounce animation trigger**

Replace `prevNotifCount` tracking with:

```typescript
const prevTotalUnread = useRef(totalUnread);

useEffect(() => {
  if (totalUnread > prevTotalUnread.current) {
    setBounce(true);
    const t = setTimeout(() => setBounce(false), 500);
    prevTotalUnread.current = totalUnread;
    return () => clearTimeout(t);
  }
  prevTotalUnread.current = totalUnread;
}, [totalUnread]);
```

- [ ] **Step 4: Update notification list render**

Replace `deduped` references with `notificationItems`. Update the render to use `c.unreadCount` instead of `chatUnread[item.companionId]`:

```typescript
const unread = c.unreadCount;
```

And use `c.lastMessage` / `c.lastMessageTime` for display.

- [ ] **Step 5: Update click handler**

Replace `onOpenChat(item.companionId, item.companionName)` with one that calls markAllRead first:

```typescript
onClick={() => {
  useChatStore.getState().markAllRead(c.companionId);
  onOpenChat(c.companionId, c.companionName);
  setPopoverOpen(false);
}}
```

- [ ] **Step 6: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "FloatingChatWidget" | head -5`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/FloatingChatWidget.tsx
git commit -m "refactor: update FloatingChatWidget for new chatStore API

- Read from chats and totalUnread instead of chatNotifications/chatUnread
- Bounce triggered by totalUnread increment (not array length)
- Click marks messages as read before opening chat"
```

---

### Task 8: Frontend — Update CSDispatchView to use chatStore.openChat

**Files:**
- Modify: `apps/web/src/pages/dispatch/CSDispatchView.tsx`

**Interfaces:**
- Consumes: useChatStore (from Task 3) — `openChat`
- Produces: Updated companion click handler

- [ ] **Step 1: Find and replace companion click handler**

Find the companion list item onClick (around line 270-309). Replace the orderId resolution logic with:

```typescript
onClick={() => {
  useChatStore.getState().markAllRead(c.id);
  useChatStore.getState().openChat(c.id);
  setChatPartner({
    companionId: c.id,
    companionName: c.user?.username || c.id,
    avatar: c.user?.avatar || undefined,
  });
  setSelectedCompanionId(c.id);
}}
```

- [ ] **Step 2: Remove unused orderId resolution variables**

Remove: `notifOrderId`, `matchedOrder`, `chatOrderId`, and the localStorage reads associated with them. Remove any unused `poolOrders`/`allOrders` references in the click handler if they were only used for orderId matching.

- [ ] **Step 3: Update ChatModal render props**

Find the ChatModal render (around line 678) and update the partner prop:

```typescript
<ChatModal
  open={!!chatPartner}
  partner={
    chatPartner
      ? {
          companionId: chatPartner.companionId,
          companionName: chatPartner.companionName,
        }
      : null
  }
  onClose={() => { setChatPartner(null); setSelectedCompanionId(null); }}
/>
```

- [ ] **Step 4: Remove companion-specific unread localStorage operations**

Remove `localStorage.removeItem('unread-${c.id}')` and similar calls — unread is now managed by chatStore.

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "CSDispatchView" | head -10`
Expected: no errors related to our changes

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/dispatch/CSDispatchView.tsx
git commit -m "refactor: simplify CSDispatchView companion chat — use chatStore.openChat

- Remove orderId resolution logic (localStorage reads, fallback matching)
- Use chatStore.openChat + markAllRead for unified chat opening
- ChatPartner simplified to companionId+companionName"
```

---

### Task 9: Frontend — Optimize global.css animations

**Files:**
- Modify: `apps/web/src/styles/global.css`

- [ ] **Step 1: Replace existing float and bell animations**

Find the existing `float-pulse`, `float-bounce`, `bell-glow` keyframes (added in prior commit) and replace with optimized versions:

```css
/* ── Floating chat widget ── */
@keyframes float-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 0 14px rgba(37, 99, 235, 0);
    transform: scale(1.03);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
    transform: scale(1);
  }
}

@keyframes float-bounce {
  0% { transform: scale(1); }
  25% { transform: scale(1.2); }
  50% { transform: scale(0.9); }
  75% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

@keyframes bell-glow {
  0% { box-shadow: 0 0 4px rgba(37, 99, 235, 0.4); }
  50% { box-shadow: 0 0 16px rgba(37, 99, 235, 0.7); }
  100% { box-shadow: 0 0 4px rgba(37, 99, 235, 0.4); }
}

@keyframes badge-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

.float-widget-pulse {
  animation: float-pulse 2.5s ease-in-out infinite;
}

.float-widget-bounce {
  animation: float-bounce 0.5s ease-out;
}

.bell-glow-active {
  animation: bell-glow 2s ease-in-out infinite;
}
```

- [ ] **Step 2: Verify no CSS syntax errors**

Run: `cd apps/web && npx vite build 2>&1 | grep -i "css\|error" | head -5`
Expected: successful build, no CSS errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/global.css
git commit -m "style: optimize chat notification animations

- float-pulse: add scale breathing + larger ring spread
- float-bounce: 4-keyframe bounce for more natural feel
- bell-glow: stronger max-shadow for visibility
- Add badge-pop keyframe for unread count change"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: TypeScript compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -c error
```
Expected: 0 new errors (pre-existing ones are OK)

- [ ] **Step 2: Vite build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```
Expected: "✓ built in Xms"

- [ ] **Step 3: Server TypeScript compilation**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep -c error
```
Expected: 0 new errors

- [ ] **Step 4: Start all services**

```bash
# Ensure PostgreSQL + Redis are running
docker compose -f docker/docker-compose.yaml up -d

# Start server
pnpm dev:server &

# Start web
cd apps/web && npx vite --host 0.0.0.0 --port 8000 &
```

- [ ] **Step 5: Manual test — CS notification flow**

1. Login as kefu01 / 123456 (CS role)
2. Open dispatch workbench `/cs/dispatch`
3. In another browser, login as zhangsan / 123456 (companion)
4. Companion sends a chat message via ChatModal
5. **Verify CS sees:**
   - Bell badge count incremented
   - Bell glow animation active
   - Floating widget pulse animation active
   - Floating widget bounce on new message
   - Sound played (two-tone beep)
6. Click bell → MessageCenterPanel opens with unread/read grouping
7. Click companion → ChatModal opens, messages visible
8. **Verify: same messages shown as in dispatch workbench companion click**
9. ChatModal opens → badge clears, glow stops, floating widget stops pulsing

- [ ] **Step 6: Manual test — Companion notification flow**

1. Login as zhangsan / 123456 (companion)
2. Have CS send a message
3. **Verify: bell badge, floating widget, message center all work for companion too**

- [ ] **Step 7: Commit any final fixes**

```bash
git add -A
git commit -m "chore: end-to-end verification — chat notification redesign"
```
