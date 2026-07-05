# 黑名单进程管理 — 功能优化 TASK 清单

> 📅 2026-07-05 | 📊 共 15 个 TASK | 🔴P0:5 🟡P1:6 🟢P2:4

---

## 🔴 P0 — 严重影响功能正确性，必须立即修复

### TASK-01：修复弹窗「关闭提示」= 必杀的逻辑

**问题**：`blacklist-notification.ts:86` 监听 `notificationWindow.on('closed')`，无论用户点击「立即关闭」还是「× 关闭提示」，窗口关闭后都无条件执行 `onKillNow()`，用户失去「不杀」的选择权。

**涉及文件**：
- `apps/companion-electron/electron/blacklist-notification.ts`

**优化方案**：
1. 增加一个 `cancelled` 状态标记
2. 「× 关闭提示」按钮点击时设置 `cancelled = true`，`on('closed')` 中检查此标记
3. 「⚡ 立即关闭」按钮和倒计时归零时，正常触发 `onKillNow()`
4. 倒计时到自动关闭时也触发 kill（设计意图）

**预估工时**：1h

---

### TASK-02：修复杀进程失败仍显示成功 toast

**问题**：`main.ts:252-253` 中 `showKilledToast(process.name)` 在 `await killProcess(process)` 之后无条件执行，不检查 `result.success`。

**涉及文件**：
- `apps/companion-electron/electron/main.ts`（约 L248-258 的 `onKill` 回调）

**优化方案**：
```ts
const result = await killProcess(process);
if (result.success) {
  showKilledToast(process.name);
} else {
  // 仅在失败时静默——避免误导用户
  logger.warn('Kill failed silently', { processName: process.name, reason: result.resultText });
}
emitKillResult(result);
```

**预估工时**：30min

---

### TASK-03：修复 PowerShell JSON 解析失败不回退 tasklist

**问题**：`process-monitor.ts:121-124` 的 catch 块直接 `resolve([])`，当 PowerShell 运行正常但 `Get-Process` 输出 JSON 解析失败时（如进程名含特殊字符），不 fallback 到 tasklist 导致静默失败。

**涉及文件**：
- `apps/companion-electron/electron/process-monitor.ts`（`collectProcesses` 函数的 catch 块）

**优化方案**：catch 块中调用 tasklist fallback：
```ts
} catch (e: any) {
  logger.warn('[ProcessCollect] PowerShell output parse failed, falling back to tasklist', { error: e.message });
  exec('tasklist /FO CSV /NH', { timeout: 10000 }, (err2, out2) => {
    if (err2) { resolve([]); return; }
    resolve(parseTasklist(out2));
  });
}
```

**预估工时**：30min

---

### TASK-04：实现循环杀防护

**问题**：陪玩反复启动被杀进程，每次都被再次检测到并再次弹窗杀进程，形成无限弹窗循环。设计文档要求「3次/5分钟阈值 → 停止自动杀 + 告警管理员」。

**涉及文件**：
- `apps/companion-electron/electron/process-monitor.ts`（`killHistory` 扩展）
- `apps/server/src/process-blacklist/process-blacklist.service.ts`（告警逻辑）

**优化方案**：
1. Electron 端：扩展 `killHistory` 为 `Map<processName, { count: number; firstKill: number }>`
2. 5 分钟内同一进程名被杀超过 3 次 → 停止自动杀该进程 → 上报 `REPEAT_KILL_ALERT` 事件
3. 服务端：收到告警后记录到 ProcessKillLog（`result = 'RATE_LIMITED'`），通过 WebSocket 通知管理端

**预估工时**：3h

---

### TASK-05：统一 API 前缀为 `/api/processes`

**问题**：当前三套前缀混用——`/api/blacklist`、`/api/whitelist`、`/api/processes`。Electron 端上报路径 `/api/processes/reports` 与黑名单 CRUD 的 `/api/blacklist` 分离，维护混乱。

**涉及文件**：
- `apps/server/src/process-blacklist/process-blacklist.controller.ts`（全部路由前缀）
- `apps/web/src/api/blacklist.ts`（前端 API 调用路径）
- `apps/companion-electron/electron/main.ts`（上报 URL）

**优化方案**：统一为以下结构：
```
GET    /api/processes/blacklist          # 黑名单列表
POST   /api/processes/blacklist          # 添加黑名单
PUT    /api/processes/blacklist/:id      # 更新
DELETE /api/processes/blacklist/:id      # 删除
POST   /api/processes/blacklist/push     # 下发

GET    /api/processes/whitelist          # 白名单列表
POST   /api/processes/whitelist          # 添加
DELETE /api/processes/whitelist/:id      # 删除

POST   /api/processes/reports            # 进程上报
GET    /api/processes/reports            # 查询上报
GET    /api/processes/unique-names       # 唯一进程名
GET    /api/processes/kill-logs          # 杀进程日志
GET    /api/processes/my-rules           # 陪玩查自己规则
```

**预估工时**：2h

---

## 🟡 P1 — 影响体验完整度，应该尽快实现

### TASK-06：ProcessKillLogPage 增加 resultText 列

**问题**：`ProcessKillLog` 表已存了 `resultText`（失败原因），但前端页面不展示，失败时只能看到红色「失败」Tag，无法排查原因。

**涉及文件**：
- `apps/web/src/pages/admin/ProcessKillLogPage.tsx`

**优化方案**：Table 增加 `resultText` 列，失败时显示 Tooltip 悬停查看详情。

**预估工时**：30min

---

### TASK-07：ProcessKillLog 表增加 operatorId 字段

**问题**：杀进程日志无法追溯操作者——是系统周期性检测触发还是管理员手动触发？触发的管理员是谁？

**涉及文件**：
- `apps/server/prisma/schema.prisma`（`ProcessKillLog` 模型）
- `apps/server/src/process-blacklist/process-blacklist.service.ts`（`logKill` 方法）

**优化方案**：
1. `ProcessKillLog` 增加 `operatorId String?` 字段
2. 手动杀进程时传入 `req.user.id`
3. 周期性检测触发时 `operatorId = null`
4. 前端展示列区分「系统自动」vs「{操作者}手动」

**预估工时**：1h

---

### TASK-08：批量添加改为 Promise.all 并发

**问题**：`BlacklistPage.tsx:60` 使用 `for (const name of names) await` 逐个串行调 API，添加 10 个进程需 10 次网络往返。

**涉及文件**：
- `apps/web/src/pages/admin/BlacklistPage.tsx`（`handleAdd` 方法）
- `apps/web/src/pages/admin/WhitelistPage.tsx`（同）

**优化方案**：
```ts
await Promise.all(names.map(name =>
  blacklistApi.add({ processName: name, processPath: ... })
));
```

**预估工时**：15min

---

### TASK-09：kill result 增加 REST fallback

**问题**：当前杀进程结果仅通过 WebSocket `blacklist:kill_result` 上报，WS 断连时日志丢失。

**涉及文件**：
- `apps/companion-electron/electron/main.ts`（`emitKillResult` 调用处）
- `apps/server/src/process-blacklist/process-blacklist.controller.ts`（新增接收端点）

**优化方案**：`emitKillResult` 内部同时尝试 REST POST `/api/processes/kill-logs`，WS 失败时 REST 兜底。

**预估工时**：1h

---

### TASK-10：explorer.exe 加入 OS 进程过滤列表

**问题**：`OS_PROCESS_PATTERNS` 未包含 `explorer.exe`，极端情况下桌面 Shell 可被意外终止导致任务栏消失。

**涉及文件**：
- `apps/companion-electron/electron/process-monitor.ts`（`OS_PROCESS_PATTERNS` 数组）

**优化方案**：增加 ` /^explorer\.exe$/i` 到过滤列表。

**预估工时**：5min

---

### TASK-11：调整 30s 重检间隔为可配置

**问题**：每 30s 一次全量进程采集（PowerShell `Get-Process | ConvertTo-Json`），游戏场景可能引起卡顿。应支持上调至 60-120s 或通过配置调整。

**涉及文件**：
- `apps/companion-electron/electron/process-monitor.ts`（`recheckInterval` 硬编码）
- `apps/companion-electron/electron/config.ts`（新增配置项）

**优化方案**：
1. 新增 `processCheckIntervalSec` 配置项（默认 60s）
2. 替换硬编码的 `30 * 1000` 为配置值
3. `runBlacklistCheck` 增加轻量模式：仅检测进程列表变化（增量），无变化则跳过完整过滤

**预估工时**：1.5h

---

## 🟢 P2 — 增强功能，远期迭代

### TASK-12：实现 .lnk 拖拽添加到黑名单

**问题**：设计文档要求支持拖拽桌面快捷方式添加，当前替代方案（智能进程选择器）操作路径更长。

**涉及文件**：
- `apps/web/src/pages/admin/BlacklistPage.tsx`（新增 DropZone 组件）
- `apps/web/src/api/blacklist.ts`（新增解析端点）

**优化方案**：
1. 管理端页面增加 DropZone 区域（HTML5 Drag & Drop + FileReader）
2. 拖入 .lnk 文件 → 前端提取文件名（如 `LOL.lnk` → 推测进程名 `LOL.exe`）
3. 在 Agent 已上报进程列表中模糊匹配 → 匹配成功自动填充
4. 匹配失败则提示手动输入并标记「待确认」

**预估工时**：4h

---

### TASK-13：CS 端 DispatchPage 集成进程异常标识

**问题**：设计文档要求 CS 在派单面板看到陪玩进程异常标识（⚠️），当前未实现。

**涉及文件**：
- `apps/web/src/pages/DispatchPage.tsx`（CSView 陪玩列表）
- `apps/server/src/companions/companions.service.ts`（返回 processStatus 字段）

**优化方案**：
1. Companion 查询增加 `processStatus` 字段（从最近的 `ProcessKillLog` + `CompanionProcessReport` 推导）
2. CS 端 DispatchPage 陪玩列表增加 ⚠️ 标识（`NORMAL`/`WARNING`/`BLOCKED`）
3. `BLOCKED` 状态的陪玩不可选为派单对象

**预估工时**：3h

---

### TASK-14：扩展 WeChat 白名单为多子进程覆盖

**问题**：当前 `BUILTIN_WHITELIST` 仅包含 `WeChat.exe`，微信有多个子进程（`WeChatApp.exe`、`WeChatPlayer.exe`、`WeChatBrowser.exe` 等），可能被误杀。

**涉及文件**：
- `apps/server/src/process-blacklist/constants.ts`

**优化方案**：增加 `WeChatApp.exe`、`WeChatPlayer.exe`、`WeChatBrowser.exe` 到内置白名单。

**预估工时**：5min

---

### TASK-15：实现手动远程杀进程

**问题**：设计文档设计了 `POST /api/processes/kill` 端点，允许管理员从管理端手动触发指定陪玩的指定进程杀死，当前未实现。

**涉及文件**：
- `apps/server/src/process-blacklist/process-blacklist.controller.ts`（新增 `kill` 端点）
- `apps/server/src/ws/ws.gateway.ts`（新增 `sendKillCommand` 方法）
- `apps/web/src/pages/admin/BlacklistPage.tsx`（或新增入口）

**优化方案**：
1. 管理端进程列表增加「手动杀进程」按钮
2. POST `/api/processes/kill { companionId, processName, processId? }`
3. Server → Agent WebSocket `pc:kill_process` 事件
4. Agent 收到后执行 `taskkill /F /PID` 并上报结果

**预估工时**：3h

---

## 📊 总工时评估

| 优先级 | TASK 数 | 预估总工时 |
|:--:|:--:|:--:|
| 🔴 P0 | 5 | **7h** |
| 🟡 P1 | 6 | **4.5h** |
| 🟢 P2 | 4 | **10.5h** |
| **合计** | **15** | **22h（约 3 人天）** |

---

> 📝 本文档基于 3 角色子智能体并行代码审查综合生成。  
> 🔗 [代码审查报告](CODE_REVIEW_OPTIMIZATION.md) | [设计说明书](PROCESS_BLACKLIST_DESIGN.md)
