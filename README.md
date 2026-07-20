# Chunlv Esports -- Companion Dispatch Management System

> A full-lifecycle digital operations platform for esports companion studios, covering order taking, dispatching, billing, customer management, employee management, and profit/loss statistics with multi-studio / cross-studio collaboration.

---

## Recent Updates (v3.1.0)

- **进程黑名单管理:** 陪玩终端进程采集上报, 黑/白名单 CRUD, 双模式添加(多选+手动), 推送下发, 5秒倒计时杀进程通知, REST/WS 双通道, 全链路日志
- **远程控制增强:** 陪玩姓名搜索+状态筛选, 30s自动刷新, 按钮在线判断优化

## Recent Updates (v3.0.0)

- **Unified Dashboard:** 昨日/全月总流水, 31天趋势图, 订单类型饼图, 陪玩收入排行, 点击陪玩查看明细
- **Performance Dashboard:** 每日/全月绩效排行（接单率/续单率/复购率/流水结构分析）
- **Companion Wallet:** 押金/余额/冻结/可支取 + 支取申请/审核流程
- **Monthly Settlement:** 阶梯分成自动结算（三段阶梯：50%/60%/70%）
- **Customer Profiles:** 19字段画像 + 自定义备注 + 跟进记录
- **Customer Intelligence:** 首单/复购自动检测, 活跃/待跟进/流失状态判定
- **AI Analysis:** 消费力/忠诚度/活跃度评分 + 维护建议 + 话术生成
- **Enhanced Service Settlement:** 首单+续单结算, 自动创建续单子订单
- **Dual Companion Flow:** 呼叫搭档/接受搭档 WebSocket 通知
- **Traffic Pool:** 渠道管理（小红书/抖音/快手/转介绍）+ 统计
- **Companion Resignation:** 一键离职处理（清数据/释工位/释微信）
- **Tenant Authorization:** 租客→客服权限范围管理
- **Work WeChat Management:** 工作微信绑定/解绑/自动释放
- **Unified Order Pool:** 全角色统一横向卡片 + 沟通按钮 + 抢单弹窗+复制微信
- **System Config:** 16项全局配置（流水门槛/阶梯分成/支取比例/超时/下拉选项）
- **7 new models:** StudioDailyStats, ExpenseReport, WalletTransaction, CustomerProfile, CustomerFollowUp, TenantAuthorization, WorkWechat

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [User Roles and Permissions](#user-roles-and-permissions)
- [Security](#security)
- [Environment Variables](#environment-variables)
- [Documents](#documents)

---

## Project Overview

The system serves companion studios with distinct interfaces for each role:

| Role | Interface | Primary Functions |
|------|-----------|-------------------|
| **Owner** | Web Browser | Studio management, employee management, revenue statistics, user authorization |
| **Admin** | Web Browser | Order dispatch, customer CRUD, billing review, PC remote control, revenue dashboard |
| **CS** | Web Browser | Dispatch workbench, order list, companion status monitoring |
| **Companion** | Go Desktop Agent | Accept orders, report billing, track work time, receive remote commands |

### Architecture

```
Browser (React SPA) ──HTTP──▶ Nest.js (Express) ──▶ PostgreSQL 16 + Redis 7
```

### Screenshots

> _Screenshots placeholder -- add screenshots of the dispatch workbench, revenue dashboard, billing review, and agent local UI here._

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + TypeScript | 18.3 |
| | Ant Design (UI library) | 5.18 |
| | Zustand (state management) | 5.0 |
| | React Router (routing) | 6.23 |
| | Recharts (charts) | 3.9 |
| | Vite (build tool) | 6.0 |
| | Axios (HTTP client) | 1.7 |
| **Backend** | Nest.js (Node.js framework) | 10.3 |
| | Express (HTTP platform) | 10.3 |
| | Prisma ORM | 5.14 |
| | Socket.IO (WebSocket) | 4.8 |
| | Passport + JWT (auth) | 0.7 / 10.2 |
| | bcryptjs (password hashing) | 2.4 |
| | class-validator (validation) | 0.14 |
| **Database** | PostgreSQL | 16 (Alpine) |
| **Cache** | Redis | 7 (Alpine) |
| **Infra** | Docker Compose | -- |
| | pnpm Workspaces (monorepo) | 8+ |
| **Shared** | TypeScript (types + enums) | 5.5 |

---

## Project Structure

```
chunlv-esports/
├── apps/
│   ├── web/                          # React frontend (management & CS portal)
│   │   └── src/
│   │       ├── api/                  # Axios API client
│   │       ├── layouts/             # AppLayout with role-based navigation
│   │       ├── stores/              # Zustand state stores
│   │       ├── pages/
│   │       │   ├── LoginPage.tsx
│   │       │   ├── owner/           # Owner pages (5 pages)
│   │       │   │   ├── AuthorizationsPage.tsx
│   │       │   │   ├── CustomersPage.tsx
│   │       │   │   ├── EmployeesPage.tsx
│   │       │   │   ├── RevenuePage.tsx
│   │       │   │   └── StudiosPage.tsx
│   │       │   ├── admin/           # Admin pages (6 pages)
│   │       │   │   ├── BillingPage.tsx
│   │       │   │   ├── CompanionsPage.tsx
│   │       │   │   ├── CustomersPage.tsx
│   │       │   │   ├── DispatchPage.tsx
│   │       │   │   ├── PcControlPage.tsx
│   │       │   │   └── RevenuePage.tsx
│   │       │   └── cs/              # CS pages (3 pages)
│   │       │       ├── CompanionsStatusPage.tsx
│   │       │       ├── DispatchPage.tsx
│   │       │       └── OrdersPage.tsx
│   │       └── router.tsx           # 14 frontend routes
│   │
│   ├── server/                       # Nest.js backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # 11 models (User, Studio, Companion, Order, etc.)
│   │   │   ├── seed.ts              # Test data seeding
│   │   │   └── migrations/          # Prisma migration history
│   │   └── src/
│   │       ├── app.module.ts        # Root module (imports all feature modules)
│   │       ├── main.ts              # Bootstrap: CORS, validation, static files, prefix
│   │       ├── auth/
│   │       │   ├── auth.controller.ts   # Login, refresh, verify-2nd, authorize, me
│   │       │   ├── auth.service.ts      # JWT dual-token + second password logic
│   │       │   ├── jwt.strategy.ts      # JWT passport strategy
│   │       │   ├── roles.guard.ts       # RBAC guard (OWNER/ADMIN/CS/COMPANION)
│   │       │   └── dto/login.dto.ts     # Login, Refresh, VerifySecond DTOs
│   │       ├── orders/
│   │       │   ├── orders.controller.ts # Create, pool, list, grab, assign, confirm, complete, cancel
│   │       │   ├── orders.service.ts    # Order lifecycle with data isolation
│   │       │   └── dto/
│   │       ├── companions/
│   │       │   ├── companions.controller.ts  # List, ranking, detail, status, revenue, command
│   │       │   └── companions.service.ts
│   │       ├── customers/
│   │       │   ├── customers.controller.ts   # CRUD + reassign + order history
│   │       │   └── customers.service.ts      # Data isolation by role
│   │       ├── billing/
│   │       │   ├── billing.controller.ts     # Transactions CRUD, approve, reject, batch, revenue, expenses
│   │       │   ├── billing.service.ts        # Revenue aggregation + profit/loss
│   │       │   ├── upload.controller.ts      # Screenshot upload (multer)
│   │       │   └── dto/create-transaction.dto.ts
│   │       ├── studios/
│   │       │   ├── studios.controller.ts     # Studio CRUD + employee management
│   │       │   └── studios.service.ts
│   │       ├── health/
│   │       │   ├── health.controller.ts      # /api/health -- DB connectivity check
│   │       │   └── health.module.ts
│   │       ├── ws/
│   │       │   ├── ws.gateway.ts             # Socket.IO gateway (connection lifecycle + events)
│   │       │   └── ws.module.ts
│   │       ├── prisma/
│   │       │   ├── prisma.module.ts          # Global PrismaService
│   │       │   └── prisma.service.ts
│   │       └── common/
│   │           └── http-exception.filter.ts  # Global exception filter
│   │
│   └── companion-electron/            # Electron desktop app for companions
├── packages/shared/                  # Shared TypeScript package
│   └── src/
│       ├── enums.ts                 # 7 enums (UserRole, OrderType, OrderStatus, DispatchType,
│       │                             #          CompanionStatus, PCMode, TransactionStatus)
│       ├── types.ts                 # 5 interfaces (ApiResponse, PaginatedResponse, Login*, UserInfo)
│       └── index.ts
│
├── docker/
│   ├── docker-compose.yaml          # PostgreSQL 16 + Redis 7
│   └── data/                        # Mounted data volumes
│
├── uploads/
│   └── screenshots/                 # Uploaded billing screenshots (served as static files)
│
├── docs/                            # Requirements, design docs, implementation plans
├── scripts/                         # Automation scripts (changelog update, etc.)
├── pnpm-workspace.yaml
├── package.json                     # Root workspace scripts
├── CHANGELOG.md
└── CLAUDE.md
```

---

## Quick Start

### Prerequisites

| Tool | Minimum Version | Required For |
|------|----------------|--------------|
| Node.js | >= 18 | Backend + Frontend |
| pnpm | >= 8 | Package management |
| Docker Desktop | Any recent | PostgreSQL + Redis |

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Infrastructure (PostgreSQL + Redis)

```bash
docker compose -f docker/docker-compose.yaml up -d
```

This starts:
- **PostgreSQL 16** on port `5432` (user: `postgres`, password: `postgres`, database: `chunlv`)
- **Redis 7** on port `6379`

### 3. Initialize Database

```bash
pnpm db:migrate    # Apply Prisma migrations
pnpm db:seed       # Seed test data (default accounts)
```

### 4. Start Development Servers

```bash
# Terminal 1: Backend API server (http://localhost:3001)
pnpm dev:server

# Terminal 2: Frontend dev server (http://localhost:5173)
pnpm dev:web
```

### 5. Login

Open `http://localhost:5173` in a browser.

| Username | Password | Role | Notes |
|----------|----------|------|-------|
| `hanlei` | `123456` | OWNER | Full access; second password: `888888` |
| `kefu01` | `123456` | CS | Requires owner authorization |
| `zhangsan` | `123456` | COMPANION | Requires owner authorization |
| `peiwang01` | `123456` | COMPANION | Requires owner authorization |

### 6. Build for Production

```bash
pnpm build
# Output:
#   packages/shared/dist/
#   apps/server/dist/
#   apps/web/dist/
```

---

## API Reference

All endpoints are prefixed with `/api`. The global prefix is set in `main.ts` via `app.setGlobalPrefix('api')`.

### Response Format

Every endpoint returns a standard JSON envelope:

```json
{
  "code": 200,
  "message": "ok",
  "data": { ... }
}
```

### Authentication

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/auth/login` | None | -- | Login. Body: `{ username, password }`. Returns `accessToken`, `refreshToken`, `user`. |
| `POST` | `/api/auth/refresh` | None | -- | Refresh tokens. Body: `{ refreshToken }`. Returns new token pair. |
| `POST` | `/api/auth/verify-2nd` | JWT | -- | Verify second password. Body: `{ password }`. Returns `secondToken` (5 min expiry). |
| `GET` | `/api/auth/me` | JWT | -- | Get current user info from token. |
| `PUT` | `/api/auth/users/:id/authorize` | JWT | OWNER | Authorize a user account (required for CS/COMPANION roles). |

### Orders

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/orders` | JWT | CS, ADMIN | Create a new order. Body: `CreateOrderDto`. |
| `GET` | `/api/orders/pool` | JWT | -- | Get the dispatch pool (PENDING orders). |
| `GET` | `/api/orders` | JWT | CS, ADMIN, COMPANION | List orders. Query: `?status=PENDING\|GRABBED\|CONFIRMED\|DONE\|CANCELLED`. Data isolation applied. |
| `POST` | `/api/orders/:id/grab` | JWT | COMPANION | Grab an order from the pool. |
| `POST` | `/api/orders/:id/assign` | JWT | CS, ADMIN | Directly assign order to a companion. Body: `{ companionId }`. |
| `POST` | `/api/orders/:id/confirm` | JWT | COMPANION | Confirm a grabbed order (start service). |
| `POST` | `/api/orders/:id/complete` | JWT | CS, ADMIN, COMPANION | Mark order as completed. |
| `POST` | `/api/orders/:id/cancel` | JWT | CS, ADMIN | Cancel an order. |

**Order Status Flow:** `PENDING` -> `GRABBED` -> `CONFIRMED` -> `DONE` (or `CANCELLED` at any point)

| `POST` | `/api/orders/:id/complete-billing` | JWT | COMPANION | Complete order with billing detail. |
| `POST` | `/api/orders/:id/call-partner` | JWT | COMPANION | Call partner for dual companion order. |
| `POST` | `/api/orders/:id/accept-partner` | JWT | COMPANION | Accept partner invitation. |
| `GET` | `/api/orders/pool/status` | JWT | COMPANION | Get pool unlock status (revenue threshold). |

### Dashboard

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/dashboard` | JWT | ADMIN, OWNER | Dashboard overview (today stats, ranking, alerts). |
| `GET` | `/api/dashboard/trend` | JWT | ADMIN, OWNER | N-day revenue trend. Query: `?days=7`. |
| `GET` | `/api/dashboard/companions` | JWT | ADMIN, OWNER | Companion status list. |
| `GET` | `/api/dashboard/revenue-overview` | JWT | ADMIN, OWNER | Yesterday/monthly revenue + type breakdown + companion ranking. |
| `GET` | `/api/dashboard/companion-revenue/:id` | JWT | ADMIN, OWNER | Single companion revenue detail. |
| `GET` | `/api/dashboard/performance/daily` | JWT | ADMIN, OWNER | Daily KPI rankings. |
| `GET` | `/api/dashboard/performance/monthly` | JWT | ADMIN, OWNER | Monthly KPI rankings. |

### Config

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/config` | JWT | -- | Get config values. Query: `?keys=a,b`. |
| `PUT` | `/api/config` | JWT | ADMIN, OWNER | Batch update config. |

### Expense Reports

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/expense-reports` | JWT | COMPANION | Submit expense/withdraw report. |
| `GET` | `/api/expense-reports` | JWT | -- | List reports (role-filtered). |
| `PUT` | `/api/expense-reports/:id/review` | JWT | ADMIN, OWNER | Review (approve/reject). |
| `GET` | `/api/expense-reports/monthly-summary` | JWT | ADMIN, OWNER | Monthly summary stats. |

### Wallet & Settlement

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions/me/wallet` | JWT | COMPANION | Get wallet balance. |
| `POST` | `/api/companions/me/withdraw` | JWT | COMPANION | Request withdrawal. |
| `GET` | `/api/wallet-transactions` | JWT | ADMIN, OWNER | List wallet transactions. |
| `PUT` | `/api/wallet-transactions/:id/review` | JWT | ADMIN, OWNER | Review wallet transaction. |
| `POST` | `/api/monthly-settlement` | JWT | ADMIN, OWNER | Run monthly settlement. |
| `GET` | `/api/monthly-settlement` | JWT | ADMIN, OWNER | Get settlement history. |

### Customer Profiles & AI

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/customers/:id/profile` | JWT | -- | Get/auto-create customer profile. |
| `PUT` | `/api/customers/:id/profile` | JWT | ADMIN, OWNER, COMPANION | Update profile. |
| `GET` | `/api/customers/:id/type` | JWT | -- | Detect customer type (first/repeat). |
| `GET` | `/api/customers/:id/follow-ups` | JWT | -- | List follow-up records. |
| `POST` | `/api/customers/:id/follow-ups` | JWT | ADMIN, OWNER, COMPANION | Add follow-up. |
| `GET` | `/api/customers/traffic/pool` | JWT | ADMIN, OWNER | Traffic pool (channel data). |
| `GET` | `/api/customers/traffic/stats` | JWT | ADMIN, OWNER | Channel statistics. |
| `POST` | `/api/ai/analyze/:customerId` | JWT | ADMIN, OWNER, COMPANION | AI customer analysis. |

### Work Wechat

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions/work-wechats` | JWT | ADMIN, OWNER | List work wechats. |
| `POST` | `/api/companions/work-wechats` | JWT | ADMIN, OWNER | Add work wechat. |
| `PUT` | `/api/companions/work-wechats/:id/bind` | JWT | ADMIN, OWNER | Bind to companion. |
| `PUT` | `/api/companions/work-wechats/:id/unbind` | JWT | ADMIN, OWNER | Unbind wechat. |
| `GET` | `/api/companions/chat-history/:companionId` | JWT | -- | Get full chat history with a companion. |
| `GET` | `/api/companions/chat-pending` | JWT | -- | Get pending chat messages for current studio. |
| `POST` | `/api/companions/chat-notify` | JWT | COMPANION, CS, ADMIN, OWNER | Send chat notification from companion. |

### Customers

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/customers` | JWT | -- | List customers (data isolation by role). |
| `GET` | `/api/customers/:id` | JWT | -- | Get customer detail. |
| `POST` | `/api/customers` | JWT | ADMIN, OWNER, CS | Create a new customer. |
| `PUT` | `/api/customers/:id` | JWT | ADMIN, OWNER | Update customer fields. |
| `DELETE` | `/api/customers/:id` | JWT | ADMIN, OWNER | Delete a customer. |
| `GET` | `/api/customers/:id/orders` | JWT | -- | Get order history for a customer. |
| `PUT` | `/api/customers/:id/reassign` | JWT | ADMIN, OWNER | Reassign customer to a different companion (or unassign). Body: `{ companionId }`. |

### Companions

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/companions` | JWT | -- | List companions with online status (data isolation). |
| `GET` | `/api/companions/ranking` | JWT | -- | Get revenue ranking of companions. |
| `GET` | `/api/companions/:id` | JWT | -- | Get companion detail. |
| `PUT` | `/api/companions/:id/status` | JWT | COMPANION | Update companion online status (`ONLINE`, `BUSY`, `IDLE`, `OFFLINE`). |
| `GET` | `/api/companions/:id/revenue` | JWT | -- | Get revenue breakdown for a specific companion. |
| `POST` | `/api/companions/:id/command` | JWT | ADMIN, OWNER | Send a remote command to companion's PC via WebSocket. Body: `{ command, params? }`. |
| `POST` | `/api/companions/:id/kick` | JWT | ADMIN, OWNER | Kick a companion offline (disconnect WebSocket + mark OFFLINE). |
| `POST` | `/api/companions/agent-heartbeat` | JWT | COMPANION | Agent REST heartbeat. Body: `{ mode, workSec, entertainSec, totalSec }`. |

### Billing -- Transactions

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/transactions` | JWT | COMPANION | Submit a billing transaction (expense report). |
| `GET` | `/api/transactions` | JWT | ADMIN, OWNER, COMPANION | List transactions. Query: `?status=PENDING\|APPROVED\|REJECTED`. |
| `PUT` | `/api/transactions/:id/approve` | JWT | ADMIN, OWNER | Approve a transaction. |
| `PUT` | `/api/transactions/:id/reject` | JWT | ADMIN, OWNER | Reject a transaction. |
| `PUT` | `/api/transactions/batch` | JWT | ADMIN, OWNER | Batch approve or reject. Body: `{ ids: string[], action: "approve" \| "reject" }`. |

### Billing -- Revenue

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/revenue/daily` | JWT | -- | Get daily revenue breakdown by order type. Query: `?date=YYYY-MM-DD`. |
| `GET` | `/api/revenue/monthly` | JWT | -- | Get monthly revenue with per-companion ranking. Query: `?month=YYYY-MM`. |
| `GET` | `/api/revenue/stats` | JWT | OWNER | Get profit/loss statistics. **Requires header:** `X-Second-Token: <secondToken>`. |
| `GET` | `/api/revenue/daily/csv` | JWT | -- | Download daily revenue as CSV. Query: `?date=YYYY-MM-DD`. |
| `GET` | `/api/revenue/monthly/csv` | JWT | -- | Download monthly revenue as CSV. Query: `?month=YYYY-MM`. |

### Billing -- Expenses

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/expenses` | JWT | -- | List expenses for the studio. |
| `POST` | `/api/expenses` | JWT | ADMIN, OWNER | Create an expense record. |

### Studios

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/studios` | JWT | OWNER | List all studios. |
| `POST` | `/api/studios` | JWT | OWNER | Create a new studio. Body: `{ name }`. |
| `PUT` | `/api/studios/:id` | JWT | OWNER | Update studio name. Body: `{ name }`. |

### Employees

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/employees` | JWT | OWNER, ADMIN | List employees. Query: `?studioId=...`. |
| `POST` | `/api/employees` | JWT | OWNER, ADMIN | Create a new employee. Body: `{ username, password, role, studioId }`. |
| `PUT` | `/api/employees/:id/password` | JWT | OWNER, ADMIN | Reset employee password. Body: `{ password }`. |
| `DELETE` | `/api/employees/:id` | JWT | OWNER, ADMIN | Delete an employee (soft-delete: sets deletedAt). |

### Upload

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/api/upload/screenshot` | JWT | COMPANION | Upload a billing screenshot. Multipart form: `file` (JPG/PNG/WebP, max 5 MB). |

### Health

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/health` | None | -- | Health check. Returns `{ status, db, timestamp }`. |

---

## WebSocket Events

### Connection

- **URL:** `http://localhost:3001/socket.io/?EIO=4&transport=websocket&token=<JWT>`
- **Auth:** JWT token passed as query parameter `token`
- **Rooms (auto-join):** `studio:<studioId>`, `companion:<companionId>`, `pc:<companionId>`
- **On connect:** Companion marked `ONLINE` in DB, `status:broadcast` emitted to studio
- **On disconnect:** Companion marked `OFFLINE`, `status:broadcast` emitted

### Inbound Events (Agent/Client -> Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `companion:status` | `{ status: string, mode?: string }` | Companion changes their status. Broadcasts to studio room. |
| `companion:heartbeat` | `{ mode, workSec, entertainSec, totalSec, timestamp }` | Periodic heartbeat (every 30 s). Updates `CompanionPC` record, creates `CompanionTimeLog` entries. |
| `pc:command_ack` | `{ command: string, success: boolean }` | Acknowledge execution of a remote command. Logged to `PCOperationLog`. |

### Outbound Events (Server -> Agent/Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `pc:command` | `{ command: string, params?: object }` | Remote command sent to companion PC (`shutdown`, `restart`, `throttle`, `unthrottle`). |
| `order:new` | `{ id, type, amount, gameName, ... }` | New order pushed to a specific companion. |
| `status:broadcast` | `{ companionId, status, mode? }` | Broadcast companion status change to all users in the studio room. |

### Command Types

| Command | Parameter | Description |
|---------|-----------|-------------|
| `shutdown` | -- | Shut down the companion PC. |
| `restart` | -- | Restart the companion PC. |
| `throttle` | `{ limitKB: number }` | Apply network bandwidth limit (KB/s). |
| `unthrottle` | -- | Remove network bandwidth limit. |
| `kick` | -- | Force disconnect companion from WebSocket and mark offline. |

---

## User Roles and Permissions

### Role Definitions

| Role | DB Value | Interface | Default Authorization |
|------|----------|-----------|----------------------|
| **Owner** | `OWNER` | Web Browser | Auto-authorized |
| **Admin** | `ADMIN` | Web Browser | Auto-authorized |
| **CS** | `CS` | Web Browser | Requires owner approval |
| **Companion** | `COMPANION` | Electron Desktop App | Requires owner approval |

### Permission Matrix

| Feature | OWNER | ADMIN | CS | COMPANION |
|---------|-------|-------|----|-----------|
| **Auth** | | | | |
| Login / Refresh / Me | Yes | Yes | Yes | Yes |
| Verify second password | Yes | -- | -- | -- |
| Authorize users | Yes | -- | -- | -- |
| **Orders** | | | | |
| Create order | -- | Yes | Yes | -- |
| View order pool | Yes | Yes | Yes | Yes |
| Grab order | -- | -- | -- | Yes |
| Assign order | -- | Yes | Yes | -- |
| Confirm order | -- | -- | -- | Yes |
| Complete order | -- | Yes | Yes | Yes |
| Cancel order | -- | Yes | Yes | -- |
| **Customers** | | | | |
| View customers | Own studio | Own studio | Own studio | Assigned only |
| Create customer | Yes | Yes | Yes | -- |
| Update customer | Yes | Yes | -- | -- |
| Delete customer | Yes | Yes | -- | -- |
| View customer orders | Yes | Yes | Yes | Assigned only |
| Reassign customer | Yes | Yes | -- | -- |
| **Companions** | | | | |
| View companions | All | Own studio | Own studio | Self only |
| View ranking | Yes | Yes | Yes | -- |
| Update own status | -- | -- | -- | Yes |
| View companion revenue | Yes | Yes | -- | Self only |
| Send PC command | Yes | Yes | -- | -- |
| **Billing** | | | | |
| Submit transaction | -- | -- | -- | Yes |
| View transactions | Yes | Yes | -- | Own only |
| Approve / Reject | Yes | Yes | -- | -- |
| Batch approve / reject | Yes | Yes | -- | -- |
| View daily/monthly revenue | Yes | Yes | Yes | -- |
| Download revenue CSV | Yes | Yes | Yes | -- |
| View profit/loss stats | Yes (2nd pwd) | -- | -- | -- |
| Manage expenses | Yes | Yes | -- | -- |
| **Studios** | | | | |
| CRUD studios | Yes | -- | -- | -- |
| **Employees** | | | | |
| List / Create employees | Yes | Yes (own) | -- | -- |
| Reset employee password | Yes | Yes (own) | -- | -- |
| **Upload** | | | | |
| Upload screenshot | -- | -- | -- | Yes |

### Data Isolation

- **OWNER:** Sees all data across all studios.
- **ADMIN:** Data scoped to their own studio.
- **CS:** Data scoped to their own studio.
- **COMPANION:** Sees only their own assigned customers, their own orders, and their own transactions.

---

## Security

### Authentication

| Feature | Implementation |
|---------|---------------|
| **Primary auth** | JWT dual-token: access token (15 min) + refresh token (7 days) |
| **Second password** | Separate bcrypt-hashed password required for profit/loss stats. Returns a short-lived `secondToken` (5 min). |
| **Password storage** | bcrypt with salt rounds |
| **User authorization** | CS and COMPANION accounts require owner approval before they can log in |

### Authorization

| Feature | Implementation |
|---------|---------------|
| **RBAC** | Four roles: OWNER, ADMIN, CS, COMPANION |
| **Guard** | `RolesGuard` + `@Roles()` decorator on every protected endpoint |
| **Data isolation** | Every service method receives `req.user` and applies studio/companion scoping |

### API Protection

| Feature | Implementation |
|---------|---------------|
| **Global prefix** | `/api` |
| **CORS** | Origin restricted to `http://localhost:5173` |
| **Input validation** | `class-validator` with `whitelist: true` and `transform: true` |
| **Exception filter** | Global `HttpExceptionFilter` for consistent error responses |
| **File upload** | MIME type whitelist (JPG/PNG/WebP), 5 MB limit, unique filenames |

### WebSocket Security

| Feature | Implementation |
|---------|---------------|
| **Auth on connect** | JWT token verified in `handleConnection`. Invalid tokens are disconnected immediately. |
| **Room isolation** | Clients auto-join studio-scoped and companion-scoped rooms. |

### Audit Trail

| Feature | Implementation |
|---------|---------------|
| **Transaction review** | Every approved/rejected transaction records `reviewedById` |
| **PC operations** | Every remote command acknowledgment is logged to `PCOperationLog` with operator ID and success status |
| **Time logs** | Heartbeat work seconds are recorded to `CompanionTimeLog` with start/end timestamps |

---

## Environment Variables

### Backend (`apps/server/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/chunlv` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret for signing access tokens | _Required_ |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | _Required_ |
| `PORT` | HTTP server port | `3001` |

### Docker Compose (`docker/docker-compose.yaml`)

| Service | Variable | Default |
|---------|----------|---------|
| PostgreSQL | `POSTGRES_USER` | `postgres` |
| | `POSTGRES_PASSWORD` | `postgres` |
| | `POSTGRES_DB` | `chunlv` |
| Redis | _(none)_ | Default config |

---

## Database Schema

11 Prisma models:

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `User` | User accounts with role, studio assignment, authorization status, second password |
| `Studio` | `Studio` | Multi-tenant studios |
| `Companion` | `Companion` | Companion profiles: games, status, billing code, revenue share |
| `CompanionPC` | `CompanionPC` | Agent heartbeat state: version, current mode, throttle status |
| `CompanionTimeLog` | `CompanionTimeLog` | Work/entertainment time tracking entries |
| `Order` | `Order` | Orders: type, dispatch method, status, amount, game, duration |
| `Customer` | `Customer` | Customer profiles with platform info, total spent, assignment |
| `Transaction` | `Transaction` | Billing transactions with payment method, screenshot, review status |
| `RevenueDaily` | `RevenueDaily` | Aggregated daily revenue by order type and companion |
| `Expense` | `Expense` | Studio expenses by category |
| `PCOperationLog` | `PCOperationLog` | Audit log of all remote PC operations |

---

## Documents

- [架构说明 (Mermaid 图表)](docs/ARCHITECTURE.md)
- [部署手册](docs/DEPLOYMENT.md)
- [使用手册](docs/USER_MANUAL.md)
- [需求文档](docs/蠢驴电竞陪玩派单管理系统-需求文档.md)
- [系统功能设计](docs/superpowers/specs/2026-06-21-系统功能设计.md)
- [实施计划](docs/superpowers/plans/2026-06-21-系统实施计划.md)
- [变更日志](CHANGELOG.md)

---

> v2.1.0 -- Simplified auth, kick companion, Apple-inspired UI, REST heartbeat, 54 unit tests, Recharts, CSV export, batch billing, screenshot upload, dual-platform Go Agent
