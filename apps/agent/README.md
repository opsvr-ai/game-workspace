# Chunlv Agent — 陪玩桌面客户端

电竞陪玩工作室的桌面 Agent，通过 WebSocket 连接后端，提供计时、接单、远程控制功能。

## 功能

| 功能 | 说明 |
|------|------|
| ⏱️ 计时引擎 | WORK/ENTERTAINMENT 双模式，精确到秒 |
| 📡 WebSocket | 心跳上报、订单推送、远程指令接收 |
| 🌐 本地 WebUI | `http://localhost:9876`，模式切换 + 订单操作 |
| 🖥️ 远程控制 | 关机/重启/网络限速（需管理员权限） |
| 🔄 自动重连 | 连接断开 5s 自动重连 |

## 编译

### Linux
```bash
go build -o agent ./cmd/agent/
```

### Windows
```bash
# 在 Windows 上直接编译
go build -o agent.exe ./cmd/agent/

# 或在 Linux 上交叉编译
GOOS=windows GOARCH=amd64 go build -o agent.exe ./cmd/agent/
```

## 配置

通过环境变量配置：

| 变量 | 说明 | 示例 |
|------|------|------|
| `AGENT_SERVER_URL` | 后端地址 | `http://192.168.1.100:3001` |
| `AGENT_TOKEN` | 陪玩 JWT Token | 从管理员处获取 |

## 运行

### Linux
```bash
AGENT_SERVER_URL=http://server:3001 AGENT_TOKEN=<token> ./agent
```

Systemd 服务见 [部署文档](../../docs/DEPLOYMENT.md)。

### Windows
```cmd
set AGENT_SERVER_URL=http://server:3001
set AGENT_TOKEN=<token>
agent.exe
```

#### 管理员权限（远程控制必需）

关机/重启/网络限速需要管理员权限：

**方式一：右键以管理员身份运行**
右键 `agent.exe` → "以管理员身份运行"

**方式二：注册为 Windows 服务（推荐）**
```cmd
nssm install ChunlvAgent C:\agent\agent.exe
nssm set ChunlvAgent AppEnvironmentExtra AGENT_SERVER_URL=http://server:3001
nssm set ChunlvAgent AppEnvironmentExtra AGENT_TOKEN=<token>
nssm start ChunlvAgent
```

## 本地 WebUI

启动后访问 `http://localhost:9876`：

- 🔴/🟢 模式切换（接单/娱乐）
- ⏱️ 三组计时器（接单时间 / 娱乐时间 / 总时间）
- 📋 订单通知弹窗（确认接单 / 完成）
- 🔄 自动 5s 轮询状态更新

## 平台差异

| 功能 | Linux | Windows |
|------|-------|---------|
| 网络限速 | `tc qdisc tbf` | PowerShell `New-NetQosPolicy` |
| 关机 | `systemctl poweroff` | `shutdown /s /t 0` |
| 重启 | `systemctl reboot` | `shutdown /r /t 0` |
| 管理员 | `sudo` / root | 管理员权限运行 |
