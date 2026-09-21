# 陪玩状态体系改造 — 开发 TASK 清单

> 🎯 目标：5→6 状态体系 + 每状态自定义黑名单 + 休息 1 小时自动关机  
> 📁 影响：19 文件 | ⏱ 总工时：9h

---

## Phase 1：共享层 + 数据库（1.5h）

### TASK-01 扩展 CompanionStatus 枚举

**需求说明**：将 5 种状态扩展为 6 种。新增"等单"状态（陪玩主动在订单池等待），重命名 ONLINE→AVAILABLE、IDLE→ENTERTAINMENT。新旧映射：ONLINE→AVAILABLE(空闲)、IDLE→ENTERTAINMENT(娱乐)。

**开发说明**：

`packages/shared/src/enums.ts`：
```ts
export enum CompanionStatus {
  AVAILABLE = 'AVAILABLE',       // ① 空闲（原 ONLINE）
  WAITING = 'WAITING',           // ② 等单（新增）
  BUSY = 'BUSY',                 // ③ 接单
  ENTERTAINMENT = 'ENTERTAINMENT', // ④ 娱乐（原 IDLE）
  RESTING = 'RESTING',           // ⑤ 休息
  OFFLINE = 'OFFLINE',           // ⑥ 离线
}
```

执行 `pnpm build:shared`。

**验证方式**：`packages/shared/dist/enums.js` 中确认 `CompanionStatus` 包含 6 个值。所有 `import { CompanionStatus } from '@chunlv/shared'` 的文件编译无类型错误。

**文件**：1 | **工时**：0.5h

---

### TASK-02 新增每状态黑名单配置表

**需求说明**：管理端（OWNER/ADMIN/CS）可为每个陪玩的每个状态配置不同的黑名单进程。例如：陪玩张三在"娱乐"状态下抖音和 bilibili 被禁，但切换到"接单"状态后不受限制。

**开发说明**：

`apps/server/prisma/schema.prisma` 新增：
```prisma
model CompanionStatusBlacklist {
  id          String   @id @default(uuid())
  companionId String
  status      String   // AVAILABLE | WAITING | BUSY | ENTERTAINMENT | RESTING
  processName String
  createdAt   DateTime @default(now())

  companion   Companion @relation(fields: [companionId], references: [id])
  @@unique([companionId, status, processName])
  @@index([companionId, status])
}
```

Companion 模型新增关系：
```prisma
model Companion {
  // ...已有字段...
  statusBlacklists CompanionStatusBlacklist[]
}
```

执行 `pnpm db:migrate`。

**验证方式**：数据库中出现 `CompanionStatusBlacklist` 表，包含 `companionId+status+processName` 联合唯一约束。

**文件**：1 | **工时**：1h

---

## Phase 2：服务端（2.5h）

### TASK-03 服务端状态值全量替换

**需求说明**：服务端所有硬编码的状态字符串（'ONLINE'/'IDLE'）替换为新枚举值，并增加 STATUS_COMPAT 兼容映射让旧版客户端正常工作。

**开发说明**：

**① ws.gateway.ts**：
```
L79:  status: 'ONLINE'  →  'AVAILABLE'
L130: handleStatusChange 开头增加兼容映射：
   const STATUS_COMPAT = { 'ONLINE': 'AVAILABLE', 'IDLE': 'ENTERTAINMENT' };
   data.status = STATUS_COMPAT[data.status] || data.status;
```

**② companions.controller.ts**：
```
L184, L210:   status === 'IDLE'  →  status === 'ENTERTAINMENT'
L278-281:     status: 'OFFLINE' 时设为 'AVAILABLE'（OFFLINE→AVAILABLE 是心跳恢复逻辑）
L326, L331:   'ONLINE'  →  'AVAILABLE'
```

**③ companions.service.ts L143**：
```ts
// 旧
status: { in: ['ONLINE', 'BUSY', 'IDLE'] }
// 新
status: { in: ['AVAILABLE', 'WAITING', 'BUSY', 'ENTERTAINMENT'] }
```

**④ dashboard.service.ts L34**：
```ts
// 旧
c.status === 'ONLINE' || c.status === 'BUSY' || c.status === 'IDLE'
// 新
['AVAILABLE', 'WAITING', 'BUSY', 'ENTERTAINMENT'].includes(c.status)
```

**验证方式**：
- 旧版 Electron 发送 `companion:status { status:'ONLINE' }` → 服务端自动转为 AVAILABLE
- `GET /api/dashboard/companions` 返回中在线陪玩包含 AVAILABLE/WAITING/BUSY/ENTERTAINMENT 四种
- RESTING 和 OFFLINE 不计入在线

**文件**：4 | **工时**：1h

---

### TASK-04 每状态黑名单 CRUD API

**需求说明**：提供 REST API 让管理端读写每个陪玩每个状态的专属黑名单。

**开发说明**：

`companions.service.ts` 新增：
```ts
async getStatusBlacklist(companionId: string, status: string) {
  return this.prisma.companionStatusBlacklist.findMany({
    where: { companionId, status },
  });
}

async addStatusBlacklist(companionId: string, status: string, processName: string) {
  return this.prisma.companionStatusBlacklist.create({
    data: { companionId, status, processName },
  });
}

async removeStatusBlacklist(id: string) {
  return this.prisma.companionStatusBlacklist.delete({ where: { id } });
}
```

`companions.controller.ts` 新增：
```ts
@Get('companions/:id/status-blacklist')
@Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
async getStatusBlacklist(@Param('id') id: string, @Query('status') status: string) { ... }

@Post('companions/:id/status-blacklist')
@Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
async addStatusBlacklist(@Param('id') id: string, @Body() dto: { status: string; processName: string }) { ... }

@Delete('companions/:id/status-blacklist/:entryId')
@Roles(UserRole.ADMIN, UserRole.OWNER, UserRole.CS)
async removeStatusBlacklist(@Param('entryId') entryId: string) { ... }
```

**修改 process-blacklist.service.ts `getEffectiveBlacklist()`**：合并工作室全局黑名单 + CompanionBlacklistOverride + **CompanionStatusBlacklist(当前状态)**，状态级黑名单优先级最高。

**验证方式**：
```
POST /api/companions/{cid}/status-blacklist  { status:'ENTERTAINMENT', processName:'bilibili.exe' }
GET  /api/companions/{cid}/status-blacklist?status=ENTERTAINMENT
→ [{ processName:'bilibili.exe' }]

陪玩切换到 ENTERTAINMENT → Agent 拉取黑名单 → 包含 bilibili.exe
陪玩切换到 BUSY → Agent 拉取黑名单 → 不包含 bilibili.exe
```

**文件**：3 | **工时**：1.5h

---

### TASK-05 休息状态自动关机定时器

**需求说明**：陪玩切换到"休息"后，如果 1 小时内未切走，系统自动发出关机命令。

**开发说明**：

新建 `apps/server/src/companions/resting-monitor.service.ts`：
```ts
@Injectable()
export class RestingMonitorService {
  private restingTimers = new Map<string, NodeJS.Timeout>();

  startResting(companionId: string): void {
    this.clearTimer(companionId);
    const timer = setTimeout(async () => {
      const companion = await this.prisma.companion.findUnique({
        where: { id: companionId }, select: { status: true },
      });
      // 双重检查：确认 1 小时后仍是 RESTING
      if (companion?.status === 'RESTING') {
        this.wsGateway.sendCommand(companionId, 'shutdown');
        logger.info('Resting auto-shutdown triggered', { companionId });
      }
    }, 60 * 60 * 1000);
    this.restingTimers.set(companionId, timer);
  }

  clearTimer(companionId: string): void {
    const t = this.restingTimers.get(companionId);
    if (t) { clearTimeout(t); this.restingTimers.delete(companionId); }
  }
}
```

`companions.controller.ts` 中 `updateStatus` 端点增加：状态变更为 RESTING 时调用 `startResting()`，变更为其他状态时调用 `clearTimer()`。

**验证方式**：
- 切到休息 → 日志显示 `Resting timer started` → 1 小时内切走 → 日志显示 `Resting timer cleared`
- 切到休息 → 等待 1h → 日志显示 `Resting auto-shutdown triggered` → Agent 收到 `pc:command { command:'shutdown' }`

**文件**：2（新建 1 + 修改 1）| **工时**：1h

---

## Phase 3：Web 前端（3h）

### TASK-06 前端常量 + 页面状态枚举全量替换

**需求说明**：所有引用旧枚举值（CompanionStatus.ONLINE/CompanionStatus.IDLE）的前端代码替换为新枚举，新增 WAITING 状态的展示。

**开发说明**：

**① `constants/companions.ts`**：
```ts
export const companionStatusConfig = {
  AVAILABLE:     { color: 'green',  label: '空闲' },
  WAITING:       { color: 'cyan',   label: '等单' },    // 新增
  BUSY:          { color: 'red',    label: '接单中' },
  ENTERTAINMENT: { color: 'gold',   label: '娱乐中' },
  RESTING:       { color: 'orange', label: '休息中' },
  OFFLINE:       { color: 'default',label: '离线' },
};

export const STATUS_SORT = {
  AVAILABLE: 0, WAITING: 1, BUSY: 2, ENTERTAINMENT: 3, RESTING: 4, OFFLINE: 5,
};
```

**② `DispatchPage.tsx`**：
- L199-203：统计增加 `waitingCount`，六行统计改为六行
- L293：光环颜色更新：`BUSY→#FF4757, ENTERTAINMENT→#00E676, AVAILABLE→#FFD600, WAITING→#00D4FF`
- L450-456：详情弹窗颜色同上
- 所有 `CompanionStatus.ONLINE` → `CompanionStatus.AVAILABLE`
- 所有 `CompanionStatus.IDLE` → `CompanionStatus.ENTERTAINMENT`

**③ `CompanionPage.tsx` L168-172**：按钮从 3 个改为 5 个：
```tsx
<Button onClick={() => switchStatus('AVAILABLE')}>切换为空闲</Button>
<Button onClick={() => switchStatus('WAITING')}>切换为等单</Button>
<Button onClick={() => switchStatus('BUSY')}>切换为接单</Button>
<Button onClick={() => switchStatus('ENTERTAINMENT')}>切换为娱乐</Button>
<Button onClick={() => switchStatus('RESTING')}>切换为休息</Button>
```

**④ `CompanionsPage.tsx` L242**：Tag 直接用 `companionStatusConfig[status]?.label`

**⑤ `PcControlPage.tsx` L153**：同上

**验证方式**：
- 登录 CS → DispatchPage 左侧陪玩列表显示 6 种状态标签颜色正确
- 登录 COMPANION → 首页显示 5 个切换按钮，点击"切换为等单"→ 状态变 WAITING
- 管理端 PcControlPage 陪玩状态列显示中文标签与颜色匹配

**文件**：5 | **工时**：2h

---

### TASK-07 每状态黑名单配置弹窗

**需求说明**：管理端在 BlacklistPage 或 CompanionPage 内增加入口，可以为每个陪玩的每个状态配置专属黑名单。

**开发说明**：

新建 `apps/web/src/components/StatusBlacklistConfigModal.tsx`：
- 左侧 Select 选陪玩 → 中间 Select 选状态（空闲/等单/接单/娱乐/休息）
- 右侧 Table 显示该陪玩该状态的黑名单列表
- 底部 + 添加按钮（调用 `POST /api/companions/:id/status-blacklist`）
- 删除按钮（调用 `DELETE /api/companions/:id/status-blacklist/:entryId`）

在 `BlacklistPage.tsx` 增加「状态黑名单」Tab 或按钮入口跳转。

**验证方式**：
- 选陪玩"张三" → 选状态"娱乐" → 添加 bilibili.exe → 表格显示一行
- 选状态"接单" → 表格为空（因为未配置）
- 删除"娱乐"状态的 bilibili.exe → 表格行消失

**文件**：2（新建 1 + 修改 1）| **工时**：1h

---

## Phase 4：Electron 客户端（2h）

### TASK-08 Electron 状态枚举适配 + 休息倒计时

**需求说明**：客户端适配 6 种状态，切换到休息时显示倒计时，1 小时到期自动关机。

**开发说明**：

**① `main.ts` L93**：硬编码 `'ONLINE'` → `'AVAILABLE'`：
```ts
body: { status: 'AVAILABLE' },
```

**② `main.ts` 新增休息定时器逻辑**：
```ts
let restingTimer: NodeJS.Timeout | null = null;

ipcMain.on('status:changed', (_e, status: string) => {
  if (status === 'RESTING') {
    restingTimer = setTimeout(() => {
      exec('shutdown /s /t 60');  // 60秒缓冲
    }, 60 * 60 * 1000);
  } else {
    if (restingTimer) { clearTimeout(restingTimer); restingTimer = null; }
  }
  // ... 原有 emitStatus 逻辑
});
```

**③ `tray.ts`**：Tooltip 中状态标签从新枚举映射中文（可用常量表）。

**④ `preload.ts` + `types/electron.d.ts`**：确认 `onStatusChanged(status: string)` 类型不变。

**⑤ `WorkbenchPage.tsx`**：状态切换 UI 从 3 按钮改为 5 按钮，标签与 Web 版一致。

**验证方式**：
- 登录 Electron → 点"切换为等单" → 托盘 Tooltip 显示"等单"
- 点"切换为休息" → 托盘 Tooltip 显示"休息中·59:59 后关机"
- 1 小时内点"切换为空闲" → 关机取消
- 等 1 小时 → `shutdown /s /t 60` 执行 → 系统弹窗"Windows 将在 1 分钟后关闭"

**文件**：5 | **工时**：2h

---

## 📊 总览

| Phase | 任务 | 文件数 | 工时 |
|:--:|------|:--:|:--:|
| 1 | T01 枚举 + T02 数据库 | 2 | 1.5h |
| 2 | T03 替换 + T04 CRUD + T05 关机 | 9 | 3.5h |
| 3 | T06 前端替换 + T07 配置弹窗 | 7 | 3h |
| 4 | T08 Electron 适配 | 5 | 2h |
| **合计** | **8 个 TASK** | **19** | **10h** |

### 执行顺序

```
T01 → T02 → T03+T04+T05 并行 → T06+T07+T08 并行
```

### 迁移脚本（部署时执行）

```sql
UPDATE "Companion" SET "status" = 'AVAILABLE' WHERE "status" = 'ONLINE';
UPDATE "Companion" SET "status" = 'ENTERTAINMENT' WHERE "status" = 'IDLE';
```

> 📝 每项 TASK 含需求说明、开发说明（含代码）、验证方式三部分。
