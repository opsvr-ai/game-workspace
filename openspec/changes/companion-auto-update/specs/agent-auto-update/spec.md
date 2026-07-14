## ADDED Requirements

### Requirement: 服务端存储和管理最新版本信息
系统 SHALL 通过 SystemConfig 存储当前全平台最新客户端版本号和下载地址。

#### Scenario: 查询最新版本
- **WHEN** 陪玩端或管理端请求 GET /api/agent/version
- **THEN** 系统返回 `{ version: "x.x.x", downloadUrl: "/api/agent/download/latest" }`

#### Scenario: 构建完成后自动更新版本号
- **WHEN** 管理员触发构建推送且构建成功
- **THEN** 系统 SHALL 自动更新 `agent.latest_version` 和 `agent.latest_download_url` SystemConfig

---

### Requirement: 陪玩端启动时自动检查版本
陪玩端 SHALL 在 app.whenReady() 后自动向服务端查询最新版本号，与本地版本比较。

#### Scenario: 版本相同
- **WHEN** 陪玩端启动且本地版本等于服务端最新版本
- **THEN** 系统不执行任何更新操作，正常启动

#### Scenario: 发现新版本
- **WHEN** 陪玩端启动且本地版本低于服务端最新版本
- **THEN** 系统 SHALL 自动下载最新安装器、静默安装、并重启 app

#### Scenario: 版本检查失败
- **WHEN** 陪玩端启动但无法连接服务端（网络异常或服务端不可达）
- **THEN** 系统 SHALL 跳过版本检查，正常启动，记录警告日志

---

### Requirement: 管理端手动构建并推送更新
管理员 SHALL 能够在管理后台触发构建并推送更新到所有在线陪玩。

#### Scenario: 成功构建并推送
- **WHEN** 管理员点击「构建并推送」按钮
- **THEN** 服务端 SHALL 依次执行 git pull、pnpm install、electron-builder 构建
- **AND** 构建成功后 SHALL 更新 SystemConfig 版本信息
- **AND** 通过 WebSocket 向所有在线陪玩广播 `pc:command { command: 'update', downloadUrl, version }`

#### Scenario: 构建失败
- **WHEN** 构建过程中发生错误（git 冲突、编译失败等）
- **THEN** 系统 SHALL 返回错误信息给管理端展示
- **AND** SHALL NOT 更新版本号或推送更新

---

### Requirement: 管理端查看版本分布
管理员 SHALL 能够在管理后台查看所有陪玩的版本分布情况。

#### Scenario: 查看版本分布
- **WHEN** 管理员请求 GET /api/agent/version-status
- **THEN** 系统返回每个陪玩的当前版本、在线状态、最后心跳时间
- **AND** 统计信息包括在线人数、已更新人数、待更新人数

---

### Requirement: 陪玩端接收 WebSocket 推送更新
陪玩端 SHALL 监听 WebSocket `pc:command` 事件，当收到 `command: 'update'` 时触发更新流程。

#### Scenario: 收到更新指令
- **WHEN** 陪玩端 WebSocket 收到 `pc:command { command: 'update', downloadUrl }`
- **THEN** 系统 SHALL 下载 downloadUrl 指向的安装器到临时目录
- **AND** 校验下载文件完整性
- **AND** 执行 NSIS 静默安装 `/S`
- **AND** 安装完成后自动重启 app

---

### Requirement: 陪玩端上报真实版本号
陪玩端心跳上报 SHALL 使用 `app.getVersion()` 读取 package.json 中的真实版本号，而非硬编码值。

#### Scenario: 心跳上报版本号
- **WHEN** 陪玩端发送 WebSocket heartbeat
- **THEN** agentVersion 字段 SHALL 等于 app.getVersion() 返回值
