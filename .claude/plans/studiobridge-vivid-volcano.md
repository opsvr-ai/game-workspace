# StudioBridge 跨工作室桥接 — 实施计划

## Context

两个工作室（A和B）希望实现资源互通：抢单池共享、跨工作室抢单/邀请/聊天/分账，如同一个工作室一样运作。用户明确：A申请→B同意即全部授权，无需逐项审批。

现有基础设施：`StudioBridge` + `StudioBridgePermission` schema 已存在，`BridgeService`（含 `propose`/`respond`/`getBridgedStudioIds`/`getVisibleStudioIds`）已实现但**未注册到模块系统**，无 REST 端点，无前端 UI。四个子系统（订单池、WebSocket 广播、聊天、计费）均为单工作室范围。

## 设计决策

1. **桥接=双向互通**：A申请B同意后，A↔B池、聊天、邀请、分账全开
2. **订单保留原始 studioId**：跨工作室抢单后，order.studioId 不变，companion.studioId ≠ order.studioId
3. **聊天用 nullable studioId**：同工作室 room.studioId=studioA，跨工作室 room.studioId=null
4. **广播走 Socket.IO 房间**：连接时加入所有桥接工作室的房间，避免每次广播遍历
5. **分账存 customFields.splits**：不新建 model，保持简单
6. **BridgeService 加缓存**：pool 查询和广播频繁调用，5秒 TTL 内存缓存

## 实施顺序

### Phase 1: 基础设施（注册 BridgeService + REST API）

**`apps/server/src/studios/studios.module.ts`** — 注册 BridgeService：
- `providers` 添加 `BridgeService`
- `exports` 添加 `BridgeService`

**`apps/server/src/studios/bridge.service.ts`** — 添加内存缓存：
- `bridgedCache: Map<string, { ids: string[]; ts: number }>` (TTL 5s)
- `getBridgedStudioIds()` 和 `getVisibleStudioIds()` 先查缓存
- `propose()`/`respond()` 后清除相关缓存

**新文件 `apps/server/src/studios/bridge.controller.ts`** — REST API：
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `bridges/propose` | OWNER | 发起桥接申请 `{ targetStudioId }` |
| POST | `bridges/:id/respond` | OWNER/ADMIN | 同意/拒绝 `{ accept: boolean }` |
| GET | `bridges` | OWNER/ADMIN | 列出我的桥接（活跃+待处理） |
| GET | `bridges/active` | 已认证 | 获取活跃桥接工作室列表 |
| DELETE | `bridges/:id` | OWNER | 终止桥接 |

注册到 `StudiosModule.controllers`。

**模块依赖注入**：
- `WsModule` imports `StudiosModule` → `WsGateway` 注入 `BridgeService`
- `OrdersModule` imports `StudiosModule` → `OrdersService` 注入 `BridgeService`
- `ChatModule` imports `StudiosModule` → `ChatService` 注入 `BridgeService`

### Phase 2: 抢单池互通

**`apps/server/src/orders/orders.service.ts`**:

`findPool()` (~line 145)：将 `where.studioId = studioId` 改为：
```typescript
if (studioId) {
  const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
  where.studioId = { in: [studioId, ...bridgedIds] };
}
```
返回时附带 `_studioName`（通过 include `studio: { select: { name: true } }`）。

`findAll()` (~line 163)：CS/ADMIN 角色同样扩展 `where.studioId: { in: [studioId, ...bridgedIds] }`。

**`apps/server/src/ws/ws.gateway.ts`**:

`handleConnection()`：连接时除 `studio:<user.studioId>` 外，遍历 `getBridgedStudioIds()` 加入所有桥接工作室房间：
```typescript
for (const bridgedId of bridgedIds) {
  void client.join(`studio:${bridgedId}`);
}
```

添加 `broadcastToBridgedStudios(studioId, event, data)`：自身 studio + 所有桥接 studio 广播。

**审计所有 `broadcastToStudio` 调点**，改为 `broadcastToBridgedStudios`：
- `OrdersService.create()` — `order:pool_updated` + `order:new`
- `OrderWorkflowService.grab()` — `order:pool_updated`
- `OrderWorkflowService.confirm()` — `order:pool_updated`
- `OrderWorkflowService.complete()` — `order:pool_updated`
- `OrderWorkflowService.completeWithBilling()` — `order:pool_updated`
- `OrdersService.callPartner()` — `order:partner_call`
- `OrderDispatchService`（quickGrab/accept/decline/assign）— `order:pool_updated`

**跨工作室授权放宽**：`cancel()`/`complete()`/`assign()` 中的 `order.studioId !== userStudioId` 校验改为 `!visibleStudioIds.includes(order.studioId)`。

### Phase 3: 跨工作室聊天

**Schema 迁移**（`schema.prisma`）：
- `ChatRoom.studioId` 改为 `String?`（可空）
- 删除 `@@unique([studioId, participantA, participantB])`
- 手动 SQL 迁移创建 partial unique indexes：
```sql
CREATE UNIQUE INDEX "ChatRoom_studio_unique" ON "ChatRoom" ("studioId", "participantA", "participantB") WHERE "studioId" IS NOT NULL;
CREATE UNIQUE INDEX "ChatRoom_cross_unique" ON "ChatRoom" ("participantA", "participantB") WHERE "studioId" IS NULL;
```

**`apps/server/src/chat/chat.service.ts`**:

`getOrCreateRoom()`：判断两个用户是否同工作室→`studioId=studioA`，是否桥接→`studioId=null`。跨工作室时跳过 `@@unique`（使用 null 的 partial index）。

`listRooms()`：WHERE 扩展为 `OR: [{ studioId, participantA: userId }, { studioId, participantB: userId }, { studioId: null, participantA: userId }, { studioId: null, participantB: userId }]`。

序列化 participant 时增加 `studioName` + `isCrossStudio` 字段。

**`apps/server/src/chat/chat.controller.ts`**：`POST /chat/rooms` 创建房间时不强制 `studioId` 校验（允许 cross-studio）。

### Phase 4: 跨工作室邀请 + 分账

**`apps/server/src/orders/orders.service.ts`**:

`callPartner()`：使用 `broadcastToBridgedStudios` + 附带 `callerStudioName`：
```typescript
const caller = await this.prisma.companion.findUnique({ where: { id: callerId }, include: { studio: { select: { name: true } } } });
this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:partner_call', {
  ...payload, callerStudioName: caller?.studio?.name,
});
```

`acceptPartner()`：同时设置 `coCompanionId`（已有字段，非 customFields）：
```typescript
data: { coCompanionId: partnerId, customFields: { ...cf, partnerId } }
```

**`apps/server/src/orders/order-workflow.service.ts`**:

`completeWithBilling()`：扩展 DTO 接受 `splitTo?: Array<{ companionId: string; amount: number }>`：
- 主陪玩收入 = totalAmount - sum(splitTo.amount)
- 每个 splitTo 陪玩各自 `monthlyRevenue +{amount}`
- 分账记录存入 `customFields.splits`

### Phase 5: 前端

**新页面 `apps/web/src/pages/BridgePage.tsx`**：
- 工作室列表 + "申请桥接"按钮
- 待处理申请 Tab（收到的+发出的）
- 活跃桥接 Tab（显示对方工作室名称）
- 同意/拒绝按钮

路由：`/bridges`，OWNER/ADMIN 可见。

**`apps/web/src/pages/OrderPoolPage.tsx`**：订单卡片显示 `_studioName` tag（紫色"来自X工作室"）。

**`apps/web/src/components/chat/ChatHeader.tsx`**：当 `participant.isCrossStudio` 为 true 时显示 `来自{studioName}的{name}`。

**`apps/web/src/components/PartnerCallNotification.tsx`**（新）：监听 `order:partner_call` 事件，弹窗显示 "来自X工作室的Y请求协作接单" + 接受/忽略按钮。

**`apps/web/src/hooks/useSocket.ts`**：添加 `onPartnerCall` 回调。

**计费 UI**：`completeWithBilling` 弹窗 — 当有 coCompanion 时显示分账输入区，自动计算归属。

**`apps/web/src/api/bridge.ts`**（新）：桥接 API 调用封装。

## 验证方案

1. **创建桥接**：OWNER 账号登录→桥接管理页→申请桥接→另一个工作室的 ADMIN 登录→同意→桥接变为 ACTIVE
2. **抢单池互通**：工作室A的CS上传POOL订单→工作室B的陪玩登录→抢单池可见该订单（显示"来自A工作室"）→抢单成功
3. **跨工作室聊天**：B工作室陪玩抢单后→点击"沟通"→弹窗显示"A工作室的CS"→正常收发消息
4. **跨工作室邀请**：A陪玩抢单后→callPartner→B陪玩收到 `order:partner_call`（显示"来自A工作室"）→接受→coCompanionId 设置
5. **跨工作室分账**：主陪玩 completeWithBilling→输入分账金额→两个陪玩的 monthlyRevenue 各自增长→customFields.splits 记录完整
6. **服务器编译通过**：`pnpm build`（服务端零错误）
