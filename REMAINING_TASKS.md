# 最终优化任务清单（3 项）

> 📅 2026-07-05 | 🔴 P0×2 + ⚠️残留×1 | 总工时 3h

---

## TASK-03 🔴 修复进程采集 JSON 解析失败后不回退 tasklist

### 问题

**文件**：`apps/companion-electron/electron/process-monitor.ts` L122-124

```ts
} catch (e: any) {
  logger.error('[ProcessCollect] Failed to parse PowerShell output', { error: e.message });
  resolve([]);  // ← PowerShell 运行正常但 JSON.parse 抛异常时，静默返回空数组
}
```

**触发场景**：某进程名含 `{` `}` `[` `]` 等特殊字符时，`Get-Process | ConvertTo-Json` 输出在 `JSON.parse` 阶段抛异常，进入 catch 后 `resolve([])` 直接返回空数组——管理端看到的进程列表为空，实际黑名单进程仍在运行。

### 优化

catch 块增加 tasklist 回退：

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
    });
    resolve(result);
  });
}
```

### 验证

1. 模拟异常：构造测试进程名含 `{test}.exe` → 确认日志出现 `tasklist-fallback`
2. 正常回归：无异常时仍走 PowerShell 路径，日志为 `via PowerShell`
3. tasklist 也失败：确认最终 `resolve([])`，日志含 `tasklist fallback also failed`

### 预期

任何场景下 Agent 不会静默上报空列表。三种采集路径（powershell / tasklist / tasklist-fallback）均可追溯。

**文件**：1 | **工时**：30min

---

## TASK-04 🔴 实现循环杀防护

### 问题

**文件**：`apps/companion-electron/electron/process-monitor.ts`

当前流程：每 60s 重检 → 发现黑名单进程 → `onKillCallback(hit)` → 弹窗 → 杀进程。

陪玩反复双击桌面图标重开被杀进程 → 每次 60s 后又被检测 → 又弹窗 → 又杀 → **无限循环**，管理员无感知。

### 优化

**Step 1** — L63 新增状态结构：

```ts
// 替换现有 killHistory: number[]
interface KillCounter { count: number; firstKillAt: number; lastKillAt: number; }
const killCounters = new Map<string, KillCounter>();
const CYCLE_THRESHOLD = 3;
const CYCLE_WINDOW_MS = 5 * 60 * 1000;
const BLOCK_DURATION_MS = 30 * 60 * 1000;
```

**Step 2** — `runBlacklistCheck()` 和 `runReportCycle()` 中 `onKillCallback?.(hit)` 调用前插入：

```ts
for (const hit of hits) {
  const key = hit.name.toLowerCase();
  const c = killCounters.get(key) || { count: 0, firstKillAt: 0, lastKillAt: 0 };
  const now = Date.now();

  // 冷却期内 → 跳过
  if (c.lastKillAt > 0 && (now - c.lastKillAt) < BLOCK_DURATION_MS) {
    logger.warn('[ProcessMonitor] Kill blocked — in cooldown', { processName: hit.name });
    continue;
  }

  // 计数
  if (now - c.firstKillAt > CYCLE_WINDOW_MS) { c.count = 0; c.firstKillAt = now; }
  c.count++;
  c.lastKillAt = now;
  killCounters.set(key, c);

  // 超阈值 → 停止+告警
  if (c.count >= CYCLE_THRESHOLD) {
    logger.error('[ProcessMonitor] REPEAT_KILL_ALERT', { processName: hit.name, count: c.count });
    // REST 告警上报（已有 /api/processes/kill-report 模式可直接复用）
    continue;
  }

  onKillCallback?.(hit);
}
```

### 验证

1. 5 分钟内反复启动同一黑名单进程 3 次 → 第 4 次弹窗被跳过 → 日志出现 `REPEAT_KILL_ALERT`
2. 等待 5 分钟窗口过期 → 计数器自动重置 → 再次启动正常弹窗杀进程
3. 冷却期 30 分钟内 → 该进程被持续跳过

### 预期

- 同一进程 5 分钟内触发超 3 次 → 停止自动杀 → 进入 30 分钟冷却
- 管理端收到重复杀告警 → 管理员介入处理

**文件**：1 | **工时**：2h

---

## TASK-05 ⚠️ push 端点路径遗留修正

### 问题

**文件**：`apps/web/src/api/blacklist.ts` L14

控制器已统一为 `@Controller('processes')`，Electron 端也已同步，但前端 push 调用仍走旧路径：

```ts
// L14 — 当前（错误）
http.post('/blacklist/push', data)
//          ↑ 缺少 /processes 前缀

// 应改为
http.post('/processes/blacklist/push', data)
```

**后果**：点击「推送黑名单」按钮 → 请求 `/api/blacklist/push` → 404 Not Found。

### 优化

```ts
// blacklist.ts L14 改为：
push: (data: { companionIds?: string[]; targetAll?: boolean }) =>
  http.post('/processes/blacklist/push', data),
```

### 验证

管理端登录 → 打开黑名单页面 → 点击「推送黑名单」→ 选择目标 → 点击推送 → 返回成功消息。

### 预期

推送功能恢复正常，与控制器路由 `/api/processes/blacklist/push` 正确匹配。

**文件**：1 | **工时**：5min
