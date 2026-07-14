## Context

陪玩可以通过托盘菜单退出、任务管理器杀进程等方式关闭 Electron 客户端，从而逃逸娱乐模式限制、进程黑名单、远程控制等功能。需要在电脑开机期间 app 不可被关闭，仅允许下班关机或休息模式。

当前已有基础设施：nssm 服务部署方案（记录在 docs/DEPLOYMENT.md）、WebSocket 心跳、陪玩状态管理（RESTING 休息模式）。

## Goals / Non-Goals

**Goals:**
- 陪玩电脑开机后 app 自启动，运行期间无法被关闭
- 仅允许两种退出路径：系统关机 + 休息模式（RESTING）
- 进程被任务管理器杀死后自动重启
- 管理端可看到异常离线告警

**Non-Goals:**
- 不实现在 app 内输入密码退出
- 不写独立的 watchdog 双进程守护
- 不改变现有的 RESTING/ENTERTAINMENT 状态逻辑

## Decisions

### D1: 自启动 + 自动重启 — nssm Windows 服务

nssm 将 Electron app 注册为 Windows 服务，配置：
- `Start: SERVICE_AUTO_START` — 开机自启
- `AppExit: Restart` — 进程非正常退出时自动重启
- 服务以 SYSTEM 权限运行，普通用户无法 net stop

这完全复用 `docs/DEPLOYMENT.md` 中已有的 nssm 部署方案。nssm 自身 < 5MB 内存，~0% CPU。

### D2: 托盘退出移除

修改 `tray.ts`，移除托盘菜单中的「退出」选项。托盘仅保留：显示窗口、状态切换（可用/休息/娱乐）。

唯一正常退出路径：系统关机时 `app.on('before-quit')` 自动触发，app 正常关闭。

### D3: 服务端心跳告警

守护进程被杀后 nssm 会拉起，但中间有几秒空白期。利用已有的心跳机制：
- 心跳中断 > 2 分钟 → 管理端标记「异常离线」
- 在版本管理/陪玩管理页面显示离线时长
- 可选：通过 WebSocket 通知管理端

复用现有 `CompanionPC.lastHeartbeat` 和 `Companion.status = OFFLINE` 逻辑，无需新增数据结构。

### D4: 窗口关闭隐藏（已有）

当前 `main.ts` 已实现 `win.on('close')` 拦截，隐藏到托盘而非真正关闭。保持不变。

## Architecture

```
Windows 启动
  → nssm 服务自动启动 agent.exe (SYSTEM权限)
  → app 运行：托盘无退出按钮，窗口关闭=隐藏
  → 系统关机 → app.on('before-quit') → 正常退出
  → 被杀 → nssm AppExit=Restart → 5秒内自动拉起

管理端监控:
  心跳中断 > 2分钟 → OFFLINE + 异常时长计时
  → 管理端陪玩管理页显示告警标记
```
