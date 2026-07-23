# 全角色统一代码架构

## Context
四个角色（OWNER/ADMIN/CS/COMPANION）使用同一套代码，只通过权限控制显示差异。

## 发现的问题
- **2,241 行死代码**（AdminDispatchView、companion/OrdersPage、BillingPage+5个子组件）
- **OrderPoolPage vs companion/PoolPage** 85% 重复
- `/admin/dispatch` 和 `/admin/traffic` 是重复路由
- `/cs/employees` 和 `/cs/companions` 是重复路由

## 修复计划

### 1. 删除死代码（8 个文件）
- `pages/dispatch/AdminDispatchView.tsx`
- `pages/companion/OrdersPage.tsx`
- `pages/BillingPage.tsx`
- `pages/billing/CompanionBillingView.tsx`
- `pages/billing/TransactionList.tsx`
- `pages/billing/ExpenseApproval.tsx`
- `pages/billing/SettlementPanel.tsx`
- `pages/billing/OverviewPanel.tsx`

### 2. 合并订单池页面
- `companion/PoolPage.tsx` → 合并入 `OrderPoolPage.tsx`
- OrderPoolPage 已支持 `isCompanion` 双模式，补上伴生的 work-wechat 抢单成功弹窗
- `/companion/pool` 路由指向合并后的 OrderPoolPage

### 3. 清理路由
- 删除 `/admin/traffic` 重复路由（已有 `/admin/dispatch`）
- 删除 `/cs/companions` 重复路由（已有 `/cs/employees`）

### 4. 统一菜单
- 所有角色菜单从统一模板出，用 `visibleForRoles` 过滤
- 同功能名称保持一致

## 修改文件
| 文件 | 操作 |
|------|------|
| `OrderPoolPage.tsx` | 合并 companion/PoolPage 逻辑 |
| `companion/PoolPage.tsx` | 删除 |
| `dispatch/AdminDispatchView.tsx` | 删除 |
| `companion/OrdersPage.tsx` | 删除 |
| `BillingPage.tsx` + 5 个子组件 | 删除 |
| `router.tsx` | 清理重复路由 + companion/pool 指向 OrderPoolPage |
| `AppLayout.tsx` | 统一菜单定义 |

## 验证
1. OWNER 登录 → 派单管理 → 看到派单工作台
2. ADMIN 登录 → 派单管理 → 看到相同界面（权限过滤了不可操作项）
3. CS 登录 → 派单管理 → 相同界面
4. COMPANION 登录 → 订单池 → 看到合并后的订单池（含抢单+沟通）
5. 所有角色点击各菜单项正常工作
