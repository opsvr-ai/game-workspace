```
game-workspace/
├── apps/
│   ├── server/                    # Nest.js API (port 3001)
│   │   ├── src/
│   │   │   ├── agent/             # Electron agent management + remote deploy
│   │   │   ├── auth/              # JWT auth (login, refresh, RolesGuard)
│   │   │   ├── chat/              # Chat 3.0 (ChatRoom, ChatMessageV3, reactions)
│   │   │   ├── companions/        # Companion CRUD + status + wallet
│   │   │   ├── customers/         # Customer CRUD + profile + follow-ups
│   │   │   ├── orders/            # Order lifecycle (create→grab→confirm→complete)
│   │   │   ├── revenue/           # Revenue stats + daily aggregation
│   │   │   ├── studios/           # Studio CRUD + bridge + payment accounts
│   │   │   ├── transactions/      # Billing review (approve/reject)
│   │   │   ├── blacklist/         # Process blacklist/whitelist management
│   │   │   ├── websocket/         # Socket.IO gateway (JWT auth, studio rooms)
│   │   │   └── app.module.ts      # Root module (imports all feature modules)
│   │   └── prisma/
│   │       └── schema.prisma      # 30+ models, PostgreSQL provider
│   ├── web/                       # React SPA (port 5173 dev / 8000 prod)
│   │   └── src/
│   │       ├── api/               # Axios API clients (agent, orders, studios, chat)
│   │       ├── pages/             # Route pages (admin/, cs/, owner/, login)
│   │       ├── layouts/           # AppLayout (sider + header + content)
│   │       ├── stores/            # Zustand stores (chat, auth)
│   │       └── router.tsx         # 14 routes with role-based access
│   └── companion-electron/        # Electron desktop agent
│       └── electron/
│           └── main.ts            # WebSocket client, process monitor, local WebUI
├── packages/
│   └── shared/                    # Shared TypeScript types + enums
│       └── src/enums.ts           # UserRole, OrderStatus, DispatchType, etc.
├── docker/
│   └── docker-compose.yaml        # PostgreSQL 16 + Redis 7
└── docs/
    ├── ARCHITECTURE.md            # Mermaid diagrams (system, ER, workflows, deploy)
    ├── DEPLOYMENT.md              # Deployment guide
    └── USER_MANUAL.md             # User manual
```