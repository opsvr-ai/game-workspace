## WebSocket 实时同步
- `broadcastToStudio(studioId, event, payload)` — 订单状态变更后向工作室广播
- 事件命名: `order:pool_updated`, `status:broadcast`, `pc:command`
- JWT 认证在 Socket.IO 连接时完成，自动加入 `studio:${studioId}` 和 `companion:${companionId}` 房间

## 跨工作室权限验证
- 从 `@Req() req` 提取 `user.studioId`
- 通过 controller → service → workflow 层传播 `userStudioId`
- 在 workflow 入口添加 `if (userStudioId && order.studioId !== userStudioId)` 守卫

## 订单状态机
- PENDING → GRABBED (抢单) 或 CONFIRMED (指定派单) 或 CANCELLED
- GRABBED → CONFIRMED (确认) 或 CANCELLED
- CONFIRMED → DONE (完成) 或 CANCELLED
- 使用 `validateTransition()` 验证状态转换合法性

## JWT 双 Token
- accessToken: 15 分钟过期，放在 Authorization header
- refreshToken: 7 天过期，用于刷新 accessToken
- axios interceptor 自动在 401 时尝试 refresh

## 工作室桥接 (StudioBridge)
- 两个工作室可建立 ACTIVE 桥接关系
- 按功能维度授权: ORDERS | POOL | CUSTOMERS | BILLING | KPI
- 跨工作室聊天室 (studioId = null)

## Chat 3.0 消息架构
- ChatRoom: participantA/participantB (字母序)，per-room seq 自增
- ChatMessageV3: 支持 TEXT/IMAGE/FILE/AUDIO/ORDER_CARD/SYSTEM 类型
- 软删除 (deletedAt) 实现消息撤回
- MessageReaction: emoji 反应 (userId+emoji 联合唯一)