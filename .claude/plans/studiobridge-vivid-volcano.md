# StudioBridge 桥接功能全面审计 — 修复计划

## Context

对工作室桥接功能进行代码级审计，覆盖：发布订单→互看→陪玩状态→邀请搭档→分流水→报账。发现 17 个 Critical + 15 个 High/Medium 问题需要修复。

## Critical Issues（破坏性bug / 安全隐患）

### C1. ChatRoom 无唯一约束 → TOCTOU 竞争条件（chat.schema.prisma）
**文件**: `prisma/schema.prisma:517-540`  
**问题**: 删除 `@@unique([studioId, participantA, participantB])` 后没有替代的唯一约束。`findFirst + create` 非原子操作，两个并发请求可创建重复房间。  
**修复**: 执行 SQL 创建两个 partial unique indexes（已用 `prisma db execute` 创建过但可能丢失），验证它们存在。

### C2. handleConnection 未捕获 Promise 拒绝 → 进程崩溃（ws.gateway.ts:104）
**问题**: `this.bridgeService.getBridgedStudioIds(...).then(...)` 无 `.catch()`，DB 错误时 unhandled rejection 杀死进程。  
**修复**: 加 `.catch(err => logger.error('...', err))`。

### C3. chat.controller 绕过 service 层（chat.controller.ts:122）
**问题**: `(this.chatService as any)['prisma']?.chatRoom?.findUnique?.(...)` 直接访问私有属性，若 Prisma 未加载则静默失败不推送消息。  
**修复**: 改用 `this.chatService.getRoom(id)` 公开方法。

### C4. acceptPartner 无桥接验证（orders.service.ts:403）
**问题**: 不验证 partnerId 所属工作室是否与 order.studioId 同工作室或已桥接，任何陪玩知悉 orderId 即可接受。  
**修复**: 查 partner 的 studioId，用 `getBridgedStudioIds` 验证。

### C5. acceptPartner 无广播（orders.service.ts:403）
**问题**: 更新 coCompanionId 后不广播，桥接方看不到实时变化。  
**修复**: 加 `broadcastToBridgedStudios`。

### C6. 月度结算遗漏 split/co-companion 收入（settlement.service.ts:54）
**问题**: `orders.findMany({ where: { companionId: c.id, status: 'DONE' } })` 只查 primary companion，split 陪玩的 monthlyRevenue 从未参与结算、从未转 balance。  
**修复**: 扩展查询包含 `coCompanionId` 匹配。

### C7. 陪玩排名排除桥接工作室（companion-revenue.service.ts:12）
**问题**: `companion.findMany({ where: { studioId } })` 只看当前工作室。  
**修复**: 扩展为 `studioId: { in: [studioId, ...bridgedIds] }`。

### C8. companion status:broadcast 不达桥接工作室（ws.gateway.ts:125/161/235）
**问题**: handleConnection/handleDisconnect/handleStatusChange 的 `status:broadcast` 只发自己工作室，不发桥接工作室。  
**修复**: 三处都改用 `broadcastToBridgedStudios`。

### C9. findPool 无 studioId 时泄露全部订单（orders.service.ts:147）
**问题**: `if (studioId)` 为 false 时不加任何过滤，返回全平台订单。  
**修复**: `if (!studioId) return [];`。

### C10. create() 对 undefined studioId 使用 ! 断言（orders.service.ts:57）
**问题**: `studioId: studioId!` 但 studioId 可能为 undefined。  
**修复**: 若 studioId 无值则抛 NotFoundException。

### C11. grab 中 companion 不存在时跳过桥接校验（order-workflow.service.ts:39）
**问题**: `companion?.studioId` 为 undefined 时整个 if 块跳过。  
**修复**: 先抛 NotFoundException 若 companion 不存在。

### C12. getTotalUnread 遗漏跨工作室房间（chat.service.ts:338）
**问题**: WHERE 只用 `studioId`，不包含 `studioId: null` 的跨工作室房间。  
**修复**: 加 `OR: [{ studioId }, { studioId: null }]`。

### C13. settlement getOverview 按 studioId 过滤排除了跨工作室订单（settlement.service.ts:156）
**文件**: `settlement.service.ts`  
**问题**: `where: { studioId, status: 'DONE', companionId: ... }` 把 companion 在桥接工作室完成的订单排除。  
**修复**: 扩展为 `studioId: { in: visibleStudioIds }`。

### C14. OWNER 无 studioId 时被聊天 API 拒绝（chat.controller.ts:47）
**问题**: `getStudioId()` 对 null studioId 抛 UnauthorizedException。  
**修复**: 允许 null studioId 通过，OWNER 可聊天（房间 studioId=null）。

### C15. OWNER 绕过桥接验证创建跨工作室房间（chat.service.ts:22）
**问题**: studioId=null 时 isCrossStudio=true 且桥接验证跳过。  
**修复**: 如果 caller studioId 为 null，禁止创建跨工作室房间（回退到同工作室）。

## High/Medium Fixes

### H1. assign/declineAssignment TOCTOU（order-dispatch.service.ts:17/76）
**修复**: assign 和 declineAssignment 改用 `updateMany` + WHERE guard 原子更新。

### H2. broadcastToBridgedStudios 抛异常导致误报500
**修复**: 所有 19 个调点用 `.catch()` 包裹，广播失败不影响业务响应。

### H3. broadcastToIdleCompanions 抛异常同样问题（ws.gateway.ts:355）
**修复**: 加 try-catch。

### H4. ChatAuditLog 失败静默吞掉（chat.service.ts:222）
**修复**: 加 `logger.error` 记录。

### M1. listRooms N+1 查询问题（chat.service.ts:95）
**修复**: 批量预加载 studio names 和 unread counts。

## 修改文件清单

| 文件 | 修复项 |
|------|--------|
| `ws.gateway.ts` | C2, C8, H3 |
| `chat.controller.ts` | C3, C14 |
| `chat.service.ts` | C12, C15, M1, H4 |
| `orders.service.ts` | C4, C5, C9, C10 |
| `order-workflow.service.ts` | C11 |
| `order-dispatch.service.ts` | H1 |
| `settlement.service.ts` | C6, C13 |
| `companion-revenue.service.ts` | C7 |
| `prisma/schema.prisma` | C1 (verify indexes) |

## 验证

1. 两个已桥接工作室各自发布 POOL 订单 → 互相在抢单池可见
2. A 陪玩在线 → B 的 CS 可见其状态
3. A 陪玩 callPartner → B 陪玩收到邀请并接受 → coCompanionId 设置 → 广播到双方
4. completeWithBilling splitTo → A+B 陪玩 monthlyRevenue 各自增长
5. 跑月度结算 → split 收入计入结算
6. 跨工作室聊天 → getTotalUnread 计入跨工作室房间
7. handleConnection 断 DB → 不崩溃，打日志
