---
type: root
status: tentative
last-updated: 2026-07-27
---

## Active Context (recent ~7 days)
- feature/chat-3.0: realtime sync + permission boundary fixes for order management (Jul 22)
- 9 patches applied: broadcastToStudio across republish/renew/updateAmount/updateContact/cancel/assign/complete, plus callPartner/acceptPartner ownership guards
- OrdersPage "沟通" button fix: ChatModal integration, csUser relation added to findAll query (Jul 24)
- Files: orders.controller.ts, orders.service.ts, order-workflow.service.ts, order-dispatch.service.ts, OrdersPage.tsx

## Recent Patterns
- Cross-studio permission validation pattern: propagate studioId through controller(@Req) → service → workflow layers, add `if (userStudioId && order.studioId !== userStudioId)` guard at workflow entry
- WebSocket realtime sync pattern: `broadcastToStudio(studioId, 'order:pool_updated', order)` after every state-changing order operation
- ChatModal integration pattern: import useChatStore + ChatModal, add chatPartner state, call openConversation() with target user

## Historical Summary
- 2026-07: feature/chat-3.0 -- order system realtime sync (WebSocket broadcastToStudio) and permission boundary (cross-studio validation) fixes. OrdersPage "沟通" button ChatModal integration. Service compiles clean, /api/health verified.

## Topics Index
- orders [project, 3d]: order pool, order workflow, order dispatch, broadcastToStudio
- realtime-sync [project, 3d]: WebSocket, Socket.IO, broadcastToStudio, order:pool_updated
- permission-boundary [project, 3d]: cross-studio validation, studioId propagation, ownership guards
- websocket [project, 3d]: Socket.IO gateway, JWT auth, studio-based room grouping
- chat-3.0 [project, 3d]: feature branch, order system enhancements
- state-machine [project, 3d]: order status guards (GRABBED/CONFIRMED), workflow state transitions
- chat [project, 3d]: ChatModal, useChatStore, openConversation, csUser relation
- frontend [project, 3d]: OrdersPage, ChatModal integration, Ant Design, React
- ChatModal [project, 3d]: chat modal component, useChatStore integration
- OrdersPage [project, 3d]: order management page, "沟通" button, unread badge
- useChatStore [project, 3d]: Zustand chat store, openConversation
