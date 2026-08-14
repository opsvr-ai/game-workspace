# Tasks: WeChat-Style Chat Redesign

## 1. Database & Shared Types

- [x] 1.1 Add Conversation + ChatMessage models to Prisma schema, rename old ChatMessage to ChatMessageLegacy
- [x] 1.2 Run `pnpm db:migrate` to create migration
- [x] 1.3 Add shared TypeScript types to `packages/shared/src/chat.ts`

## 2. Backend — Chat Module

- [x] 2.1 Create `apps/server/src/chat/chat.module.ts` (NestJS module)
- [x] 2.2 Create `apps/server/src/chat/chat.service.ts` with conversation CRUD + message send/history
- [x] 2.3 Create `apps/server/src/chat/chat.controller.ts` with all 7 REST endpoints
- [x] 2.4 Add `notifyNewMessage(recipientUserId, payload)` to WsGateway
- [x] 2.5 Register ChatModule in AppModule
- [x] 2.6 Verify: run server, test all 7 endpoints with curl

## 3. Frontend — API & Store

- [x] 3.1 Create `apps/web/src/api/chat.ts` with all chat API calls
- [x] 3.2 Rewrite `apps/web/src/stores/chatStore.ts` with new data model + receiveMessage as single write path
- [x] 3.3 Update `apps/web/src/hooks/useSocket.ts` — single `chat:message` handler

## 4. Frontend — UI Components

- [x] 4.1 Create `apps/web/src/components/ConversationList.tsx` (WeChat-style conversation list)
- [x] 4.2 Create `apps/web/src/components/MessageBubble.tsx` (left/right bubbles with time)
- [x] 4.3 Create `apps/web/src/components/ChatInput.tsx` (textarea + send + emoji + upload)
- [x] 4.4 Rewrite `apps/web/src/components/ChatModal.tsx` (store-driven, WeChat-style)
- [x] 4.5 Update `apps/web/src/layouts/AppLayout.tsx` (remove poll, simplify WS, load conversations on mount)
- [x] 4.6 Update `apps/web/src/components/FloatingChatWidget.tsx` (use ConversationList + conversationId)
- [x] 4.7 Update `apps/web/src/components/MessageCenterPanel.tsx` (use ConversationList + conversationId)

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` both projects — zero errors
- [x] 5.2 CS sends to companion → real-time delivery, WeChat bubbles
- [x] 5.3 Companion sends to CS → same
- [x] 5.4 Logout/login → all history preserved
- [x] 5.5 Bell badge clears on open chat
- [x] 5.6 Sound only when chat not focused
- [x] 5.7 No duplicate messages on any path

## 6. Cleanup

- [ ] 6.1 Remove old chat endpoints from CompanionsController (chat-notify, chat-pending, chat-history)
- [ ] 6.2 Remove ChatMessageLegacy table + old ChatService methods
- [x] 6.3 Update documentation (CHANGELOG, README, ARCHITECTURE)
