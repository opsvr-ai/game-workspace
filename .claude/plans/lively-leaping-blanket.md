# Chat 3.0 — 专业IM全面升级计划

## Context

当前聊天系统存在 **CS端无提醒、消息不同步** 两大核心问题。经深度代码分析确认根因：
- CSDispatchView 使用 localStorage 轮询未读，未接入 Zustand chatStore
- WebSocket 通知静默失败，无离线队列/HTTP fallback
- 新旧两套聊天数据表并存( ChatMessageV2 vs ChatMessageLegacy)，架构混乱

用户决策：**全面升级为专业内部IM → Chat 3.0 全新设计**
- 架构：重新设计，逐步废弃 Legacy 系统
- CS集成：嵌入式侧边聊天面板
- 视觉：Discord/飞书风格（深色侧边栏 + 浅色内容区）
- 通知：全量通知策略
- 范围：8大类 46 项增强

---

## Phase 0: 基础设施准备 (2天)

### 0.1 Prisma Schema 更新
- **文件**: `apps/server/prisma/schema.prisma`
- 新增模型: `ChatRoom`, `ChatMessage`, `MessageAttachment`, `MessageReaction`, `ChatAuditLog`
- 保留旧模型 `Conversation`, `ChatMessageV2`, `ChatMessageLegacy` 标记 `@deprecated`
- 生成迁移: `pnpm db:migrate`

### 0.2 数据迁移脚本
- **新文件**: `apps/server/src/chat/migrate-legacy.ts`
- Conversation → ChatRoom（含 seq 计算）
- ChatMessageV2 → ChatMessage（分配 seq）
- ChatMessageLegacy → ChatMessage（按 studioId 查找对应 ChatRoom）
- 迁移后校验：消息数量一致性

### 0.3 Redis 集成
- **文件**: `apps/server/src/redis/redis.module.ts`（新增 RedisModule）
- 用途：离线消息队列（Streams）、未读计数缓存
- docker-compose 中已有 Redis 7

### 0.4 基础目录结构
```
apps/server/src/chat/
├── chat.module.ts          → 重构
├── chat.controller.ts      → 重写
├── chat.service.ts         → 重写
├── chat.gateway.ts         → 新增 (Chat 3.0 WS Gateway)
├── chat-notification.service.ts → 新增
├── chat-upload.service.ts      → 新增
├── chat-search.service.ts      → 新增
├── guards/
│   └── participant.guard.ts    → 新增
├── dto/
│   ├── send-message.dto.ts     → 新增
│   ├── create-room.dto.ts      → 新增
│   └── sync-request.dto.ts     → 新增
└── migrate-legacy.ts           → 新增

apps/web/src/
├── components/chat/               → 新目录
│   ├── ChatProvider.tsx           → 新增
│   ├── ChatPanel.tsx              → 新增
│   ├── EmbeddedChatPanel.tsx      → 新增
│   ├── MessageList.tsx            → 新增
│   ├── MessageBubble.tsx          → 重写
│   ├── MessageContent.tsx         → 新增
│   ├── ChatComposer.tsx           → 新增
│   ├── ChatHeader.tsx             → 新增
│   ├── ReplyBar.tsx               → 新增
│   ├── ReplyPreview.tsx           → 新增
│   ├── TypingIndicator.tsx        → 新增
│   ├── MessageReactions.tsx       → 新增
│   ├── MessageContextMenu.tsx     → 新增
│   ├── DateDivider.tsx            → 新增
│   ├── OrderCardMessage.tsx       → 新增
│   ├── FileMessage.tsx            → 新增
│   ├── ImageViewer.tsx            → 新增
│   ├── EmojiPicker.tsx            → 增强
│   ├── CompanionSidebar.tsx       → 新增
│   ├── CompanionItem.tsx          → 新增
│   └── index.ts
├── stores/
│   └── chatStore.ts               → 重写
├── hooks/
│   ├── useChatSync.ts             → 新增
│   ├── useChatNotification.ts     → 增强
│   └── useVirtualScroll.ts        → 新增
├── api/
│   └── chat.ts                    → 扩展
├── workers/
│   └── chat-db.worker.ts          → 新增 (IndexedDB)
└── pages/dispatch/
    └── CSDispatchView.tsx         → 重构集成
```

---

## Phase 1: 核心修复 + 消息可靠投递 (3天)

### 1.1 统一未读计数 — 移除 localStorage 轮询
- **文件**: `apps/web/src/pages/dispatch/CSDispatchView.tsx`
- 删除 localStorage `unread-*` 轮询逻辑 (lines 61-73)
- 接入 `chatStore.totalUnread` + `chatStore.rooms[id].unreadCount`
- CompanionItem 组件从 store 读取未读状态
- **关键**: 同步移除 OrderPoolPage、OrdersPage、companion/PoolPage 中同样的 localStorage 轮询

### 1.2 WebSocket ACK 确认机制
- **文件**: `apps/server/src/chat/chat.gateway.ts`
- 新增 `message:ack` handler → 更新投递状态
- **文件**: `apps/web/src/hooks/useChatSync.ts`
- 收到 `message:new` → 发送 `message:ack`

### 1.3 HTTP 轮询 fallback
- **文件**: `apps/server/src/chat/chat.controller.ts`
- 新增 `GET /chat/sync` → 基于 rooms + lastKnownSeq 增量返回
- **文件**: `apps/web/src/hooks/useChatSync.ts`
- WebSocket 断线时自动切换 30s HTTP 轮询

### 1.4 消息序号 (seq) 机制
- `ChatRoom.lastMessageSeq` 自增，通过 Prisma `$transaction` 原子递增
- `ChatMessage.seq` 在创建时分配
- `aReadSeq` / `bReadSeq` 替代 `aReadAt` / `bReadAt`

### 1.5 参与者校验 Guard
- **新文件**: `apps/server/src/chat/guards/participant.guard.ts`
- 所有 ChatRoom 操作验证 `req.user.id` 是 participantA 或 participantB

### 1.6 loadMessages 修复
- **文件**: `apps/web/src/stores/chatStore.ts`
- `loadMessages` 使用 `ensureConv` 安全创建占位

---

## Phase 2: 嵌入式聊天面板 + 交互体验 (4天)

### 2.1 CSDispatchView 嵌入式面板
- **文件**: `apps/web/src/pages/dispatch/CSDispatchView.tsx`
- 布局改为左右分栏：左侧 CompanionSidebar + 右侧 EmbeddedChatPanel
- 可拖拽分割线调整宽度（使用 `react-resizable-panels`）
- 点击陪玩 → 右侧面板切换聊天对象
- 关闭面板 → 右侧折叠

### 2.2 ChatPanel 核心组件
- **新文件**: `apps/web/src/components/chat/ChatPanel.tsx`
  - 组合: ChatHeader + MessageList + ChatComposer
  - 从 chatStore 读取数据和操作
  - 支持外部传入 `roomId` 或内部管理 activeRoomId

### 2.3 MessageList 虚拟滚动
- **新文件**: `apps/web/src/components/chat/MessageList.tsx`
- 使用 `@tanstack/react-virtual` 实现虚拟滚动
- 顶部 ScrollObserver → 触发加载更多历史消息
- 新消息到达自动滚到底部（若已在底部）
- 新消息到达时在顶部 → 显示 "↓ N条新消息" 浮动按钮

### 2.4 消息气泡重写
- **新文件**: `apps/web/src/components/chat/MessageBubble.tsx`
- 支持类型：TEXT / IMAGE / FILE / ORDER_CARD / SYSTEM
- pending → sent → 已读 状态转换动画
- 头像 + 时间分组（已有逻辑，保留增强）
- 日期分隔线智能分组（今天/昨天/星期/日期）
- 右键菜单（MessageContextMenu）

### 2.5 引用回复
- **新文件**: `apps/web/src/components/chat/ReplyPreview.tsx`
- 消息气泡上方显示被引用消息缩略
- 点击跳转到原消息位置（滚动定位 + 高亮闪烁）
- ReplyBar → 输入区上方显示 "正在回复: xxx"

### 2.6 正在输入状态
- WebSocket `typing:start` / `typing:stop`
- 300ms 防抖，5s 超时自动停止
- **新文件**: `apps/web/src/components/chat/TypingIndicator.tsx`
- 三点跳动动画

### 2.7 消息反应 (Emoji Reaction)
- **新文件**: `apps/web/src/components/chat/MessageReactions.tsx`
- 长按/右键消息 → 弹出 emoji 选择行
- 已有反应显示在消息下方，点击可追加/取消
- 5 个常用 emoji 直接显示：👍❤️😂😮😢

### 2.8 键盘快捷键
- `Ctrl+Enter` / `Cmd+Enter`: 发送
- `Esc`: 关闭面板 / 取消回复
- `↑`: 编辑上一条自己发送的消息
- `Ctrl+F` / `Cmd+F`: 搜索当前会话

---

## Phase 3: 富媒体消息 + 订单卡片 (3天)

### 3.1 文件上传服务
- **新文件**: `apps/server/src/chat/chat-upload.service.ts`
- 存储到 `uploads/chat/` 目录
- 生成缩略图（图片: sharp, max 400px）
- 文件大小限制: 20MB，类型白名单

### 3.2 图片消息
- **新文件**: `apps/web/src/components/chat/MessageContent.tsx`
- 缩略图点击 → ImageViewer 全屏预览（支持缩放/轮播）
- 多图网格布局（1图大、2图并排、3+图九宫格）
- 渐进式加载：先显示模糊占位 → 原图加载后淡入

### 3.3 文件消息
- **新文件**: `apps/web/src/components/chat/FileMessage.tsx`
- 文件卡片展示：图标 + 文件名 + 大小
- 点击下载（新窗口打开 / Blob 下载）

### 3.4 订单卡片消息
- **新文件**: `apps/web/src/components/chat/OrderCardMessage.tsx`
- 结构化展示：游戏、金额、时长、客户、状态
- "查看订单详情" → 跳转订单页
- 背景渐变黄色，区分普通消息

### 3.5 表情包增强
- **文件**: `apps/web/src/components/chat/EmojiPicker.tsx`
- 分组: 😊 常用 / 🎮 游戏 / 🔥 热门 / ⭐ 自定义
- 支持添加自定义表情（已有 `localStorage custom-emojis` 基础，迁移到服务端存储）
- 最近使用记录

---

## Phase 4: 会话管理 + 搜索 (2天)

### 4.1 会话置顶
- ChatRoom.pinned + pinnedAt 字段
- `PATCH /api/chat/rooms/:id` → `{ pinned: true }`
- 置顶会话在列表中分组显示，📌 图标

### 4.2 会话搜索
- `GET /api/chat/rooms?search=关键词`
- 服务端 ILIKE 匹配 participant 名称 + orderInfo
- 前端搜索输入框 → 防抖 300ms → 实时筛选

### 4.3 会话筛选
- 筛选维度：游戏类型、订单状态、时间范围
- UI: 下拉筛选器标签组

### 4.4 批量已读 + 归档
- "全部已读" → `POST /api/chat/rooms/read-all`
- 归档 → ChatRoom.archived = true → 从主列表隐藏
- 归档会话 Tab: "已归档" 可查看/恢复

### 4.5 消息搜索 (当前会话内)
- **文件**: `apps/server/src/chat/chat-search.service.ts`
- `GET /api/chat/search?q=xxx&roomId=xxx`
- 前端: Ctrl+F / 搜索框 → 高亮匹配 → 上下跳转

---

## Phase 5: 通知体系 + 离线缓存 (3天)

### 5.1 统一通知管理
- **新文件**: `apps/server/src/chat/chat-notification.service.ts`
- 三级提醒策略实现
- 通知铃铛增强: 摘要文案 "3个陪玩发来5条消息"

### 5.2 IndexedDB 本地缓存
- **新文件**: `apps/web/src/workers/chat-db.worker.ts`
- 使用 `idb` 库操作 IndexedDB
- 存储：消息（按 roomId + seq）、会话状态、待发送队列
- 打开页面 → 先从 IndexedDB 加载 → 同时从 API 同步差异
- 离线可查看历史消息

### 5.3 离线消息队列
- **服务端**: Redis Streams `chat:offline:{userId}`
- 消息创建后双写: WS推送 + Redis Stream
- 客户端重连 → 拉取 Redis 中自 lastKnownSeq 起的消息
- 成功后 ACK → 从 Stream 中移除

### 5.4 乐观更新 + 失败重试
- **文件**: `apps/web/src/stores/chatStore.ts`
- 发送消息: `status: "pending"` → API 成功 → `status: "sent"`
- 失败消息: 红色边框 + ⚠️ 图标 + 点击重发
- 离线时: 消息存入 `pendingSend` 队列 → 重连后批量发送

### 5.5 桌面通知 + Service Worker
- Service Worker 注册 (生产环境需 HTTPS)
- Web Push API 推送订阅
- 浏览器关闭也能收到通知

---

## Phase 6: Legacy 清理 + 安全合规 (2天)

### 6.1 Legacy 废弃
- 路由守卫逐步拦截 `/companions/chat-*` → 返回 410 Gone
- `chat:send` / `chat:new` / `chat:notify` WebSocket 事件停止处理
- `ChatMessageLegacy` 表标记 deprecated，数据已迁移

### 6.2 敏感词过滤
- **文件**: `apps/server/src/chat/chat.service.ts`
- 内置敏感词列表（可配置扩展）
- 命中 → 拒绝发送，返回 `CHAT_SENSITIVE_WORD`

### 6.3 消息撤回
- 2 分钟窗口 → `ChatMessage.deletedAt` 软删除
- UI: "消息已被撤回" 灰色斜体 + 撤回者标识
- ChatAuditLog 记录撤回操作

### 6.4 审计日志
- ChatAuditLog 记录: SEND / RECALL / DELETE / REACT / READ
- 管理员可查询 → `GET /api/admin/chat-audit?userId=&roomId=&action=&dateFrom=&dateTo=`

### 6.5 频率限制
- 使用 `@nestjs/throttler`
- 消息发送: 30条/分钟/用户
- 文件上传: 10次/小时/用户

---

## Phase 7: UI/UX 视觉实现 (3天)

### 7.1 主题系统
- **文件**: `apps/web/src/theme.ts` → 扩展
- 深色侧边栏 + 浅色内容区双主题变量
- CSS Variables 驱动，支持后续暗色模式切换

### 7.2 组件样式实现
- 按照视觉规范实现所有组件样式
- Tailwind 工具类 + CSS Modules 混合使用
- antd 组件覆盖样式（Popover、Menu、Badge 等）

### 7.3 动画微交互
- Framer Motion 实现消息动画
- CSS @keyframes: 铃铛摇晃、三点跳动、红点弹出
- 过渡动画: 面板展开、切换陪玩、气泡 hover

### 7.4 响应式适配
- Desktop → Laptop → Tablet → Mobile 四个断点
- 侧边栏自适应宽度
- 移动端全屏切换模式

---

## 完整文件变更清单

### 新增文件 (35+)

**Server:**
```
apps/server/src/chat/chat.gateway.ts
apps/server/src/chat/chat-notification.service.ts
apps/server/src/chat/chat-upload.service.ts
apps/server/src/chat/chat-search.service.ts
apps/server/src/chat/guards/participant.guard.ts
apps/server/src/chat/dto/send-message.dto.ts
apps/server/src/chat/dto/create-room.dto.ts
apps/server/src/chat/dto/sync-request.dto.ts
apps/server/src/chat/migrate-legacy.ts
apps/server/src/redis/redis.module.ts
```

**Web (components/chat/):**
```
apps/web/src/components/chat/ChatProvider.tsx
apps/web/src/components/chat/ChatPanel.tsx
apps/web/src/components/chat/EmbeddedChatPanel.tsx
apps/web/src/components/chat/MessageList.tsx
apps/web/src/components/chat/MessageContent.tsx
apps/web/src/components/chat/ChatComposer.tsx
apps/web/src/components/chat/ChatHeader.tsx
apps/web/src/components/chat/ReplyBar.tsx
apps/web/src/components/chat/ReplyPreview.tsx
apps/web/src/components/chat/TypingIndicator.tsx
apps/web/src/components/chat/MessageReactions.tsx
apps/web/src/components/chat/MessageContextMenu.tsx
apps/web/src/components/chat/DateDivider.tsx
apps/web/src/components/chat/OrderCardMessage.tsx
apps/web/src/components/chat/FileMessage.tsx
apps/web/src/components/chat/ImageViewer.tsx
apps/web/src/components/chat/CompanionSidebar.tsx
apps/web/src/components/chat/CompanionItem.tsx
apps/web/src/components/chat/index.ts
```

**Web (其他):**
```
apps/web/src/hooks/useChatSync.ts
apps/web/src/hooks/useVirtualScroll.ts
apps/web/src/workers/chat-db.worker.ts
```

### 修改文件 (15+)

**Server:**
```
apps/server/prisma/schema.prisma          → 新增 Chat 3.0 模型
apps/server/src/chat/chat.module.ts       → 注册新服务/Guard
apps/server/src/chat/chat.controller.ts   → 重写全部端点
apps/server/src/chat/chat.service.ts      → 重写业务逻辑
apps/server/src/ws/ws.gateway.ts          → 添加 Chat 3.0 WS handler
apps/server/src/app.module.ts             → 注册 RedisModule
```

**Web:**
```
apps/web/src/stores/chatStore.ts          → 重写
apps/web/src/api/chat.ts                  → 扩展
apps/web/src/hooks/useChatNotification.ts → 增强
apps/web/src/hooks/useSocket.ts           → 添加 Chat 3.0 WS listener
apps/web/src/theme.ts                     → 扩展主题变量
apps/web/src/layouts/AppLayout.tsx        → 集成 ChatProvider
apps/web/src/pages/dispatch/CSDispatchView.tsx → 重构嵌入式面板
apps/web/src/components/ChatModal.tsx     → 保留兼容，标记 deprecated
apps/web/src/components/ChatInput.tsx     → 增强文件/表情支持
apps/web/src/components/ConversationList.tsx → 适配新数据模型
apps/web/src/components/FloatingChatWidget.tsx → 适配新 store
```

### 删除文件/废弃
```
标记 @deprecated (Phase 6 正式移除):
  ChatMessageLegacy 模型
  Conversation 模型 (替换为 ChatRoom)
  apps/server/src/companions/ 中的 chat-notify/chat-pending/chat-history/chat-upload 端点
  ws.gateway.ts 中的 chat:send handler / chat:new emit / chat:notify emit
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 数据迁移丢失消息 | 迁移前备份数据库，迁移后校验计数 |
| WebSocket 大规模重连 | 使用 Redis Streams 做缓冲，避免 DB 查询风暴 |
| IndexedDB 存储超限 | LRU 淘汰策略，最多保留 30 天消息 |
| CS 使用习惯变更 | 保留 ChatModal 作为备选，渐进过渡 |
| Legacy 系统仍有客户端调用 | 先加日志监控调用量，确认 0 调用后再废弃 |

---

## 估时汇总

| Phase | 内容 | 估时 |
|-------|------|------|
| 0 | 基础设施准备 | 2 天 |
| 1 | 核心修复 + 可靠投递 | 3 天 |
| 2 | 嵌入式面板 + 交互 | 4 天 |
| 3 | 富媒体 + 订单卡片 | 3 天 |
| 4 | 会话管理 + 搜索 | 2 天 |
| 5 | 通知 + 离线缓存 | 3 天 |
| 6 | Legacy 清理 + 安全 | 2 天 |
| 7 | UI/UX 实现 | 3 天 |
| **合计** | | **22 天** |

---

## 验证方法

### 核心流程验证
1. 陪玩发消息 → CSDispatchView 陪玩列表红点 + 铃铛 badge → 点击展开聊天面板 → 看到消息
2. 浏览器关闭 → 陪玩发消息 → 打开浏览器 → 消息完整出现 + 未读计数正确
3. 两个陪玩同时发消息 → 通知不遗漏、不重复、不乱序

### 技术验证
1. WebSocket 断连 → 自动切换 HTTP 轮询 → 消息不丢失
2. 乐观更新 → pending → sent → 已读 状态正确过渡
3. IndexedDB 缓存 → 离线可查看历史 → 在线自动同步
4. 敏感词过滤 → 含敏感词消息被拒绝

### 安全验证
1. 非参与者访问 ChatRoom → 403
2. 消息撤回 → 2 分钟后不可撤回
3. 审计日志 → 完整记录所有操作
