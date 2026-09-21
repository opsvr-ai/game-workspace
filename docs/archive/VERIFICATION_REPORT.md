# 需求 vs 代码核查报告 — 第三次核对

> 📅 2026-07-05 | 35 文件 / 1263 行变更 | 2 个 commit

---

## 总览：11/18 完成 (61%)

| 状态 | 数量 |
|:--:|:--:|
| ✅ | **11** |
| ❌ | **7** |

---

## ✅ 已完成（11）

| TASK | 内容 | 验证 |
|:--:|------|------|
| T01 | ServiceType 枚举 | `enums.ts` L53-57: PLAY_WITH/ESCORT/DO_TASK |
| T03 | Attendance 表 | `schema.prisma` 新增 `CompanionAttendance` |
| T04 | 考勤自动记录 | `ws.gateway.ts` handleConnection/handleDisconnect 含 attendance 逻辑 |
| T05 | 考勤管理页面 | `AttendancePage.tsx` 177 行：RangePicker+陪玩筛选+迟到红色高亮 |
| T10 | 客户自动归属 | `orders.service.ts` grab/complete 自动赋值 `customer.companionId` |
| T12 | Studio 分账模式 | `schema.prisma` Studio 新增 `splitMode` 字段；`billing.service.ts` 按模式结算 |
| T14 | 枚举扩展 | `CompanionStatus` 6 状态含 WAITING |
| T15 | StatusBlacklist 表 | `CompanionStatusBlacklist` @unique 约束 |
| T16 | 服务端状态替换 | STATUS_COMPAT + AVAILABLE + handleStatusChange |
| T17 | 每状态黑名单配置 | `StatusBlacklistConfigModal.tsx` 228 行完整 CRUD 弹窗 |
| T18 | 休息自动关机 | `resting-monitor.service.ts` + controller 集成 |

---

## ❌ 未完成（7）

### T02 新增游戏模式字段

**需求**：订单支持选择「机密」「绝密」等游戏模式。

**优化**：`SystemConfig` 预置 `game.modes` JSON 配置；`CreateOrderModal.tsx` 增加游戏模式 Select 下拉（与游戏联动）。

**验证**：选游戏"三角洲行动" → 游戏模式下拉出现"机密/绝密"→ 订单卡片显示模式 Tag

---

### T06 开机引导弹窗

**需求**：Agent 登录后弹出引导"请优先联系私域客户"。

**优化**：Electron `main.ts` 登录后 `mainWindow.webContents.send('nav:bootGuide')` → `WorkbenchPage.tsx` 弹 Modal 含"去客户管理"按钮。

**验证**：登录 Electron → 弹出引导 → 点击跳转客户列表

---

### T07 娱乐模式按钮根据达标状态置灰

**需求**：今日流水不达标时娱乐按钮 disabled + Tooltip 显示差额。当前后端已有门槛检查（controller L186-198），但前端未联动。

**优化**：`CompanionPage.tsx` L157 娱乐按钮改：
```tsx
<Button disabled={!data.isEntertainmentUnlocked}
  onClick={() => switchStatus('ENTERTAINMENT')}>
  切换为娱乐中{!data.isEntertainmentUnlocked && ` (还差¥${gap})`}
</Button>
```

**验证**：流水不足 → 按钮灰显 + Tooltip → 达标后自动启用

---

### T08 无客户时上传凭证

**需求**：陪玩无客户时可上传沟通截图 → 管理员审核 → 解锁订单池。

**优化**：`CompanionPage` 增加「申请解锁」按钮 → Modal 上传截图 → `POST /api/companions/me/proof-no-customer` → 管理员审核。

**验证**：陪玩上传截图 → 管理员通过 → 可接订单池订单

---

### T09 CS 上传客户信息增强

**需求**：CreateOrderModal 增加 YY号/KOOK号/来源平台/来源账号字段。

**优化**：表单增加选填字段 → `Order.customFields` 扩展。

**验证**：CS 创建订单 → 填写完整客户信息 → 订单池卡片显示完整

---

### T11 双陪订单辅助请求

**需求**：陪玩无客户时可向其他陪玩请求参与双陪订单。

**优化**：`CompanionPage` 增加「请求双陪」按钮 → WS `order:dual-request` → 广播工作室 → 其他陪玩可响应。

**验证**：陪玩A请求 → 陪玩B收到通知 → B接受 → 自动创建双陪订单

---

### T13 分账可视化

**需求**：陪玩首页展示当前分账模式+预估收入。

**优化**：`CompanionPage` 钱包区域增加分账模式行：线下→阶梯·当前档位、线上→固定%比例。

**验证**：线下陪玩月流水 ¥8000 → 显示"阶梯分成·60%档位"；线上陪玩 → 显示"固定分成·80%"

---

## 📊 进展对比

| 核对次数 | 完成 | 增量 |
|:--:|:--:|:--:|
| 第一次 | 5 | — |
| 第二次 | 5 | 0 |
| 第三次 | **11** | +6 |

新增完成的 6 项：T01 ServiceType、T03-05 考勤全链路、T10 客户归属、T12 分账模式、T17 配置弹窗
