# 剩余优化任务清单（4 项）

> 📅 2026-07-05 | 🔴 P0×3 🟢 P2×1 | 总工时约 6h

---

## TASK-03 🔴 修复 PowerShell JSON 解析失败不回退 tasklist

### 问题点

**文件**：`apps/companion-electron/electron/process-monitor.ts` 第 122-125 行

```ts
} catch (e: any) {
  logger.error('[ProcessCollect] Failed to parse PowerShell output', { error: e.message });
  resolve([]);  // ← BUG: 静默返回空数组
}
```

当以下场景发生时，进程采集**静默失败**，Agent 上报空进程列表：
- 某进程名包含特殊字符（如 `{` `}` `[` `]`），PowerShell `ConvertTo-Json` 输出在 JSON.parse 时抛异常
- `Get-Process` 返回了非标准格式数据
- PowerShell 运行正常但输出解析失败

**后果**：管理端看到的进程列表为空，以为陪玩终端一切正常，实际上黑名单进程仍在运行。

### 优化建议

在 catch 块中回退到 `tasklist /FO CSV /NH` 解析：

```ts
} catch (e: any) {
  logger.warn('[ProcessCollect] PowerShell JSON parse failed, falling back to tasklist',
    { error: e.message });
  exec('tasklist /FO CSV /NH', { timeout: 10000 }, (err2, out2) => {
    if (err2) {
      logger.error('[ProcessCollect] tasklist fallback also failed', { error: err2.message });
      resolve([]);
      return;
    }
    const result = parseTasklist(out2);
    logger.info('[ProcessCollect] Collection complete via tasklist fallback', {
      method: 'tasklist-fallback',
      count: result.length,
      reason: 'powershell-json-parse-error',
    });
    resolve(result);
  });
}
```

### 验证方式

1. **单元验证**：模拟一段含特殊字符的 PowerShell JSON 输出（如进程名含 `{`），确认 `JSON.parse` 抛异常后进入 catch 分支并执行 tasklist
2. **集成验证**：在测试机上运行一个进程名为 `test{app}.exe` 的程序，观察 Electron 日志是否出现 `Collection complete via tasklist fallback` 字样
3. **回归验证**：正常场景（PowerShell 成功）不应受影响，日志仍为 `Collection complete via PowerShell`

### 预期效果

- 任何场景下 Agent 都不会静默上报空进程列表
- 日志清晰区分 `powershell` / `tasklist` / `tasklist-fallback` 三种采集路径
- 管理员看到的进程列表始终包含陪玩终端真实运行的进程

**预估工时**：30min

---

## TASK-04 🔴 实现循环杀防护

### 问题点

**文件**：`apps/companion-electron/electron/process-monitor.ts`

当前逻辑：每 60s 重检 → 发现黑名单进程 → `onKillCallback(hit)` → 弹窗 → 杀进程。

**缺陷**：陪玩反复启动同一个被杀进程（如双击桌面的 LOL 快捷方式），每次都会触发弹窗+杀进程，形成**无限弹窗循环**：
```
弹窗(5s倒计时) → 杀LOL.exe → 陪玩重开LOL → 60s后重检 → 又弹窗(5s) → 又杀 → 循环
```

**后果**：陪玩体验极差（弹窗不断），且无法产生有效告警让管理员感知「某个陪玩在反复尝试启动违禁进程」。

### 优化建议

在 `process-monitor.ts` 中扩展 `killHistory` 为结构化计数器：

**Step 1：新增循环杀追踪结构**

```ts
// 替换现有的 killHistory: number[]
interface KillCounter {
  count: number;      // 被杀次数
  firstKillAt: number; // 首次被杀时间戳
  lastKillAt: number;  // 最近被杀时间戳
}
const killCounters = new Map<string, KillCounter>();

const CYCLE_THRESHOLD = 3;       // 5分钟内超3次触发告警
const CYCLE_WINDOW_MS = 5 * 60 * 1000;
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 告警后30分钟内不再自动杀
```

**Step 2：在 `onKillCallback` 调用前插入检查**

```ts
// runBlacklistCheck() 和 runReportCycle() 中，for (const hit of hits) 之前

for (const hit of hits) {
  const counter = killCounters.get(hit.name.toLowerCase()) || { count: 0, firstKillAt: 0, lastKillAt: 0 };
  
  // 如果在阻塞期内（30分钟），跳过该进程
  if (counter.lastKillAt > 0 && (Date.now() - counter.lastKillAt) < BLOCK_DURATION_MS) {
    logger.warn('[ProcessMonitor] Kill blocked — in cooldown period', {
      processName: hit.name,
      lastKillAt: new Date(counter.lastKillAt).toISOString(),
    });
    continue;
  }
  
  // 更新计数
  const now = Date.now();
  if (now - counter.firstKillAt > CYCLE_WINDOW_MS) {
    // 窗口过期，重置计数
    counter.count = 1;
    counter.firstKillAt = now;
  } else {
    counter.count++;
  }
  counter.lastKillAt = now;
  killCounters.set(hit.name.toLowerCase(), counter);
  
  // 超阈值 → 停止自动杀 + 上报告警
  if (counter.count >= CYCLE_THRESHOLD) {
    logger.error('[ProcessMonitor] REPEAT_KILL_ALERT — cycle kill detected', {
      processName: hit.name,
      killCount: counter.count,
      windowMinutes: CYCLE_WINDOW_MS / 60000,
    });
    // 通过 WS 或 REST 上报告警
    emitRepeatKillAlert(hit.name, counter.count);
    continue; // 跳过本次 kill
  }
  
  onKillCallback?.(hit);
}
```

**Step 3：新增告警上报函数**

```ts
function emitRepeatKillAlert(processName: string, count: number): void {
  // WebSocket 优先
  if (isWsConnected()) {
    wsEmit('blacklist:repeat_kill_alert', { processName, killCount: count });
  }
  // REST 兜底
  const token = store.get('token') as string;
  httpRequest({
    method: 'POST',
    url: `${getServerUrl()}/api/processes/repeat-kill-alert`,
    headers: { Authorization: *** ${token}` },
    body: { processName, killCount: count },
  }).catch(() => {});
}
```

### 验证方式

1. **单元验证**：构造 `killCounters` Map，模拟 5 分钟内 4 次同进程名触发 → 确认第 4 次被跳过
2. **集成验证**：在测试机上反复启动同一个黑名单进程 3 次 → 确认第 4 次不再弹窗 → 确认管理端收到 `REPEAT_KILL_ALERT` 告警
3. **时效验证**：等待 5 分钟窗口过期后 → 确认计数器重置 → 再次启动可以正常杀

### 预期效果

- 同一进程 5 分钟内被检测到超过 3 次 → 停止自动杀 → 该进程进入 30 分钟冷却期
- 管理端收到 `重复杀告警` → 管理员可介入（手动杀、警告陪玩、调整策略）
- 陪玩不再被无限弹窗骚扰

**预估工时**：2h（含服务端告警端点）

---

## TASK-05 🔴 统一 API 前缀为 `/api/processes`

### 问题点

**文件**：`apps/server/src/process-blacklist/process-blacklist.controller.ts`

当前 `@Controller()` 未指定前缀，每个路由装饰器使用不同前缀：

| 路由 | 前缀 | 问题 |
|------|------|------|
| `@Get('blacklist/my-rules')` | `/api/blacklist` | 分散 |
| `@Post('blacklist')` | `/api/blacklist` | 分散 |
| `@Get('whitelist')` | `/api/whitelist` | 分散 |
| `@Get('processes/reports')` | `/api/processes` | 分散 |
| `@Post('processes/kill')` | `/api/processes` | 分散 |

导致：
1. 维护者需要记忆三套不同前缀，新增端点时容易放错位置
2. Electron 端 `main.ts:245` 用 `/api/processes/reports`，但 `pollBlacklist` 用 `/api/blacklist/my-rules`——两处路径风格不一致
3. 与设计文档 `PROCESS_BLACKLIST_DESIGN.md` 中的统一 `/api/processes` 规格不符

### 优化建议

**Step 1：控制器级前缀**

```ts
@Controller('processes')  // ← 统一前缀
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProcessBlacklistController {
```

**Step 2：子路由调整**

```ts
// 黑名单 → /api/processes/blacklist
@Get('blacklist')
@Post('blacklist')
@Put('blacklist/:id')
@Delete('blacklist/:id')
@Post('blacklist/push')
@Get('blacklist/my-rules')          // 陪玩自查询

// 白名单 → /api/processes/whitelist
@Get('whitelist')
@Post('whitelist')
@Delete('whitelist/:id')

// 陪玩个人覆盖 → /api/processes/blacklist/companions/:companionId/overrides
@Get('blacklist/companions/:companionId/overrides')
@Post('blacklist/companions/:companionId/overrides')
@Delete('blacklist/companions/:companionId/overrides/:overrideId')

// 进程上报 → /api/processes/reports
@Post('reports')                     // 上报（COMPANION）
@Get('reports')                      // 查询
@Get('reports/:companionId')
@Get('unique-names')

// 杀进程 → /api/processes
@Post('kill')                        // 手动杀
@Post('kill-report')                 // 杀进程结果上报
@Get('kill-logs')                    // 日志查询
```

**Step 3：前端 API 客户端同步修改**

`apps/web/src/api/blacklist.ts` 中所有路径从 `/api/blacklist/*` `/api/whitelist/*` `/api/processes/*` 统一为 `/api/processes/*`

**Step 4：Electron 端同步修改**

`apps/companion-electron/electron/main.ts` 中：
- L245: `${serverUrl}/api/processes/reports` → 不变
- L225: `${serverUrl}/api/blacklist/my-rules` → `${serverUrl}/api/processes/blacklist/my-rules`
- L270: `${serverUrl}/api/processes/kill-report` → 不变

### 验证方式

1. **编译验证**：`pnpm build` 无 TypeScript 错误
2. **功能验证**：逐条测试所有端点，确认响应正常
3. **回归验证**：Electron 客户端登录 → 确认进程采集+上报正常 → 确认黑名单推送正常 → 确认杀进程日志可查询

### 预期效果

- 所有进程管控相关 API 统一在 `/api/processes` 命名空间下
- 新人只需记住一个前缀即可定位所有进程管控端点
- 与设计文档规格完全对齐

**预估工时**：2h（含前后端同步修改）

---

## TASK-13 🟢 CS 端 DispatchPage 集成进程异常标识

### 问题点

**背景**：设计文档要求 CS 在派单面板看到陪玩进程异常标识（⚠️），以便派单时避开有违规进程的陪玩。

**当前状态**：
- 后端 `Companion` 模型无 `processStatus` 字段
- 前端 `DispatchPage` 未展示任何进程管控状态
- CS 虽然已拥有黑名单管理权限，但在派单时无法快速判断哪个陪玩有违规进程

**后果**：CS 可能把订单派给正在运行违禁进程的陪玩，影响服务质量和工作室管控效果。

### 优化建议

**Step 1：服务端 — Companion 查询增加 processStatus 推导**

```ts
// companions.service.ts — findAll() 方法中增加

// 查询每个 companion 最近的 kill log
const companionIds = companions.map(c => c.id);
const recentKills = await this.prisma.processKillLog.groupBy({
  by: ['companionId'],
  where: {
    companionId: { in: companionIds },
    createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // 30分钟内
  },
  _count: { id: true },
});

const killMap = new Map(recentKills.map(k => [k.companionId, k._count.id]));

// 附加 processStatus
return companions.map(c => ({
  ...c,
  processStatus: killMap.has(c.id)
    ? (killMap.get(c.id)! >= 3 ? 'BLOCKED' : 'WARNING')
    : 'NORMAL',
}));
```

**Step 2：Prisma Schema — Companion 表不需改字段**（processStatus 为计算字段，不持久化）

**Step 3：前端 — DispatchPage CSView 增加异常标识**

```tsx
// 在 companionStatusConfig 增加
WARNING: { color: 'orange', label: '⚠️ 进程异常', icon: <WarningOutlined /> },
BLOCKED: { color: 'red', label: '🚫 已被限制', icon: <StopOutlined /> },

// CSView 陪玩列表卡片中：
{companion.processStatus === 'BLOCKED' && (
  <Tooltip title="该陪玩因反复违规已被限制接单">
    <WarningOutlined style={{ color: '#FF4757', marginLeft: 8 }} />
  </Tooltip>
)}
{companion.processStatus === 'WARNING' && (
  <Tooltip title="该陪玩近期有违规进程记录">
    <ExclamationCircleOutlined style={{ color: '#FAAD14', marginLeft: 8 }} />
  </Tooltip>
)}

// 派单时过滤：BLOCKED 状态陪玩不可选
const availableCompanions = companions.filter(
  c => c.status === 'ONLINE' && c.processStatus !== 'BLOCKED'
);
```

**Step 4：消息通信 — CS 端订阅 WebSocket 事件**

当陪玩被杀进程后，服务端广播 `process:kill_result` 到工作室 room，CS 前端收到后刷新陪玩状态。

### 验证方式

1. **后端验证**：`GET /api/companions` 返回结果中每个 companion 含 `processStatus` 字段，值为 `NORMAL` / `WARNING` / `BLOCKED`
2. **前端验证**：登录 CS 账号 → 打开 DispatchPage → 确认有违规记录的陪玩显示 ⚠️ 标识 → 鼠标悬停显示 Tooltip
3. **派单验证**：尝试向 `BLOCKED` 状态陪玩派单 → 应被过滤或置灰不可选
4. **实时更新验证**：管理员触发杀进程 → CS 页面自动刷新陪玩状态

### 预期效果

- CS 派单时一目了然看到陪玩进程合规状态
- `BLOCKED` 陪玩不可被选为派单对象（从源头避免违规陪玩接单）
- `WARNING` 陪玩可派单但有视觉提醒（让 CS 知情决定）
- 与已有角色权限体系一致（CS 只看标识，不能操作进程）

**预估工时**：3h（后端 1h + 前端 2h）

---

## 📊 汇总

| TASK | 优先级 | 内容 | 工时 | 涉及文件数 |
|:--:|:--:|------|:--:|:--:|
| 03 | 🔴 P0 | JSON 解析失败回退 tasklist | 0.5h | 1 |
| 04 | 🔴 P0 | 循环杀防护 | 2h | 2 |
| 05 | 🔴 P0 | 统一 API 前缀 | 2h | 4 |
| 13 | 🟢 P2 | CS 端进程异常标识 | 3h | 4 |
| **合计** | | | **7.5h（约 1 人天）** | **11** |
