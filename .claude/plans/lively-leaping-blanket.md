# 多角色协同 — 实时同步 & 权限边界审计

## 实时同步覆盖（20 操作 → 仅 8 有广播）

| 操作 | 状态变更 | WebSocket | 状态 |
|------|----------|-----------|------|
| Create POOL | →PENDING | order:pool_updated (studio) | ✅ |
| Create BROADCAST | →PENDING | order:urgent (idle) | ✅ |
| Create DIRECT | →PENDING | order:new (companion) | ✅ |
| Create urgent | →PENDING | order:urgent (idle) | ⚠️ 重复 |
| **Grab** | P→GRABBED | order:pool_updated + order:grabbed | ✅ |
| **QuickGrab** | P→GRABBED | **无** | 🔴 |
| **Assign (CS)** | →DIRECT | order:new (only target) | 🔴 无pool |
| **AcceptAssignment** | P→GRABBED | **无** | 🔴 |
| **DeclineAssignment** | →POOL | **无** | 🔴 |
| **Confirm** | G→CONFIRMED | **无** | 🔴 |
| **Complete** | C→DONE | **无** | 🔴 |
| **CompleteWithBilling** | C→DONE | **无** | 🔴 |
| **Cancel** | →CANCELLED | **无** | 🔴 |
| **UpdateContact** | contactStatus | **无** | 🔴 |
| **UpdateAmount** | amount | **无** | 🔴 |
| **Renew** | →PENDING(新) | order:new (only companion) | 🔴 无pool |
| **Republish** | →PENDING(新) | **无** | 🔴 |
| CallPartner | — | order:partner_call | ✅ |
| MarkReady | — | **无** | 🟡 |

## 权限边界审计（21 个缺口）

| ID | 级别 | 问题 |
|----|------|------|
| C5 | 🔴 | 任何陪玩可 completeWithBilling 其他陪玩的订单 |
| CS1 | 🔴 | CS/ADMIN 可完成任何工作室的订单 |
| C1 | 🟠 | 任何陪玩可修改任何订单金额 |
| C2 | 🟠 | 任何陪玩可修改任何订单联系状态 |
| CS2 | 🟠 | CS/ADMIN 可取消任何工作室的订单 |
| CS3 | 🟠 | CS/ADMIN 可跨工作室重新分配订单 |
| W1 | 🟠 | assign 绕过状态机校验 |
| W2 | 🟠 | updateAmount 绕过状态机 |
| W3 | 🟠 | updateContact 绕过状态机 |
| C3-C8, CS4, A1-A3, X1, W4-W5 | 🟡 | 12 项中等越权/绕过 |

## 修复方案

### 1. 补全 WebSocket 广播（12 处）
quickGrab/accept/decline/confirm/complete/cancel/updateContact/updateAmount/republish → 补 broadcastToStudio

### 2. 补全所有权校验（8 处）
updateAmount/updateContact/renew/republish/completeWithBilling/markReady/callPartner/acceptPartner → 补 companionId/csUserId 校验

### 3. 补全工作室边界校验（4 处）
complete/cancel/assign/compensateCustomer → 补 studioId 校验

### 4. 统一状态机入口
assign/updateAmount/updateContact → 改用 workflow 校验
