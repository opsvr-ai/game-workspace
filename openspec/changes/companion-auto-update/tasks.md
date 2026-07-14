## 1. 服务端 - Agent 模块

- [ ] 1.1 创建 `apps/server/src/agent/agent.module.ts`、`agent.controller.ts`、`agent.service.ts`
- [ ] 1.2 实现 `GET /api/agent/version` — 返回 SystemConfig 中的 `agent.latest_version` 和 `agent.latest_download_url`
- [ ] 1.3 实现 `GET /api/agent/download/latest` — 从 uploads 目录提供最新 exe 文件下载
- [ ] 1.4 实现 `GET /api/agent/version-status` — 查询所有 CompanionPC 的 agentVersion、lastHeartbeat，统计版本分布
- [ ] 1.5 实现 `POST /api/agent/build-and-push` — 执行构建脚本（git pull + pnpm install + electron-builder），更新 SystemConfig，广播 WS
- [ ] 1.6 在 `settings.controller.ts` DEFAULT_CONFIGS 中添加 `agent.latest_version` 和 `agent.latest_download_url` 默认值
- [ ] 1.7 在 `app.module.ts` 中注册 AgentModule

## 2. 陪玩端 - 更新模块

- [ ] 2.1 创建 `apps/companion-electron/electron/updater.ts` — 实现 checkForUpdates()、downloadAndInstall() 函数
- [ ] 2.2 checkForUpdates: GET /api/agent/version → 比较 app.getVersion() → 有新版本则调用 downloadAndInstall
- [ ] 2.3 downloadAndInstall: axios 下载 exe 到临时目录 → 校验 Content-Length → spawn('/S') 静默安装 → app.quit() + app.relaunch()
- [ ] 2.4 修改 `electron/main.ts` — app.whenReady() 后调用 updater.checkForUpdates()
- [ ] 2.5 修改 `electron/main.ts` — setupWsEvents() 中处理 `pc:command { command: 'update' }` → 调用 downloadAndInstall
- [ ] 2.6 修改 `electron/websocket.ts` — heartbeat 中 agentVersion 从硬编码 `'3.0.0'` 改为 `app.getVersion()`

## 3. 管理端 - 版本管理页面

- [ ] 3.1 创建 `apps/web/src/pages/admin/AgentVersionPage.tsx` — 当前版本卡片 + 版本分布表格 + 构建推送按钮
- [ ] 3.2 创建 `apps/web/src/api/agent.ts` — agentApi: getVersion, getVersionStatus, buildAndPush
- [ ] 3.3 修改 `apps/web/src/router.tsx` — 添加 `/admin/agent-version` 路由（ADMIN/OWNER）
- [ ] 3.4 修改 `apps/web/src/layouts/AppLayout.tsx` — ADMIN/OWNER 菜单添加「版本管理」条目

## 4. 验证与收尾

- [ ] 4.1 测试服务端 API: curl 验证 version、version-status、download/latest 端点
- [ ] 4.2 测试陪玩端: 启动检查逻辑（模拟不同版本号）
- [ ] 4.3 测试 WebSocket 推送: 从管理端触发构建推送，验证陪玩端收到 pc:command
- [ ] 4.4 更新 CHANGELOG.md 和 docs/
