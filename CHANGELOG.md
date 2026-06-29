# Changelog

All notable changes to 蠢驴电竞陪玩派单管理系统 are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — 2026-06-29

### Added

- **增强服务结算：** 首单/续单/复购检测，陪玩端结束服务弹出结算表单（客户编号自动检测类型、首单必填、续单可选、总时长总金额汇总、截图上传），后端 `completeWithBilling` 自动创建 RENEW 子订单、更新客户累计消费和陪玩月度流水

- **Phase 1 MVP:** Core business loop complete
- 数据看板：今日流水/订单/在线陪玩/接单率 + 7日趋势图 + 业绩排行 + 异常预警
- 陪玩工作台：今日统计、流水解锁进度、状态时长、状态切换、在线陪玩列表
- 抢单池流水门槛：当日流水≥100元解锁抢单功能
- 报账财务：陪玩端提交报账/支取申请，管理端审核通过/驳回，月度汇总
- 系统配置：流水门槛、阶梯分成、支取比例、下拉选项、超时设置等全局配置
- `Studio.type` 字段区分直营店/租赁店
- `StudioDailyStats` 和 `ExpenseReport` 数据模型
- Dashboard API: GET /dashboard, /dashboard/trend, /dashboard/companions
- Companion workbench API: GET /companions/me/workbench
- Order pool status API: GET /orders/pool/status (with revenue threshold)
- Expense report endpoints: CRUD + review + monthly summary
- Config API: GET/PUT /config with 16 multi-key defaults

### Changed

- Enhanced settings page from 2-card to 6-tab config management
- **月底结算模块：** 阶梯分成自动结算，根据陪玩当月业绩匹配分成阶梯，结算后业绩清零计入可支取余额
- 结算页面：月份选择器 + 执行结算按钮 + 结算结果汇总表 + 历史结算记录查询
- 结算 API: POST /monthly-settlement, GET /monthly-settlement
- 阶梯分成配置通过 SystemConfig (`revenue.share_tiers`) 动态读取，支持自定义阶梯
- Enhanced companion pool page with revenue threshold lock/progress
- Enhanced companion home page with full workbench dashboard
- Added Dashboard admin route as default page
- Enhanced billing pages with expense report submission and review
- feat: companion billing page now includes expense report submission modal
- feat: admin billing page now includes expense report review section with filter tabs
- feat: companion workbench API with today revenue, unlock/free thresholds, and status time tracking
- feat: companion workbench page with stat blocks, progress bars, status durations, and quick status switching
- feat: online companions list with real-time status tags on workbench
- feat: per-game rank and account profiles with visual display
- feat: WeChat-style chat dialog between companion and CS with real-time notifications
- feat: pulsing sidebar avatar indicator for incoming chat messages
- feat: cross-client chat notification via WebSocket broadcast + REST polling
- feat: companion sidebar menu — 首页/抢单中心/报账/客户管理/接单记录/派单记录
- feat: companion dashboard with 4-tab ranking leaderboard (续单率/复购率/昨日业绩/本月业绩)
- feat: Delta Force sub-fields on order creation (护航/陪玩, 机密/绝密/陪做任务, 单陪/双陪, 备注)
- feat: billing mode selector (hour/round) on create order form
- feat: game dropdown selector with dynamic options from system settings
- feat: customer info as 微信+房间码 text inputs on order form
- feat: today new/grabbed/remaining stats in order pool header
- feat: dispatcher name on each order card with clickable chat
- feat: companion details modal with pulsing status dot
- feat: order pool water wave animation header
- feat: companion list page with full info table (CS + companion)
- feat: comprehensive 54 unit tests for all 7 backend services
- feat: Windows client download entry on login page
- feat: add kick companion feature — admin/owner can force companion offline via POST /api/companions/:id/kick
- feat: simplify auth flow — Agent uses username/password login instead of manual JWT token
- feat: companions created by OWNER are auto-authorized (isAuthorized=true)
- feat(agent): add REST heartbeat endpoint for reliable agent registration
- feat(agent): add visual server configuration in WebUI with auto-reconnect
- feat(agent): add Linux support for netctrl and sysctrl (tc, systemctl)
- feat(web): add Apple-inspired light theme with glass-morphism header
- feat(web): add revenue charts with Recharts (bar, line, pie)
- feat(billing): add CSV export for daily and monthly revenue
- feat(billing): add batch approve/reject operations
- feat(billing): add screenshot upload endpoint (Multer, 5MB limit)
- test(server): add unit tests for all 7 backend service modules (54 tests)
- docs: add architecture document with 8 Mermaid diagrams
- docs: add deployment guide (1006 lines) and user manual (713 lines)

#### Core Business
- feat(orders): add DTO validation and state machine (CreateOrderDto, VALID_TRANSITIONS)
- feat(server): add global validation pipe and exception filter
- feat(orders): integrate WebSocket push for real-time order updates
- feat: add owner authorization management with backend + frontend

#### Frontend Pages
- feat(web): add CS orders history page with status filter and read-only table
- feat(web): add admin dispatch management page
- feat(web): add admin customer management page
- feat(web): add admin companions management page with time log expansion
- feat(web): add admin billing review page
- feat(web): add admin revenue flow page with daily/monthly views
- feat(web): add admin PC remote control page
- feat(web): add owner employee management page
- feat(web): add owner studio management page
- feat(web): add owner profit/loss revenue page with second-password gate

#### Agent
- feat(agent): add order notification to WebUI with slide-in animation and 3s polling
- feat(agent): add order confirm/complete actions to WebUI
- feat(agent): add Linux support for netctrl and sysctrl

#### Billing & Revenue
- feat(billing): add batch approve/reject operations
- feat(billing): add CSV export for daily and monthly revenue

### Fixed
- fix: OWNER employees page — remove disabled state on add button, fetch all employees
- fix(agent): improve WebSocket auth with query param fallback
- fix(server): add billing DTO, fix assign validation, add health endpoint
- fix(web): fix render side-effect in admin companions page
- fix(web): map companion API response for reassign Select
- fix(agent): fix system tray icon not showing on Windows
- fix(server): log unexpected exceptions in error filter
- fix(orders): support status query filter in order list endpoint
- fix(web): map companion API response for reassign Select
- fix(web): add recharts imports for owner RevenuePage charts
- fix: improve WebSocket auth with query param fallback

### Changed
- chore: switch frontend port to 8000
- chore: resolve merge conflict in main.ts CORS config
- chore: add .env.example and verify infrastructure
- chore: gitignore Go agent binary, update changelog


## [0.1.0] — 2026-06-21

### Added

#### Infrastructure
- feat: init monorepo with pnpm workspaces (React + Nest.js + shared types)
- feat: add docker-compose for PostgreSQL 16 + Redis 7
- feat: add Prisma schema with 11 models and seed data

#### Authentication & Authorization
- feat: add JWT dual-token authentication (access 15min + refresh 7d)
- feat: add four-role RBAC guard (OWNER/ADMIN/CS/COMPANION) with @Roles decorator
- feat: add second-password verification for profit/loss dashboard (5min secondToken)

#### Core Business — Order Dispatch
- feat: add order dispatch API with create/pool/grab/assign/confirm/complete
- feat: add order status state machine (PENDING, GRABBED, CONFIRMED, DONE)
- feat: add role-filtered order listing and pool endpoint for unassigned orders
- feat: add concurrent-safe grab with atomic status check

#### Core Business — Customer Management
- feat: add customer CRUD API with role-based data isolation
- feat: add customer reassignment and order history per customer
- feat: add auto-generated customer codes and platform tracking

#### Core Business — Companion Management
- feat: add companions API with live status tracking (ONLINE/BUSY/IDLE/OFFLINE)
- feat: add revenue ranking (top 20) and personal revenue with transaction history
- feat: add billing code generation and time log tracking (work vs entertainment)

#### Core Business — Billing & Revenue
- feat: add billing API with transactions, daily/monthly revenue, and profit/loss
- feat: add screenshot upload endpoint (JWT, COMPANION only, 5MB limit)
- feat: add admin approval/rejection workflow and customer totalSpent auto-increment

#### Core Business — Studio & Employee Management
- feat: add studio & employee management API with multi-studio support
- feat: add employee CRUD with auto companion creation and admin password reset

#### Real-time (WebSocket)
- feat: add Socket.IO gateway with JWT authentication on connect
- feat: add companion heartbeat tracking (30s interval) and real-time status broadcast
- feat: add order push to specific companions (order:new) and remote command dispatch

#### Frontend (React)
- feat: add login page with role-based redirect
- feat: add AppLayout with collapsible sidebar and 16 role-based menu items
- feat: add customer management page and dispatch workbench (three-column layout)
- feat: add companion status page with colored badges
- feat: add axios client with automatic token refresh interceptor and zustand auth store

#### Go Agent (Desktop Client)
- feat: add Go Agent with time tracker engine (WORK/ENTERTAINMENT mode switching)
- feat: add WebSocket client with auto-reconnect and 30s heartbeat with timing data
- feat: add Windows network throttling via QoS Policy and remote shutdown/restart
- feat: add local HTTP server on :9876 with REST API and WebView-ready UI

### Fixed
- fix: add .js extensions to shared package imports for CJS resolution
- fix: build shared package to dist/ and point main to compiled output
- fix: go mod tidy, add go.sum, ignore .exe binaries
- fix: add tool dirs to gitignore, fix shared types and composite, move docs

### Changed
- docs: add README, CHANGELOG, CLAUDE.md with auto-update scripts

---

[Unreleased]: https://github.com/opsvr-ai/game-workspace/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/opsvr-ai/game-workspace/tree/v0.1.0
