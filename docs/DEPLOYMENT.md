# 蠢驴电竞陪玩派单管理系统 — 部署指南

> 适用版本：v0.1.0+ | 最后更新：2026-06-25

---

## 目录

- [1. 服务器要求](#1-服务器要求)
- [2. 环境配置](#2-环境配置)
- [3. 数据库部署](#3-数据库部署)
- [4. 应用部署](#4-应用部署)
  - [4.1 后端部署](#41-后端部署)
  - [4.2 前端部署](#42-前端部署)
- [5. Electron 客户端 部署](#5-go-agent-部署)
- [6. 健康检查](#6-健康检查)
- [7. 备份策略](#7-备份策略)
- [8. 故障排查](#8-故障排查)

---

## 1. 服务器要求

### 硬件配置

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 50 GB SSD |
| 网络 | 稳定的互联网连接 |

### 软件环境

| 软件 | 最低版本 | 用途 |
|------|---------|------|
| **操作系统** | Ubuntu 20.04+（推荐）/ CentOS 7+ / Windows Server 2019+ | 运行环境 |
| **Node.js** | >= 18 | 后端 + 前端运行时 |
| **pnpm** | >= 8 | 包管理器（monorepo 工作空间） |
| **Go** | >= 1.22 | Agent 编译（仅需编译时） |
| **Docker** | Docker Desktop / Docker Engine 24+ | 运行 PostgreSQL + Redis 容器 |
| **Docker Compose** | v2+ | 编排容器服务 |
| **Git** | 2.x | 拉取代码 |
| **Nginx** | 1.18+（可选） | 前端静态文件服务 + 反向代理 |
| **PM2** | 5.x（可选） | Node.js 进程管理 |

### 安装 Node.js 和 pnpm

```bash
# 使用 NodeSource 安装 Node.js 20 LTS (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 或使用 nvm 管理版本
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20

# 验证版本
node -v   # 应 >= 18.0.0

# 安装 pnpm
npm install -g pnpm
pnpm -v   # 应 >= 8.0.0
```

### 安装 Docker（Ubuntu）

```bash
# 安装 Docker Engine
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
# 重新登录或执行: newgrp docker

# 验证安装
docker --version
docker compose version
```

### 安装 Go（如需编译 Agent）

```bash
# 下载并安装 Go 1.22
wget https://go.dev/dl/go1.22.10.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.10.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# 验证
go version   # 应 >= go1.22.0
```

---

## 2. 环境配置

### 2.1 克隆仓库

```bash
git clone <repository-url> chunlv-esports
cd chunlv-esports
```

### 2.2 安装项目依赖

```bash
pnpm install
```

### 2.3 配置环境变量

从模板文件创建后端环境配置：

```bash
cp .env.example apps/server/.env
```

编辑 `apps/server/.env`，根据实际生产环境修改各项配置：

```bash
# 完整示例配置
DATABASE_URL=postgresql://postgres:<你的密码>@localhost:5432/chunlv
REDIS_URL=redis://:<你的Redis密码>@localhost:6379
JWT_SECRET=<生成的随机密钥>
JWT_REFRESH_SECRET=<生成的另一个随机密钥>
PORT=3001
```

### 2.4 环境变量说明

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 数据库连接字符串。格式：`postgresql://用户名:密码@主机:端口/数据库名`。生产环境务必使用强密码，并与 `docker/.env` 中的 `POSTGRES_PASSWORD` 保持一致。 | `postgresql://postgres:mysecurepassword@localhost:5432/chunlv` |
| `REDIS_URL` | Redis 连接字符串。格式：`redis://:密码@主机:端口`。Redis 已启用认证，必须包含与 `docker/.env` 中 `REDIS_PASSWORD` 一致的密码。 | `redis://:myredispassword@localhost:6379` |
| `JWT_SECRET` | 用于签发用户访问令牌（access token）的密钥。访问令牌有效期 15 分钟。必须使用随机长字符串，绝对不要使用默认值。 | 通过以下命令生成（见下方） |
| `JWT_REFRESH_SECRET` | 用于签发刷新令牌（refresh token）的密钥。刷新令牌有效期 7 天。与 `JWT_SECRET` 使用不同的随机字符串。 | 通过以下命令生成（见下方） |
| `PORT` | 后端 HTTP 服务监听端口。默认 3001。如果端口冲突可修改，但需同步更新前端代理配置。 | `3001` |

### 2.5 生成 JWT 密钥

```bash
# 生成两个不同的 32 字节随机密钥（十六进制）
openssl rand -hex 32
# 例如: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2

openssl rand -hex 32
# 例如: f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4

# 将生成的两个值分别填入 apps/server/.env 的 JWT_SECRET 和 JWT_REFRESH_SECRET
```

> **重要**：`JWT_SECRET` 和 `JWT_REFRESH_SECRET` 必须使用不同的值。如果泄露，任何人可以用你的密钥签发有效令牌，请妥善保管。

---

## 3. 数据库部署

### 3.1 启动 PostgreSQL + Redis 容器

```bash
# 在项目根目录执行
cp docker/.env.example docker/.env
# 编辑 docker/.env，设置强随机 POSTGRES_PASSWORD 和 REDIS_PASSWORD
docker compose -f docker/docker-compose.yaml up -d
```

此命令会启动两个容器：

| 容器 | 镜像 | 端口 | 用户名/密码 | 数据库 |
|------|------|------|-------------|--------|
| `chunlv-postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | `postgres` / `docker/.env` 中的 `POSTGRES_PASSWORD` | `chunlv` |
| `chunlv-redis` | `redis:7-alpine` | `127.0.0.1:6379` | `docker/.env` 中的 `REDIS_PASSWORD` | -- |

### 3.2 验证容器运行状态

```bash
# 检查容器是否正常运行
docker ps
# 预期输出包含 chunlv-postgres (healthy) 和 chunlv-redis (healthy)

# 验证 PostgreSQL 连接
docker exec chunlv-postgres pg_isready -U postgres -d chunlv
# 预期输出: /var/run/postgresql:5432 - accepting connections
```

### 3.3 数据存储位置

容器数据通过 Docker Volume 映射到宿主机：

| 数据 | 宿主机路径 | 容器内路径 |
|------|-----------|-----------|
| PostgreSQL 数据 | `./docker/data/postgres/` | `/var/lib/postgresql/data` |
| Redis 数据 | `./docker/data/redis/` | `/data` |

> 备份时直接备份这些目录即可。注意这些路径相对于 `docker/docker-compose.yaml` 文件所在目录。

### 3.4 运行数据库迁移

当 schema.prisma 中有变更或首次部署时，需要运行迁移以同步数据库结构：

```bash
# 在项目根目录执行
pnpm db:migrate
# 实际执行: pnpm --filter @chunlv/server db:migrate
# 内部调用: cd apps/server && npx prisma migrate dev
```

### 3.5 导入测试数据（可选）

```bash
pnpm db:seed
# 实际执行: pnpm --filter @chunlv/server db:seed
# 内部调用: cd apps/server && npx prisma db seed
# 数据来源: apps/server/prisma/seed.ts
```

默认测试账号：

| 用户名 | 密码 | 角色 | 备注 |
|--------|------|------|------|
| `hanlei` | `123456` | OWNER | 超级管理员，第二密码：`888888` |
| `kefu01` | `123456` | CS | 客服，需 owner 授权 |
| `zhangsan` | `123456` | COMPANION | 陪玩师，需 owner 授权 |

> **生产环境部署**：如果不是全新部署，请跳过 `pnpm db:seed`，避免覆盖已有数据。迁移（`db:migrate`）不会删除数据，仅更新表结构。

---

## 4. 应用部署

### 4.1 后端部署

#### 4.1.1 构建

```bash
# 在项目根目录执行，构建所有包（shared → server → web）
pnpm build
```

构建产物位置：
- `packages/shared/dist/` -- 共享类型和枚举
- `apps/server/dist/` -- Nest.js 编译后的 JS 文件，入口 `apps/server/dist/main.js`
- `apps/web/dist/` -- Vite 打包后的前端静态文件

#### 4.1.2 直接启动（验证用）

```bash
# 从项目根目录启动
node apps/server/dist/main.js

# 预期输出:
# Server running on http://localhost:3001
```

> 注意：需要确保 `apps/server/.env` 文件存在且配置正确，因为服务器启动时会读取 `.env` 文件（通过 Nest.js 的 `ConfigModule`）。

#### 4.1.3 使用 PM2 进程管理（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动后端服务
pm2 start apps/server/dist/main.js \
  --name chunlv-server \
  --cwd /data/project/game-workspace/apps/server

# 查看运行状态
pm2 status

# 查看日志
pm2 logs chunlv-server

# 设置开机自启
pm2 startup
pm2 save

# 常用操作
pm2 restart chunlv-server   # 重启
pm2 stop chunlv-server      # 停止
pm2 delete chunvl-server    # 删除（会移除进程）
pm2 reload chunlv-server    # 零停机重载（需集群模式）
```

#### 4.1.4 多实例集群模式（高负载）

```bash
pm2 start apps/server/dist/main.js \
  --name chunlv-server \
  --cwd /data/project/game-workspace/apps/server \
  -i max    # 自动检测 CPU 核心数，启动对应数量的实例

# 或手动指定实例数
pm2 start apps/server/dist/main.js \
  --name chunlv-server \
  --cwd /data/project/game-workspace/apps/server \
  -i 2
```

> 注意：使用集群模式时，WebSocket 连接需要配置 sticky session（如需支持）。Socket.IO 默认支持 sticky session，配合 Nginx 反向代理即可。

#### 4.1.5 使用 systemd 服务

在 `/etc/systemd/system/chunlv-server.service` 创建服务文件：

```ini
[Unit]
Description=Chunlv Esports Backend Server
After=network.target docker.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/data/project/game-workspace/apps/server
# 从项目根目录启动，.env 文件在 apps/server/ 下
ExecStart=/usr/bin/node /data/project/game-workspace/apps/server/dist/main.js
Restart=on-failure
RestartSec=10
# 环境变量
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chunlv-server
sudo systemctl start chunlv-server
sudo systemctl status chunlv-server

# 查看日志
sudo journalctl -u chunlv-server -f
```

### 4.2 前端部署

前端是 React SPA（单页应用），构建产物为纯静态文件。

#### 4.2.1 选项 A：Nginx 静态文件服务（推荐）

安装 Nginx：

```bash
sudo apt-get install -y nginx
```

创建 Nginx 配置文件 `/etc/nginx/sites-available/chunlv-web`：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为实际域名

    # 前端静态文件
    root /data/project/game-workspace/apps/web/dist;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # 静态资源缓存（带 hash 的文件名，缓存一年）
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback：所有非文件请求返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # API 反向代理到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket (Socket.IO) 反向代理
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }

    # 上传文件代理
    location /uploads/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
}
```

启用站点：

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/chunlv-web /etc/nginx/sites-enabled/

# 测试配置是否正确
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

#### 4.2.2 选项 B：PM2 + Vite Preview（轻量场景）

```bash
# 从 apps/web 目录启动预览服务
pm2 start npx --name chunlv-web -- vite preview --port 4173 --host 0.0.0.0

# 查看日志
pm2 logs chunlv-web

# 配合 Nginx 反向代理同上，将 proxy_pass 指向 http://127.0.0.1:4173
```

#### 4.2.3 选项 C：HTTPS 配置（推荐）

使用 Certbot 申请免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 自动配置 SSL
sudo certbot --nginx -d your-domain.com

# 证书会自动续期（certbot 已配置 systemd timer）
sudo certbot renew --dry-run   # 测试续期是否正常
```

---

## 5. Electron 客户端 部署

Electron 客户端 是运行在陪玩师电脑上的桌面客户端，通过 WebSocket 连接后端。

### 5.1 编译 Agent

#### Linux 编译

```bash
cd apps/agent

# 编译（输出文件：agent）
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o agent ./cmd/agent/

# 或从项目根目录编译
cd /data/project/game-workspace/apps/agent && go build -ldflags="-s -w" -o agent ./cmd/agent/
```

#### Windows 编译

```bash
cd apps/agent

# 编译 exe（去除调试信息以减小体积）
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o agent.exe ./cmd/agent/
```

#### 交叉编译（在一台机器上编译多平台）

```bash
# 编译 Linux 版本
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/agent-linux ./cmd/agent/

# 编译 Windows 版本
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/agent-windows.exe ./cmd/agent/
```

### 5.2 配置 Agent 环境变量

```bash
# 必需：陪玩师的 JWT access token（登录后从前端获取或从开发者工具获取）
export AGENT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# 可选：后端服务器地址（默认 http://localhost:3001）
export AGENT_SERVER_URL="http://your-server-ip:3001"
```

### 5.3 启动 Agent（Linux）

```bash
# 直接启动
./agent

# 预期输出:
#   Chunlv Agent started
#     Server: http://localhost:3001
#     Local UI: http://localhost:9876
```

Agent 会在陪玩师本机启动一个本地 HTTP 服务（端口 9876），提供本地 Web UI。

### 5.4 使用 systemd 管理 Agent（Linux）

创建 `/etc/systemd/system/chunlv-agent.service`：

```ini
[Unit]
Description=Chunlv Esports Desktop Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=companion                    # 替换为实际运行的普通用户
Group=companion
WorkingDirectory=/opt/chunlv-agent
ExecStart=/opt/chunlv-agent/agent
Restart=always
RestartSec=5
Environment=AGENT_TOKEN=eyJ...
Environment=AGENT_SERVER_URL=http://your-server-ip:3001

# 安全加固（可选）
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable chunlv-agent
sudo systemctl start chunlv-agent
sudo systemctl status chunlv-agent
```

### 5.5 使用 nssm 管理 Agent（Windows）

nssm（Non-Sucking Service Manager）可以将任意 exe 注册为 Windows 服务。

```powershell
# 下载 nssm
# https://nssm.cc/download
# 解压后将 nssm.exe 放入 PATH 或 agent 目录

# 创建服务
nssm install chunlv-agent

# 在弹出的配置窗口中设置：
# Application path: C:\chunlv-agent\agent.exe
# Startup directory: C:\chunlv-agent
# Arguments: （留空）
#
# 切换到 "Environment" 选项卡，添加：
# AGENT_TOKEN=eyJ...
# AGENT_SERVER_URL=http://your-server-ip:3001
#
# 点击 "Install service"

# 启动服务
nssm start chunlv-agent

# 其他命令
nssm status chunlv-agent    # 查看状态
nssm restart chunlv-agent   # 重启
nssm stop chunlv-agent      # 停止
nssm remove chunlv-agent confirm  # 删除服务
```

---

## 6. 健康检查

### 6.1 应用健康检查接口

后端暴露了健康检查端点 `GET /api/health`，无需认证：

```bash
# 检查后端健康状态
curl http://localhost:3001/api/health

# 正常响应:
# { "status": "ok", "db": "ok", "timestamp": "2026-06-25T12:00:00.000Z" }

# 数据库连接异常时:
# { "status": "error", "db": "error", "timestamp": "2026-06-25T12:00:00.000Z" }
```

可在监控系统（如 Prometheus blackbox exporter、Nagios、Zabbix）中配置定期检查此端点。

### 6.2 数据库容器健康检查

docker-compose.yaml 中已内置容器健康检查：

```yaml
# PostgreSQL
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U postgres -d chunlv"]
  interval: 5s
  timeout: 3s
  retries: 5

# Redis
healthcheck:
  test: ["CMD-SHELL", "redis-cli -a \"$${REDIS_PASSWORD}\" ping | grep PONG"]
  interval: 5s
  timeout: 3s
  retries: 5
```

查看容器健康状态：

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### 6.3 前端访问验证

```bash
# 使用 curl 验证前端页面是否可访问
curl -s -o /dev/null -w "%{http_code}" http://localhost/
# 预期: 200
```

### 6.4 自动部署（定时拉取）

服务器已内置自动部署：systemd timer 每分钟运行 `chunlv-deploy.sh`，检测到 `master` 新提交后自动执行：

1. `git pull --rebase --autostash`
2. `pnpm install --frozen-lockfile`
3. Prisma generate + migrate deploy（不会重置数据）
4. 构建 shared/server/web
5. 重建并重启 `chunlv-app` 容器
6. 等待健康检查通过

```bash
# 查看自动部署日志
sudo tail -f /var/log/chunlv-deploy.log

# 查看定时器状态
sudo systemctl status chunlv-deploy.timer

# 手动触发一次
sudo systemctl start chunlv-deploy.service
```

脚本位置：`deploy/chunlv-deploy.sh`，生产机安装至 `/usr/local/bin/chunlv-deploy.sh`。

---

## 7. 备份策略

### 7.1 数据库备份

#### 手动备份

```bash
# 完整备份
docker exec chunlv-postgres pg_dump -U postgres chunlv > /backup/chunlv-$(date +%Y%m%d-%H%M%S).sql

# 只备份结构（无数据）
docker exec chunlv-postgres pg_dump -U postgres --schema-only chunlv > /backup/chunlv-schema-$(date +%Y%m%d).sql

# 压缩备份（节省空间）
docker exec chunlv-postgres pg_dump -U postgres chunlv | gzip > /backup/chunlv-$(date +%Y%m%d-%H%M%S).sql.gz
```

#### 自动备份（Cron）

创建备份脚本 `/opt/scripts/backup-chunlv-db.sh`：

```bash
#!/bin/bash
# 蠢驴电竞数据库备份脚本

BACKUP_DIR="/backup/chunlv"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# 备份数据库
docker exec chunlv-postgres pg_dump -U postgres chunlv | gzip > "$BACKUP_DIR/chunlv-$TIMESTAMP.sql.gz"

# 删除 30 天前的备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup completed: chunlv-$TIMESTAMP.sql.gz"
```

添加定时任务：

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点执行备份
0 2 * * * /bin/bash /opt/scripts/backup-chunlv-db.sh >> /var/log/chunlv-backup.log 2>&1
```

### 7.2 文件数据备份

```bash
# 备份上传的截屏文件
tar -czf /backup/chunlv-uploads-$(date +%Y%m%d).tar.gz uploads/

# 备份环境配置文件
cp apps/server/.env /backup/chunlv-env-$(date +%Y%m%d).bak
```

### 7.3 数据恢复

```bash
# 恢复数据库
# 注意：会覆盖当前数据库内容
docker exec -i chunlv-postgres psql -U postgres chunlv < /backup/chunlv-YYYYMMDD-HHMMSS.sql

# 从 gzip 压缩包恢复
gunzip -c /backup/chunlv-YYYYMMDD-HHMMSS.sql.gz | docker exec -i chunlv-postgres psql -U postgres chunlv

# 恢复上传文件
tar -xzf /backup/chunlv-uploads-YYYYMMDD.tar.gz
```

---

## 8. 故障排查

### 8.1 数据库连接失败

**症状**：`pnpm db:migrate` 报错 `Can't reach database server` 或后端启动后 `/api/health` 返回 `db: error`。

**排查步骤**：

```bash
# 1. 确认容器是否运行
docker ps | grep chunlv

# 如果容器未运行，启动容器
docker compose -f docker/docker-compose.yaml up -d

# 2. 确认端口是否开放
ss -tlnp | grep 5432
# 或
netstat -tlnp | grep 5432

# 3. 确认 .env 中 DATABASE_URL 格式正确
grep DATABASE_URL apps/server/.env
# 正确格式: postgresql://postgres:postgres@localhost:5432/chunlv

# 4. 直接测试数据库连接
docker exec chunlv-postgres psql -U postgres -d chunlv -c "SELECT 1;"

# 5. 如果端口冲突，修改 docker-compose.yaml 中的端口映射
#    将 "5432:5432" 改为 "5433:5432"，然后更新 .env 中的端口为 5433
```

### 8.2 端口占用

**症状**：后端启动报错 `EADDRINUSE` 或 `address already in use :::3001`。

**排查步骤**：

```bash
# 查看占用 3001 端口的进程
sudo lsof -i :3001
# 或
sudo ss -tlnp | grep 3001

# 终止占用进程
sudo kill -9 <PID>

# 如果需要修改端口，编辑 apps/server/.env:
PORT=3002

# 同时更新 Nginx 中的 proxy_pass：
# proxy_pass http://127.0.0.1:3002;
```

### 8.3 JWT 令牌过期 / 验证失败

**症状**：前端请求返回 `401 Unauthorized` 或 `Invalid token`。

**排查步骤**：

```bash
# 1. 确认 JWT_SECRET 和 JWT_REFRESH_SECRET 已正确配置
grep -E "JWT_SECRET|JWT_REFRESH_SECRET" apps/server/.env

# 2. 确认两个密钥不同且为随机字符串
# 如果修改过密钥，旧的 token 会全部失效，用户需要重新登录

# 3. Access token 有效期 15 分钟，过期后前端会自动使用 refresh token 续期
#    检查浏览器控制台是否有 /api/auth/refresh 的请求错误

# 4. 清除浏览器 localStorage 中的旧 token
#    localStorage.removeItem('accessToken')
#    localStorage.removeItem('refreshToken')
```

### 8.4 前端页面 404（Nginx 配置问题）

**症状**：访问 `http://your-domain.com/orders` 返回 404，但 `index.html` 可以正常加载。

**原因**：React SPA 使用前端路由（React Router），所有非静态文件请求需要回退到 `index.html`。

**解决方案**：确认 Nginx 配置中包含 SPA fallback：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

验证：

```bash
# 检查 Nginx 配置
sudo nginx -t

# 如果配置正确但仍 404，检查站点是否启用
ls -la /etc/nginx/sites-enabled/

# 重新加载
sudo systemctl reload nginx
```

### 8.5 Electron 客户端 WebSocket 连接失败

**症状**：Agent 端日志显示 `WebSocket connection failed` 或无法连接。

**排查步骤**：

```bash
# 1. 确认 AGENT_TOKEN 有效且未过期
#    用 curl 测试 token:
curl -H "Authorization: Bearer $AGENT_TOKEN" http://localhost:3001/api/auth/me
# 如果返回 401，token 已过期，需要重新登录获取

# 2. 确认 AGENT_SERVER_URL 可访问
curl http://your-server-ip:3001/api/health

# 3. 检查防火墙是否放行 3001 端口
sudo ufw status

# 放行端口（如使用 ufw）
sudo ufw allow 3001/tcp

# 4. 如果使用 Nginx 反向代理，确认 socket.io 路径配置正确
#    检查 Nginx error log:
sudo tail -f /var/log/nginx/error.log

# 5. Agent 会自动重连（每 5 秒），查看日志确认重连状态
```

### 8.6 Prisma 迁移冲突

**症状**：`pnpm db:migrate` 报错 `Drift detected` 或迁移历史不一致。

**解决方案**：

```bash
# 重置开发数据库（会删除所有数据，仅限开发环境！）
cd apps/server

# 方式一：使用 Prisma 迁移重置
npx prisma migrate reset --force

# 方式二：手动删除并重建
docker exec -i chunlv-postgres psql -U postgres -c "DROP DATABASE chunlv;"
docker exec -i chunlv-postgres psql -U postgres -c "CREATE DATABASE chunlv;"

# 重新运行迁移和种子
pnpm db:migrate
pnpm db:seed
```

> **生产环境警告**：`migrate reset` 会删除所有数据！生产环境请使用 `prisma migrate deploy` 代替 `prisma migrate dev`。

### 8.7 Docker 容器无法启动

```bash
# 查看容器日志
docker logs chunlv-postgres
docker logs chunlv-redis

# 完全重启服务
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.yaml up -d

# 如果数据损坏，重建容器（生产环境谨慎！）
docker compose -f docker/docker-compose.yaml down -v   # -v 删除数据卷！
docker compose -f docker/docker-compose.yaml up -d

# 检查磁盘空间
df -h
docker system df
```

---

## 附录 A：完整的一键部署脚本

以下脚本适用于 Ubuntu 20.04+ 全新环境从零开始部署（供参考，请根据实际环境调整）：

```bash
#!/bin/bash
set -e

echo "=== 蠢驴电竞陪玩派单管理系统 - 一键部署脚本 ==="

# 配置变量
PROJECT_DIR="/data/project/game-workspace"
BACKUP_DIR="/backup/chunlv"

# 1. 安装 Docker（如未安装）
if ! command -v docker &> /dev/null; then
    echo "[1/8] 安装 Docker..."
    curl -fsSL https://get.docker.com | sudo bash
    sudo usermod -aG docker $USER
fi

# 2. 安装 Node.js 和 pnpm
if ! command -v node &> /dev/null; then
    echo "[2/8] 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v pnpm &> /dev/null; then
    echo "安装 pnpm..."
    npm install -g pnpm
fi

# 3. 克隆代码
echo "[3/8] 拉取代码..."
git clone <repository-url> "$PROJECT_DIR" || true
cd "$PROJECT_DIR"
git pull

# 4. 安装依赖
echo "[4/8] 安装项目依赖..."
pnpm install

# 5. 配置环境变量
echo "[5/8] 配置环境变量..."
if [ ! -f apps/server/.env ]; then
    cp .env.example apps/server/.env
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    # 注意：手动替换 key 值，或使用 sed
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" apps/server/.env
    sed -i "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" apps/server/.env
fi

# 6. 启动数据库
echo "[6/8] 启动数据库容器..."
docker compose -f docker/docker-compose.yaml up -d
sleep 5

# 7. 初始化数据库
echo "[7/8] 初始化数据库..."
pnpm db:migrate

# 8. 构建并启动应用
echo "[8/8] 构建并启动应用..."
pnpm build

# 配置 Nginx
if command -v nginx &> /dev/null; then
    echo "Nginx 已安装，请手动配置前端静态文件服务"
fi

echo "=== 部署完成 ==="
echo "后端地址: http://localhost:3001"
echo "健康检查: curl http://localhost:3001/api/health"
```

---

## 附录 B：常用运维命令速查

```bash
# === 数据库 ===
docker compose -f docker/docker-compose.yaml up -d     # 启动数据库
docker compose -f docker/docker-compose.yaml down       # 停止数据库
docker compose -f docker/docker-compose.yaml logs -f     # 查看数据库日志
docker exec -it chunlv-postgres psql -U postgres chunlv # 进入 psql

# === 应用 ===
pm2 status                          # 查看所有进程
pm2 logs chunlv-server              # 查看日志
pm2 restart chunlv-server           # 重启
pm2 monit                           # 实时监控

# === 构建 ===
pnpm build                          # 完整构建
pnpm build --filter @chunlv/server  # 仅构建服务端
pnpm build --filter @chunlv/web     # 仅构建前端

# === Nginx ===
sudo nginx -t                       # 检查配置
sudo systemctl reload nginx          # 重载
sudo systemctl restart nginx         # 重启
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# === 备份 ===
docker exec chunlv-postgres pg_dump -U postgres chunlv | gzip > backup.sql.gz
docker exec -i chunlv-postgres psql -U postgres chunlv < backup.sql
```

---

> 如有问题，请参考项目 [README.md](../README.md) 和 [CLAUDE.md](../CLAUDE.md) 获取更多技术细节。
