# 陪玩工作室管理系统 — 需求分析与开发 TASK 清单

> 📅 2026-07-05 | 🔍 基于源码全量对比 | 🎯 7 大模块 / 18 个 TASK

---

## 一、需求 vs 现状差距分析

### 1.1 已实现（无需改造）

| 需求 | 当前实现 | 文件 |
|------|---------|------|
| 首单/续单/复购/打赏 | `OrderType`: NEW/RENEW/REPURCHASE/TIP | enums.ts |
| 单陪/双陪 | DispatchType POOL/DIRECT + dual-companion flow | orders.service.ts |
| 线下工作室/线上俱乐部 | `StudioType`: DIRECT/RENTAL | enums.ts |
| 阶梯分成 | 50%/60%/70% 三段式 | billing.service.ts |
| 订单池+流水解锁 | `grab()` 检查 `todayRevenue >= unlockThreshold` | orders.service.ts:174 |
| 工作微信管理 | `WorkWechat` 表 + CRUD | schema.prisma |
| 客户画像+管理 | `CustomerProfile` 19字段 + `CustomerFollowUp` | schema.prisma |
| 进程黑名单 | 完整实现 | process-blacklist/ |
| 陪玩状态 | 5 种（计划改造为 6 种） | enums.ts |

### 1.2 需要新增/改造

| 需求 | 当前状态 | 差距 |
|------|:--:|------|
| **服务类型**「陪玩/护航/做任务」 | 无 | ❌ 需新增 `ServiceType` 枚举 |
| **游戏模式**「机密/绝密」 | 无 | ❌ 需新增到 customFields 或独立字段 |
| **考勤打卡** | 无 | ❌ 全新功能 |
| **开机→聊客户→攒流水流程** | 仅有流水解锁 | ❌ 需增强为多阶段流程 |
| **私域客户维护流程** | 无强制 | ❌ 需增加开机引导 |
| **无客户时上传凭证** | 无 | ❌ 全新功能 |
| **CS 上传客户到订单池** | 部分 | ⚠️ CreateOrderModal 已有，需增强客户信息字段 |
| **线上/线下分账模式差异化** | 线下阶梯/线上固定 | ⚠️ 当前仅有阶梯，需增加固定比例模式 |

---

## 二、需求不明确点的推荐方案

### 决策 A：服务类型如何影响订单？

| 选项 | 说明 |
|:--:|------|
| **A1（推荐）** | 增加 `serviceType` 字段到 Order 表，三种值仅影响计费方式：陪玩=按小时、护航=一口价、做任务=按任务量 |
| **A2** | 作为独立订单类型枚举扩展（与 NEW/RENEW/REPURCHASE 并列），复杂度过高 |

**✅ 推荐 A1**：`Order.serviceType` 字段（ENUM: PLAY_WITH / ESCORT / DO_TASK），陪玩按小时计费、护航固定价格、做任务按局/次数计费。

---

### 决策 B：考勤如何触发？

| 选项 | 说明 |
|:--:|------|
| **B1（推荐）** | Agent 登录=自动打卡上班，Agent 断开=自动打卡下班，管理端可查看考勤表 |
| **B2** | 手动打卡按钮，陪玩自行点击上下班 |

**✅ 推荐 B1**：结合 Agent 心跳自动记录。上班时间=当日首次心跳，下班时间=当日最后心跳。管理端可查看迟到/早退异常。

---

### 决策 C：开机→聊客户流程如何实现？

| 选项 | 说明 |
|:--:|------|
| **C1（推荐）** | 状态机：开机→强制 AVAILABLE（空闲）→ 陪玩必须操作→ 有客户下单=切到 BUSY→ 完成=切回→ 今日流水达标=解锁 ENTERTAINMENT |
| **C2** | 仅提醒，不强制 |

**✅ 推荐 C1**：通过 `CompanionPage` 状态按钮控制。ENTERTAINMENT 按钮在未达标时置灰+提示"今日流水 ¥{n}/¥{threshold}，还差 ¥{diff}"。RESTING 按钮始终可用。

---

### 决策 D：无客户时上传凭证流程？

| 选项 | 说明 |
|:--:|------|
| **D1（推荐）** | 陪玩上传截图（微信聊天记录）→ 管理员审核 → 审核通过后解锁订单池权限 |
| **D2** | 信任制，陪玩自行声明即可 |

**✅ 推荐 D1**：复用现有 `POST /api/upload/screenshot` + `POST /api/expense-reports` 模式。新增 `ProofReport` 表，类型为 `NO_CUSTOMER_PROOF`。

---

### 决策 E：线上/线下分账差异化？

| 选项 | 说明 |
|:--:|------|
| **E1（推荐）** | `Studio.type` 决定分账模式：DIRECT(线下)=阶梯分成、RENTAL(线上)=固定比例。`Companion.revenueShare` 存储个人实际分成比 |
| **E2** | 所有工作室统一用阶梯分成 |

**✅ 推荐 E1**：`Studio` 表增加 `splitMode` 字段（FIXED/TIERED），`monthly-settlement` 结算时按模式计算。

---

## 三、开发 TASK 清单 — 18 个 TASK / 7 模块

### 模块 1：服务类型 + 游戏模式（1.5h）

#### TASK-01 新增 ServiceType 枚举

**需求**：订单区分三种服务：陪玩（按小时）、护航（固定价）、做任务（按任务量）。

**开发**：
- `packages/shared/src/enums.ts` 新增 `ServiceType { PLAY_WITH='PLAY_WITH', ESCORT='ESCORT', DO_TASK='DO_TASK' }`
- `apps/server/prisma/schema.prisma` Order 模型新增 `serviceType String @default("PLAY_WITH")`
- `CreateOrderModal` 增加服务类型选择 Radio/Tabs
- `OrdersPage/DispatchPage` 卡片中显示服务类型 Tag

**验证**：创建订单时可选三种服务类型 → 订单卡片显示对应标签（陪玩=蓝/护航=橙/做任务=紫）

**文件**：4 | **工时**：1h

---

#### TASK-02 新增游戏模式字段

**需求**：订单支持选择游戏模式「机密」「绝密」。

**开发**：
- Order.customFields 增加 `gameMode` 字段（通过 CreateOrderModal 的 Select 选填）
- 无需独立枚举——游戏模式随游戏不同而变化，作为动态配置
- 在 `SystemConfig` 中预置 `game.modes` JSON 配置（与 `game.options` 并列）
- DispatchPage 订单卡片在第二行显示游戏模式 Tag

**验证**：CS 创建订单 → 选择游戏"三角洲行动" → 游戏模式下拉显示"机密/绝密" → 订单卡片显示模式 Tag

**文件**：2 | **工时**：0.5h

---

### 模块 2：考勤系统（2.5h）

#### TASK-03 新增考勤数据模型

**需求**：记录每个陪玩的每日考勤（上班时间、下班时间、工作时长、迟到/早退标记）。

**开发**：
```prisma
model CompanionAttendance {
  id           String    @id @default(uuid())
  companionId  String
  date         DateTime  // 日期（精确到天）
  loginAt      DateTime  // 当日首次上线时间
  logoutAt     DateTime? // 当日最后离线时间
  workMinutes  Int       @default(0)
  isLate       Boolean   @default(false)
  isEarlyLeave Boolean   @default(false)
  createdAt    DateTime  @default(now())

  companion    Companion @relation(fields: [companionId], references: [id])
  @@unique([companionId, date])
}
```

**验证**：数据库出现 `CompanionAttendance` 表

**文件**：1 | **工时**：0.5h

---

#### TASK-04 考勤自动记录逻辑

**需求**：Agent 首次心跳 → 自动记录上班；Agent 断开 → 记录下班。

**开发**：
- `ws.gateway.ts` `handleConnection`：检查今日是否已有 attendance 记录 → 无则创建，设置 `loginAt=now`
- `handleDisconnect`：更新 `logoutAt=now`，计算 `workMinutes`
- 迟到判断：`loginAt > 配置的上班时间（如 09:00）`
- 早退判断：`logoutAt < 配置的下班时间（如 18:00）`
- 配置项：`SystemConfig { key:'attendance.workStart', value:'09:00' }` 等

**验证**：陪玩 09:30 上线 → 考勤记录 `loginAt=09:30, isLate=true`

**文件**：2 | **工时**：1h

---

#### TASK-05 考勤管理页面

**需求**：管理端查看每个陪玩的考勤记录表。

**开发**：
- 新建 `AttendancePage.tsx`（ADMIN/OWNER 可见）
- 表格列：陪玩名 | 日期 | 上班 | 下班 | 工作时长 | 迟到 | 早退 | 状态
- 筛选：按日期范围、按陪玩、按状态（正常/迟到/早退/缺勤）
- API：`GET /api/companions/attendance?date=YYYY-MM-DD&companionId=`
- 路由：`/admin/attendance`

**验证**：登录 ADMIN → 考勤页面 → 看到陪玩列表 + 考勤状态 → 迟到行红色高亮

**文件**：3（新建 1 + 路由+菜单）| **工时**：1h

---

### 模块 3：开机→聊客户流程管控（3h）

#### TASK-06 开机引导弹窗

**需求**：Agent 登录后首先弹出引导，提示陪玩优先处理私域客户。

**开发**：
- Electron `main.ts` 登录成功后 → `mainWindow.webContents.send('nav:bootGuide')`
- `WorkbenchPage.tsx` 监听 `ws:bootGuide` → 弹出引导 Modal：
  - "📋 请优先联系你的私域客户 → 去客户管理"
  - 显示未跟进客户数量（超过 N 天未联系的客户）
  - 按钮：[去客户管理] [稍后提醒]

**验证**：登录 Electron → 弹出引导 → 点击"去客户管理"→ 跳转到客户列表

**文件**：2 | **工时**：1h

---

#### TASK-07 娱乐模式门槛增强

**需求**：今日流水不达标时，娱乐模式按钮置灰不可点击。增强现有 `revenue.unlock_threshold` 逻辑。

**开发**：
- 当前 CompanionPage 已有流水解锁进度条（L101-143），但按钮不会禁用
- 改为：`switchStatus('ENTERTAINMENT')` 前检查 `data.todayRevenue >= data.entertainmentThreshold`
- 不达标时按钮显示 `disabled` + Tooltip "今日流水 ¥{n}，达标 ¥{threshold} 后可切换"
- 新增配置 `revenue.entertainment_threshold`（默认 200 元）

**验证**：今日流水 ¥50 → 娱乐按钮置灰 → Tooltip 显示"还差 ¥150"→ 流水达标后自动启用

**文件**：2 | **工时**：0.5h

---

#### TASK-08 无客户时的升级路径

**需求**：陪玩确实没有客户时，可以申请解锁订单池，需上传沟通截图证明。

**开发**：
- `CompanionPage` 增加「申请解锁订单池」按钮（今日流水未达标时显示）
- 弹出 Modal：上传截图（微信聊天记录证明已尽力）+ 备注
- API：`POST /api/companions/me/proof-no-customer`（复用 upload 端点）
- 管理员审核：在 ReviewPage 或新 Tab 中审核 → 通过后该陪玩当日 `unlockThreshold` 临时降为 0
- 新增 `ProofReport` 表（如果通用，可扩展 `ExpenseReport` 增加 `type='NO_CUSTOMER_PROOF'`）

**验证**：陪玩上传截图 → 管理员通过 → 陪玩可以接订单池的订单

**文件**：3 | **工时**：1.5h

---

### 模块 4：客户获取闭环（2h）

#### TASK-09 CS 上传客户信息到订单池增强

**需求**：CS 从抖音/小红书等获取的客户信息，通过系统上传到订单池。

**开发**：
- `CreateOrderModal` 增加字段：客户微信号（必填）、YY号（选填）、KOOK号（选填）、房间码（选填）、来源平台（必填 Select）、来源账号（选填）
- 这些字段已在 `Order.customFields` 中部分支持（customerWechat/customerRoomCode/customerSource），需补全
- 订单池展示这些信息，陪玩接单后可直接看到

**验证**：CS 创建订单 → 填写客户微信号+来源"小红书"→ 订单池显示 💬微信号 📡小红书

**文件**：2 | **工时**：0.5h

---

#### TASK-10 陪玩→客户管理闭环

**需求**：陪玩接单后 → 系统自动创建客户记录 → 陪玩加微信 → 在 CRM 中维护跟进。

**开发**：
- 当前 `grab()` 已关联 `companionId` 到订单，但客户归属需要检查
- `orders.service.ts` `grab()` / `complete()` 成功后 → 如果客户 `companionId` 为空 → 自动赋值为当前陪玩
- `CompanionPage` 增加「我的待跟进客户」区块（最近 7 天未联系的客户列表）
- 点击客户 → 打开 `CustomerDetailPage` → 可添加跟进记录

**验证**：陪玩接单完成 → 客户自动归属该陪玩 → 客户列表可见 → 添加跟进记录

**文件**：2 | **工时**：1.5h

---

### 模块 5：双陪订单升级路径（1h）

#### TASK-11 双陪订单辅助请求

**需求**：陪玩没有自己的客户时，可以主动向其他陪玩请求参与双陪订单。

**开发**：
- `CompanionPage` 增加「请求双陪订单」按钮
- 点击后通过 WebSocket 广播 `order:dual-request { companionId, companionName }` 到工作室
- 其他陪玩收到后在工作台看到通知「xxx 请求参与双陪订单」
- 响应方点击「邀请」→ 自动创建双陪订单并呼叫搭档

**验证**：陪玩A点"请求双陪"→ 陪玩B收到通知 → 陪玩B点击邀请 → 自动创建双陪订单

**文件**：2 | **工时**：1h

---

### 模块 6：分成模式差异化（1.5h）

#### TASK-12 Studio 分账模式配置

**需求**：线下工作室=阶梯分成，线上俱乐部=固定比例（陪玩80%+工作室20%）。

**开发**：
- `Studio` 模型新增 `splitMode String @default("TIERED")`（TIERED/FIXED）
- `BillingService.runMonthlySettlement()` 中根据 `studio.splitMode` 选择计算逻辑：
  - TIERED：当前逻辑（0-6000/50%, 6000-10000/60%, >10000/70%）
  - FIXED：使用 `Companion.revenueShare`（默认 0.8）
- `StudiosPage.tsx` 创建/编辑工作室时增加分账模式选择

**验证**：创建线上俱乐部 → 选择固定分账 → 月结算时按 80/20 计算

**文件**：3 | **工时**：1h

---

#### TASK-13 分账比例可视化

**需求**：陪玩首页展示当前分账模式+本月预估收入。

**开发**：
- `CompanionPage` 钱包区域增加「分账模式」行
- 线下：显示"阶梯分成 · 当前档位 X/Y（本月流水 ¥{n}）"
- 线上：显示"固定分成 · {revenueShare*100}%"

**验证**：线下陪玩月流水 ¥8000 → 显示"阶梯分成 · 档位 60%（本月流水 ¥8000）"

**文件**：1 | **工时**：0.5h

---

### 模块 7：陪玩状态 6 态改造（10h）

**详见文档**：`COMPANION_STATUS_REDESIGN.md`（8 个 TASK / 19 文件 / 10h）

| TASK | 内容 |
|:--:|------|
| T14 | 枚举扩展：+WAITING, ONLINE→AVAILABLE, IDLE→ENTERTAINMENT |
| T15 | `CompanionStatusBlacklist` 表 + 每状态黑名单 |
| T16 | 服务端 5 处硬编码全量替换 + STATUS_COMPAT |
| T17 | 每状态黑名单 CRUD API |
| T18 | 休息自动关机（服务端+客户端双定时器） |

---

## 📊 总览

| 模块 | TASK 数 | 文件数 | 工时 |
|------|:--:|:--:|:--:|
| 1. 服务类型+游戏模式 | 2 | 6 | 1.5h |
| 2. 考勤系统 | 3 | 6 | 2.5h |
| 3. 开机→聊客户流程 | 3 | 7 | 3h |
| 4. 客户获取闭环 | 2 | 4 | 2h |
| 5. 双陪订单升级 | 1 | 2 | 1h |
| 6. 分成差异化 | 2 | 4 | 1.5h |
| 7. 6 态改造 | 5 | 19 | 10h |
| **合计** | **18** | **48** | **21.5h（3 人天）** |

### 实施顺序

```
Phase 1 (基础):  模块1+2 — 服务类型/考勤（无依赖，可立即开始）
Phase 2 (核心):  模块3+7 — 流程管控+6态改造（依赖基础枚举）
Phase 3 (增强):  模块4+5+6 — 客户闭环/双陪/分账（依赖核心流程）
```

> 📝 含 5 个决策点推荐方案（A/B 选项），每项 TASK 含需求+开发+验证三部分。
