# Plan: Fix Chat Message Delivery — companionId Mismatch

## Context

After the companionId-centric chatStore redesign, 3 critical bugs remain:

1. **CS→Companion messages not received** — Server drops client-sent `companionId`, hardcodes `req.user.companionId` (= `undefined` for CS). Poll fallback also fails because messages have `orderId: null`.

2. **Bell notification shows messages but clicking opens empty chat** — `onChatNotify` handler processes `chat:new` events with wrong field names (`data.message` vs `data.text`), creating ghost empty-text messages. History API uses Companion table ID to query `senderId` (which stores User primary key) — always returns nothing.

3. **No visual notification effects** — `onChatNotify`'s `notify()` call checks `data.companionName` which `chat:new` payloads never contain.

## Root Causes (3 files, 4 fixes)

### Fix 1: Server DTO — Accept `companionId` from client

**File:** `apps/server/src/companions/companions.controller.ts` (line 438)

The DTO `{ orderId?, message?, time? }` drops `companionId`. Change to accept it and use client value over `req.user.companionId`.

### Fix 2: Server — Fix `getMessagesByCompanion` to use User IDs

**File:** `apps/server/src/chat/chat.service.ts` (lines 73-98)

The `companionId` parameter receives a **Companion table ID** but `chatMessage.senderId` stores **User primary key**. Fix by loading the companion's userId first and using that for the `senderId` query.

### Fix 3: Frontend — Remove dual `chat:new` handler

**File:** `apps/web/src/hooks/useSocket.ts` (lines 50-53)

`chat:new` currently fires BOTH `onChatNotify` (with wrong field names) AND `onChatNew`. Remove the `onChatNotify` call — let only `onChatNew` handle `chat:new` events.

### Fix 4: Frontend — Use `data.senderId` as companionId key in `onChatNew`

**File:** `apps/web/src/layouts/AppLayout.tsx` (lines 289-311)

Replace `data.companionId || data.senderId` with just `data.senderId` — `senderId` is always a User primary key, while `companionId` can be the Companion table ID (different value).

## Files Changed

| File | Change |
|------|--------|
| `apps/server/src/companions/companions.controller.ts` | DTO adds `companionId`, use client value |
| `apps/server/src/chat/chat.service.ts` | Resolve Companion ID → User ID for senderId query |
| `apps/web/src/hooks/useSocket.ts` | Remove `onChatNotify` call from `chat:new` listener |
| `apps/web/src/layouts/AppLayout.tsx` | Use `data.senderId` as companionId key |

## Verification

1. `npx tsc --noEmit` — zero errors in both apps
2. CS (kefu01) sends to companion (zhangsan) → companion receives in bell + floating widget
3. Companion sends to CS → CS sees in bell, clicks → ChatModal shows correct message
4. `GET /companions/chat-history/:companionId` returns messages for both directions
5. Bell glow + floating widget pulse activate when unread > 0
6. Companion-side pages (PoolPage, OrderPoolPage) chat works correctly
