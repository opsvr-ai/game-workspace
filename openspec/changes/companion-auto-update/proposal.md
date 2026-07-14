## Why

陪玩电脑上安装的 Electron 桌面客户端目前没有任何自动更新机制。每次服务端发布新版本（功能更新、bug 修复），都需要管理员手动到每台陪玩电脑上重新安装，效率极低且容易遗漏。在陪玩端即将大规模部署的节点，必须建立自动升级通道，让服务端代码更新后陪玩端能自动同步。

## What Changes

- **新增** 服务端版本管理 API：版本号存储、版本查询、下载端点
- **新增** 服务端构建推送接口：触发 git pull + electron-builder 构建，生成新安装包
- **新增** 管理端版本管理页面：查看版本分布、一键构建并推送更新
- **新增** 陪玩端启动时版本检查：启动时自动对比服务端最新版本，有更新则下载安装
- **新增** 陪玩端 WebSocket 更新接收：接收服务端推送的 `pc:command { command: 'update' }` 指令
- **新增** 陪玩端下载安装模块：下载 exe → 校验 → NSIS 静默安装 `/S` → 自动重启
- **修改** 陪玩端心跳上报：agentVersion 从硬编码改为读取 package.json 真实版本

## Capabilities

### New Capabilities

- `agent-auto-update`: 陪玩端自动升级能力，包括版本检查、下载安装器、静默安装、自动重启、启动时检查、WebSocket 推送触发

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **服务端**: 新增 AgentModule（AgentController + 构建脚本），新增 3 个 SystemConfig keys，新增 4 个 API 端点
- **陪玩端 (Electron)**: 新增 `electron/updater.ts` 模块，修改 `electron/websocket.ts`（版本号读取），修改 `electron/main.ts`（启动检查、注册 update 指令）
- **管理端 (Web)**: 新增 `AgentVersionPage.tsx`，修改 `router.tsx`、`AppLayout.tsx`（菜单注册）
- **依赖**: 无新增外部依赖，全部复用现有基础设施（Socket.IO、SystemConfig、NSIS 安装器）
