## Context

陪玩端 Electron 客户端（`@chunlv/companion-electron`）目前无自动更新机制。服务端已具备 WebSocket 远程命令通道（`pc:command`）和心跳上报（含 `agentVersion` 字段），陪玩端使用 NSIS 安装器（支持 `/S` 静默安装参数）。本次设计完全复用现有基础设施，不引入新外部依赖。

## Goals / Non-Goals

**Goals:**
- 陪玩端启动时自动检查服务端版本，有新版本则静默升级
- 管理员在 Web 管理端可查看版本分布、一键触发构建+推送
- 构建在服务器本地完成（git pull + electron-builder）
- 更新过程对陪玩无感知（静默安装 + 自动重启）

**Non-Goals:**
- 不支持增量/差分更新（全量下载安装器）
- 不支持 macOS/Linux 陪玩端（当前仅 Windows NSIS）
- 不实现回滚机制（首个版本）
- 不实现更新进度条 UI（简洁优先）

## Decisions

### D1: 版本号来源 — 使用 package.json 的 version 字段

陪玩端的 `package.json` 中已有 `"version": "1.0.0"`，electron-builder 也由此读取。服务端从构建产物中解析同一版本号存入 SystemConfig。两端用同一个语义版本号比较。

**替代方案**: 使用独立版本文件（如 `version.txt`）——增加维护负担，放弃。

### D2: 下载通道 — 服务端直接提供静态文件

新建 `GET /api/agent/download/latest` 端点，直接 `res.download()` 返回 exe 文件。陪玩端用 axios stream 下载到临时目录。

**替代方案**: 使用外部 CDN/对象存储——当前部署规模不需要，增加复杂度。

### D3: 推送通道 — 复用 WebSocket pc:command

现有 `pc:command { command: 'shutdown', ... }` 通道完全适用。新增 `command: 'update'` 即可触发更新下载，陪玩端已有的命令处理框架无需改动。

**替代方案**: 新建独立 WebSocket 事件 `agent:update`——增加概念冗余，放弃。

### D4: 静默安装 — NSIS /S 参数

NSIS 原生支持 `/S`（静默）和 `/D=路径`（指定目录）。无需额外包装。

### D5: 构建触发 — 管理端手动按钮

不实现 git webhook 自动触发（会引入非预期的自动构建），由管理员在版本管理页面确认后手动触发。

## Risks / Trade-offs

- **[R] 构建失败**: 如果 git pull 冲突或 electron-builder 报错，管理端需看到错误信息 → 构建脚本捕获 stderr，通过 API 返回给前端展示
- **[R] 下载中断**: 陪玩端网络不稳定导致 exe 下载不完整 → 下载后校验文件 Content-Length，不匹配则重试
- **[R] 安装中 app 退出**: 静默安装期间 Electron 退出，NSIS 可能无法覆盖正在使用的文件 → 安装前先 `app.quit()`，NSIS 会处理文件替换
- **[R] 大规模推送并发**: 同时向大量陪玩推送可能导致服务端带宽压力 → 陪玩端逐个下载，天然分散；后续可加随机延迟
- **[R] 版本回退需求**: 无回滚机制 → 首个版本通过重新构建旧代码实现，后续可加版本列表管理

## Open Questions

- 构建是否需要在独立 worktree 中进行以避免影响运行中的服务端代码？（当前设计直接在项目目录构建，简单但可能有文件锁问题）
- 是否需要下载进度通知给陪玩？（当前设计无 UI 进度，仅日志记录）
