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
  - [5.6 看门狗服务（SystemHelper）更新](#56-看门狗服务systemhelper更新)
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

### 3.4.1 ⚠️ 云服务器上「改了 schema 一定要重新生成 Prisma Client」

**这是踩过的坑，会直接让线上报 500**（例：新增 `StudioConfig` 表后，
接口报 `Cannot read properties of undefined (reading 'findMany')`）。

云服务器的部署流程只上传 `apps/server/dist`，**不会**重建 Prisma Client。
所以只要动了 `apps/server/prisma/schema.prisma`，除了在数据库建表，还必须：

```bash
# 1) 把新的 schema 传上去
scp apps/server/prisma/schema.prisma ubuntu@1.117.229.36:/home/ubuntu/chunlv/apps/server/prisma/schema.prisma

# 2) 在服务器上重新生成客户端（否则 prisma.<新模型> 是 undefined）
ssh ubuntu@1.117.229.36 'cd /home/ubuntu/chunlv/apps/server && ./node_modules/.bin/prisma generate'

# 3) 重启服务端
ssh ubuntu@1.117.229.36 'pm2 restart chunlv-server --update-env'
```

建表语句本身按本项目的老路子是**手工在库里执行**（`apps/server/prisma/migrations/<时间戳>_xxx/migration.sql`
里的 SQL 用 `psql` 跑一遍；线上 `_prisma_migrations` 没有登记，不用 `migrate deploy`）。

### 3.4.2 2026-09-29 那次改表（`OrderTransfer`）要在库上手工跑一遍

「抢单超时自动回收删除 + 转让订单」加了新表 `OrderTransfer`。云服务器上仍然按老路子：

```bash
# 1) 在服务器上把 migration.sql 跑进库（线上没有 _prisma_migrations，不用 migrate deploy）
scp apps/server/prisma/migrations/20260929233000_add_order_transfer/migration.sql \
    ubuntu@1.117.229.36:/home/ubuntu/_ops.sql
ssh ubuntu@1.117.229.36 "sudo docker cp /home/ubuntu/_ops.sql chunlv-postgres:/tmp/_ops.sql && \
  sudo docker exec chunlv-postgres psql -U postgres -d chunlv -v ON_ERROR_STOP=1 -f /tmp/_ops.sql"

# 2) 按 3.4.1 重新生成 Prisma Client 并重启（脚本 _deploy_server_cloud.py 会自动做这两步）
python scripts/_deploy_server_cloud.py
```

自检：`select to_regclass('public."OrderTransfer"')` 应返回 `"OrderTransfer"`；
陪玩端点一次「转让」应返回 201/200 并在库里看到一行 `OrderTransfer`。

> 交付前自检：拿一个新模型跑一次 `GET` 接口。如果报 `undefined (reading 'xxx')`，
> 十有八九就是这一步忘了做。

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

### 4.3 发版不要打断陪玩（重要）

陪玩正在接单时，服务端重启 / 客户端刷新会被当成「掉线」。目前有三道保护，发版时请一起遵守：

1. **前端构建号只跟真实产物走。** 客户端判断「有没有新版前端」看的是服务端下发的 `webBuildId`，
   它取自 `apps/server/web-dist/index.html` 里引用的 `assets/index-<hash>.js`。
   所以**只重启服务端不会让客户端刷新**；只有真的发布了新前端产物（hash 变了）客户端才刷一次。
   （历史坑：以前这里下发的是进程启动时间，重启一次全体客户端就整页刷一次。）
2. **客户端刷新的三道闸**（`apps/web/src/layouts/AppLayout.tsx`）：心跳带回 `inService=true`
   （该陪玩有进行中的服务）时不刷；页面打开 120 秒内不刷；同一浏览器 5 分钟内最多自动刷一次。
   正在接单的陪玩不会被刷新打断，他会在服务结束后、下一轮心跳时才更新。
3. **部署脚本会跳过无意义重启。** `python scripts\_deploy_server_cloud.py` 先比对 dist 内容指纹，
   内容一样就只输出 `dist 内容没变…跳过重启`，不动已经连上的客户端；确实要强推时加 `--force`。

另外仍建议：**把同一天的多次改动合并成一次发版**，并避开发单高峰期连续重启。

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

### 5.6 看门狗服务（SystemHelper）更新

**陪玩端和客服端电脑上都常驻同一个 Windows 服务 `SystemHelper`**（源码 `apps/watchdog-service/`，纯 Go）：
开机拉起客户端、客户端没了自动重启、清理残留进程、执行客户端自动更新、装坏了自动整包重装。
日志在 `C:\Program Files\SystemHelper\service.log`，启动那行就写着当前构建号：

```
2026-09-30 21:39:07 [INFO] SystemHelper service starting (build 2026-09-30.2 / 2026093002)
```

**当前线上构建号：`2026-09-30.2` / `2026093002`**（陪玩端 `1.0.20260932` 与客服端 `1.0.20260935`
两个更新包里带的都是这一份）。看门狗二进制 md5 `463f9f340cab9f822dd6c31cbb4b905c`，9,764,352 字节；
`/uploads/SystemHelper.exe` 与两个更新包里的 `win-unpacked\resources\SystemHelper.exe` 已核对一致。

**看门狗认「本机身份」（2026-09-30 修根）。** 老看门狗只认 `陪玩管理.exe` / `蠢驴电竞.exe`，
搜索目录也只认 `陪玩管理` / `@chunlvcompanion-electron` / `蠢驴电竞`，于是**客服机上它守的是
「当年装过、没删干净的那个陪玩端」**：客服端崩了没人拉、桌面图标被摆成陪玩端，更麻烦的是
客服端的更新信号会被解压进陪玩端目录（等于把人家客户端换掉）。现在装机时
`SystemHelper.exe install --client=cs|companion` 会把自己的身份写进
`C:\ProgramData\chunlv\watchdog-client.txt`；看门狗按身份认领客户端（另一类只做兜底），
云端更新包地址、默认安装目录、本机更新包文件名（`update.zip` / `update-cs.zip`）也按身份分开。
**客服机上这个文件里必须是 `cs`**，写错了它就会去守陪玩端（邵泽慧那台 `192.168.1.4` 当时就是这个毛病）。
临时修法：`sc stop SystemHelper` → `sc delete SystemHelper` → 覆盖新的
`C:\Program Files\SystemHelper\SystemHelper.exe` → 写身份文件 → `sc create SystemHelper
binPath= "..." start= auto obj= LocalSystem` → `sc start SystemHelper`。

排查「客户端闪退 / 起不来」时先看这个文件，关键词：`Adopted running client`（接管了已在跑的客户端）、
`Killed N client processes`（杀进程）、`Client exe not found`（找不到客户端程序）、
`restoring from`（用本机安装包自动补齐客户端）、`repair done`（整包自愈重装，日志里会打出最终落地的 exe 路径）、
`rolled back`（更新后客户端没在 5 分钟内自报健康，已整目录回滚并把该版本拉黑）、
`client health marker seen`（客户端自报健康，这次更新算成功、回滚警报解除）。

#### 5.6.1 更新为什么改成「原子换目录」（2026-09-23 修根）

2026-09-23 老板报「陈佳祺双击桌面图标没反应」，挖出来是两个叠在一起的根因：

1. **服务端下发更新包会塞进烂字节**（`apps/server/src/common/throttled-file.ts`）：限速下发复用了同一个
   64KB buffer，`res.write()` 遇到背压时那块内存是按引用挂进发送队列的，下一轮 `readSync` 把还没发出去的
   上一块覆盖掉 —— 现象是**字节数一个不差、内容全是错的**（同一台机器连下两次，md5 各不相同、解压报
   `invalid data`）。已修：每块单独分配内存；修复后实测整包 md5 与服务器上的文件一致。
2. **老看门狗「边下边盖」**：逐文件覆盖、失败只 warn 不 fail-fast，包烂了照样报「更新成功」，
   于是安装目录里留下 0 字节 dll、`zh-CN.pak` 只剩 8KB、中文名 exe 变成 `????????.exe`
   （GBK 文件名的 zip 被按 UTF-8 解），客户端从此谁都点不开。

现在的更新流程（`2026-09-23.3` 起）：

```
下载整包 → 解压到客户端旁边的 .chunlv-new-<时间> → 校验（resources/app.asar > 1MB、客户端 exe > 10MB）
  → 整个目录换过去（旧目录留 <客户端目录>.bak-<时间>）→ 等客户端把 C:\ProgramData\chunlv\client-healthy.json 写出来
  → 5 分钟内写到 = 更新成功；等不到 = 整个目录回滚 + 把该版本写进 blocked-versions.json 拉黑 + 回传云端
```

配套改动：客户端（陪玩端 `1.0.20260930` 起）每分钟写一次健康标记，看门狗据此判断「这次更新到底跑起来没有」；
被本机拉黑的版本不再下载（否则回滚到旧版后每 30 分钟又把自己更新坏一次）；客户端自己不再跑 NSIS 安装器
（老路会删目录、杀进程），更新包一律交看门狗。另外：找不到客户端 exe / 刚拉起就死（30 秒内 3 次）/
活着 3 分钟不自报健康 → 看门狗整包自愈重装并重建桌面快捷方式；`.chunlv-new-*` / `.bak-*` /
`.chunlv-broken-*` 这些目录不再当成客户端目录（多目录时以前会认错）。
这条链路做过本机端到端演练：坏包回滚 + 拉黑 ✓、假客户端崩溃自愈 ✓、把 exe 改成乱码名后自愈成功 ✓。

**改服务代码后的标准流程：**

1. 改 `apps/watchdog-service/main.go` 顶部的三个构建号（必须一起加，只升不降）：
   `serviceBuild`（如 `2026-09-20.4`）、`serviceBuildNumber`（如 `2026092004`）、
   `buildTagLiteral = "CHUNLV_WATCHDOG_BUILD=2026092004"`。
2. 编译：`cd apps/watchdog-service && go build -o SystemHelper.exe .`
3. 上传云端：`python scripts\_upload_sh_cloud.py`（传到 `1.117.229.36:3001/uploads/SystemHelper.exe`）。
4. 批量下发：`python scripts\_push_watchdog_all.py`（逐台下载→停服务→换文件→起服务，并回读新构建号；
   只重启看门狗服务，不会打断正在接单的客户端）。
5. 单台手工装了算：把 `SystemHelper.exe` 放到客户端安装目录的 `resources\` 下，或直接在目标机跑
   `deploy\install-watchdog.bat`（会从云端下载并重建服务）。

**⚠ 改完看门狗必须同时更新两个「客户端更新包」里的那一份。** 更新包（陪玩端 `chunlv-latest.zip`、
客服端 `chunlv-cs-latest.zip`）里的 `win-unpacked/resources/SystemHelper.exe` 是「重装客户端 /
从 zip 恢复」时唯一会落地的那份二进制，只更新 `/uploads/SystemHelper.exe` 是不够的 —— 2026-09-20
就吃过这个亏：更新包里仍是老看门狗，凡是从 zip 恢复过的电脑装完继续闪退。收尾动作：

```powershell
# 1) 两个打包目录里的那一份都换成刚编译的二进制
copy apps\watchdog-service\SystemHelper.exe apps\companion-electron\release\win-unpacked\resources\SystemHelper.exe
copy apps\watchdog-service\SystemHelper.exe apps\cs-electron\release\win-unpacked\resources\SystemHelper.exe
# 2) 陪玩端更新包：重打包 + 上传（这个脚本只重打陪玩端，不动版本号）
python scripts\_repack_client_zip.py
# 3) 客服端更新包：跟着发一次版走（重打 zip + 上传 + 写 cs.latest_version / cs.latest_zip_url）
python scripts\_publish_cs_client.py <比线上更大的版本号>
# 4) 校验：包内那份必须带新构建号
python -c "import zipfile,re;d=zipfile.ZipFile(r'apps/companion-electron/release/chunlv-latest.zip').read('win-unpacked/resources/SystemHelper.exe');print(len(d),re.findall(rb'CHUNLV_WATCHDOG_BUILD=[0-9.]+',d))"
```

> ⚠️ 注意：`_repack_client_zip.py` **只管陪玩端**，客服端那个 zip 只能靠「再发一次版」重打
> （`_publish_cs_client.py` 会在打包前把最新看门狗复制进 `cs-electron/release/win-unpacked/resources/`）。
> 所以发客服端版本前，先确认
> `apps\cs-electron\release\win-unpacked\resources\SystemHelper.exe` 已经是新编译的那一份，
> 否则客服机静默更新落地的是老看门狗。

**看门狗自更新：** 服务启动时、以及每次客户端更新解压完成后，都会拿客户端目录里的
`resources\SystemHelper.exe` 与自身比构建号，比自己新就替换（旧文件留 `.old` 兜底），下次服务启动生效。
所以客户端发版能顺手把看门狗一起带下去，不用再一台台手工装。

### 5.7 单台电脑「客户端打不开 / 双击图标没反应」一键修复

陪玩或客服报「客户端打不开、双击桌面图标没反应」，且服务器日志里完全看不到这台机器的登录请求时，
基本是这台电脑的客户端文件被更新坏了（包烂 / 目录里只剩 0 字节文件 / 中文名 exe 变乱码 / 快捷方式指错）。
在**这台电脑**上右键「以管理员身份运行」：

```
http://1.117.229.36:3001/uploads/repair-companion.bat
```

脚本源码 `scripts/repair-companion.ps1` + `scripts/repair-companion.bat`（bat 只是壳：用 `fltmc` 判管理员
——不依赖 `net.exe`，有的机器 PATH 里那个 `net` 是别的工具、会把管理员误判成没权限；每次用随机临时脚本名，
免得上一份被杀的杀毒软件锁着；下载完先校验字节数）。跑一次做九件事：

1. **先把这台机器配成「可远程维护」**：建 / 补齐 `chunlvops`（管理员组、14 位随机密码、密码永不过期）
   → 打开远程管理通道（`LocalAccountTokenFilterPolicy` / `LimitBlankPasswordUse` / `LanmanServer` /
   文件共享防火墙）→ 把「主机名 + IP + MAC + 账号 + 密码 + 修复前版本」回传 `/api/agent/onboard-report`。
   为什么要带上这一步：2026-09-24 秦伟杰那台（`192.168.0.127`）**从来没跑过装机脚本**，
   本机没有 `chunlvops`、也没开远程管理通道，我们连不进去也看不到现场，只能干等人在电脑前。
   **已经配好的机器不动密码**（回传里是 `accountEvent=kept`）：改密码会把我们本来能用的那把换掉，
   万一回传失败反而彻底进不去。回传失败时脚本会当场把账号密码打在窗口里，让陪玩转给管理员；
   回传的密码落在 `onboard-reports/machines.jsonl`（公网下不到），现场回传（`repair-onboard`）
   只带「账号有没有建好」、**不带密码**（诊断是明文落盘的）。局域网地址按「到云服务器的实际出口网卡」
   取（`Find-NetRoute`），免得 VMware / VirtualBox 的虚拟网卡抢答、把错地址当成这台机器的地址。
   已经配好的机器这一步几秒钟就过，不影响后面修复。
  **2026-09-30 补的一个根因**：早期 `chunlv-allinone.nsi` / `setup-remote-access.nsi` 是用
  `net user chunlvops <口令> /add` 建的账号，**没设「密码永不过期」**，账号跟着本机密码策略到期；一到期
  Windows 就拒绝一切远程登录（RPC / WMI / 事件日志全挂），机器就永久失联、连现场都看不到（邵泽慧那台
  `192.168.1.4` 就是这么来的）。所以：两个 `.nsi` 建完账号立刻 `Set-LocalUser -Name chunlvops -PasswordNeverExpires $true`；
  上面这条「不动密码」的分支也**补上到期标志**（只改标志、不动口令，改了回传 `accountEvent=kept-expiry-fixed`）。
2. 回传现场到云端（见 5.7.1）；
3. 下载完整更新包（限速接口 `/api/agent/download/latest` 失败自动换直链 `/uploads/chunlv-latest.zip`）；
4. 校验：.NET `ZipFile`（按 UTF-8 解中文名）→ `Expand-Archive` → `tar.exe` 三种解压方式依次试，
   哪一种解出完整客户端才算过（**不要**拿 `tar` 当主路径：bsdtar 会把中文名解成乱码并中途失败）；
5. 换新：先试「旧目录改名 → 新目录顶上」（旧目录留 `.broken-<时间>`，不删）；整个目录改不了名时
   （系统 / 杀毒软件按住目录不放，但目录里的文件能读能写）退一步「整目录复制留底 → 覆盖着铺进去」，
   覆盖前先确认客户端 exe 写得动，写不动就**中止**（本机一个文件都不动）；
6. 停用其它目录里的旧客户端（含乱码名的大 exe），免得下次开机又被拉起来；
7. 装最新看门狗服务（`/uploads/SystemHelper.exe`）；
8. 重建桌面快捷方式（所有用户桌面 + 公共桌面）；
9. 拉起客户端，再回传一次现场。

顺带把客户端配置里的 `serverUrl` 改回云端（原文件留 `.bak`）——2026-09-03 邵泽慧那台机器就踩过
「配置指向已下线老服务器 → 客户端一条请求都发不出来」。
跑完看 `C:\Program Files\SystemHelper\service.log` 最后几行，确认构建号与 `Adopted` / `repair done` 记录；
管理端「陪玩电脑」页上这台机的版本应变成**当前线上最新号**（截至 2026-09-30 是 `1.0.20260932`）、心跳在 0~1 分钟内恢复。
`repair-companion.ps1 -DiagOnly` 只回传现场、本机一个文件都不动（先看情况再决定时用）。

**专门的蓝屏取证入口（2026-09-30 新增）：** `http://1.117.229.36:3001/uploads/bsod-report.bat`
（源码 `scripts/report-bsod.ps1` + `scripts/取蓝屏报告.bat`，英文名副本 `bsod-report.bat`）。跑一次做两件事：
① 取证 `BugCheck 1001` / `Kernel-Power 41` / `6008` / `4101` / `WHEA-Logger` / `C:\Windows\Minidump`
（含从转储里抠出的驱动 / 模块名） / WER 内核报告的 `BugcheckCode` / 显卡驱动版本 / 反作弊与安全软件 /
客户端与看门狗日志尾部 / 最近 24h 严重错误；② 把 `chunlvops` 修好（重设密码 + 永不过期）。回传
`/api/agent/onboard-report` + `/api/agent/diag-report`，报告落 `onboard-reports/diag/<机器名>-<时间>-bsod-report.log`
（公网下不到，只有管理员能看）。自检开关 `-NoRemoteFix` / `-NoUpload` / `-NoPause` 用于干跑。
两个必须记住的坑（2026-09-30 实测踩过）：脚本文件**必须带 UTF-8 BOM**，否则 Windows PowerShell 5.1 按 GBK
读中文会直接把脚本读成语法错；日志只读「真日志」（客户端 `logs\*.log` + 看门狗 `service.log`），
别整目录递归 `*.log` —— Electron 的 `Local Storage` / `Session Storage` 里也有 `.log`，是 LevelDB 二进制。
**「跑到一半被关掉」不会再让机器变半死：** 修复流程要换目录就必须先把看门狗服务停掉，所以停掉之后
立刻装一层保险 -- 写一个标记文件（`C:\ProgramData\chunlv\repair-active.txt`）+ 起一个盯着它的小进程
（`chunlv-watchdog-guard.ps1`）：标记一消失、或最多等 45 分钟，就确认看门狗在跑、不在就把它拉起来；
正常跑完和四条中止路径都会主动撤掉标记。2026-09-24 秦伟杰那台就是第一次跑到一半被关掉，
看门狗被留下「已停止」、客户端再也没人拉，看起来完全就是「又坏了」-- 现在这种「修了一半」的状态
自己会恢复（正常跑完十几秒，被硬关掉最多 45 分钟）。别在中途关窗口依然是建议，但关了也不会留坑。

`-ForceOverwrite` 跳过「目录改名」直接走覆盖方式 —— 给那些**整个目录改不了名**的机器用
（2026-09-24 实测 3 台：改名一律「访问被拒绝」，同样的调用下目录里的文件却读写自如；
覆盖方式会先把旧目录整份复制留底，再铺新文件）。
铺完还会拿安装目录里的客户端 exe 跟**包里那一份**比字节数（期望值必须在搬 / 拷之前量好 ——
2026-09-24 修过一次「量错时机」，改名方式下必然判成大小不对、把刚铺好的新客户端整体回滚；覆盖方式不受影响），
不一致就从留底复制回去，绝不留下「半新半旧」的安装目录。

`deploy\repair-client.bat` 是**老脚本**，已在文件头标记废弃（它还留着「逐文件覆盖」那套老做法，
正是这次把客户端更新成半残的写法），别再用它、别往它里面加逻辑，统一走上面的 repair-companion。

**客服端（客服管理.exe）有同款的一键修复：** `http://1.117.229.36:3001/uploads/修复客服端.bat`
（英文名副本 `repair-cs.bat`，源码 `scripts/repair-cs.ps1`）。做的事和上面的 `repair-companion`
一一对应（先开通远程管理 + 回传现场 → 校验解压 → 换目录 → 装看门狗 → 重建快捷方式 → 拉起客户端），
两处不一样：安装目录写死 `C:\Program Files\客服管理`，并顺手清掉老目录 `@chunlvcs-electron`；
看门狗那一步走 `install --client=cs`（见 5.6 的「本机身份」），日志与回传台账里都带 `watchdog=` 状态。
**还没有看门狗的老客服机，走一遍它就彻底进入自动更新，之后不用再点任何授权。**

#### 5.7.1 现场诊断回传（`POST /api/agent/diag-report`）

看门狗与一键修复脚本都会把现场写到 `onboard-reports/diag/<主机名>-<ISO 时间>-<来源>.log`（仓库根目录，
**不在 `/uploads` 下、公网下不到**），内容有安装目录、exe 大小与 PE 头、桌面快捷方式指向、服务状态、日志尾部。
人不在那台电脑旁边时，读这个文件就能判断「目录里是什么、谁在拦、卡在哪一步」：

```bash
ssh ubuntu@1.117.229.36 "ls -t ~/chunlv/onboard-reports/diag/ | head; tail -n 60 ~/chunlv/onboard-reports/diag/<文件>"
```

### 5.8 客户端发版（陪玩端 / 客服端）

两个桌面客户端是**各自独立**的发布链路，别混：陪玩端在 `apps/companion-electron`，
客服端在 `apps/cs-electron`，服务端各读一组版本号（`agent.latest_*` / `cs.latest_*`）。

**客服端（客服管理.exe）：**

```powershell
# 1) 改 apps/cs-electron/package.json 的 version（必须比线上大，否则白传 73MB）
# 2) 打包（Electron 30 + nsis 都在本机缓存里，可离线打）
cd apps\cs-electron; npx electron-builder
# 3) 上传装机包 + 更新整包 zip + 写 cs.latest_version / cs.latest_download_url / cs.latest_zip_url
cd ..\..; python scripts\_publish_cs_client.py <版本号>
```

> ⚠️ **打包清单：主进程运行时读的文件必须写进 `extraResources`。**
> electron-builder 只会把 `files` / `extraResources` 里列出的东西放进安装包，代码里能读到的路径不代表
> 装机后还存在。2026-09-26 的「客服端右下角没有托盘图标」就是这么来的：托盘读
> `process.resourcesPath/donkey.ico`，但 `extraResources` 只打包了 `config.json`；
> 而 `nativeImage.createFromPath()` 在文件不存在时**不报错、只返回空图片**，于是图标是透明的、
> 日志里也什么都没有。新增任何运行时资源（图标 / 配置 / 外部 exe）时，先确认 `extraResources` 里有它，
> 并尽量在代码里 `fs.existsSync` + `nativeImage.isEmpty()` 双检、再给一个兜底。

客服端有**两条**更新路径（2026-09-30 起）：**带看门狗的机器走静默整包** —— 下载
`chunlv-cs-latest.zip`（`/api/agent/download/cs-zip`）→ 写 `C:\ProgramData\chunlv\update-cs.zip` →
写 `update.json` → 客户端自己退出 → 看门狗（系统权限）解压换装并拉起客户端，**全程不弹 UAC**；
**还没装新看门狗的老机器**退回原来的 NSIS 装机包（`/api/agent/download/cs`），那条路要人点一下 UAC。
`/api/agent/cs-version` 两个地址都会返回（`downloadUrl` = 装机包、`zipUrl` = 整包）；
**`downloadUrl` 必须一直指向装机包**，老客户端只认它。
客户端启动后 20 秒~2 分钟之间（随机错峰）查一次 `/api/agent/cs-version`；**只有「服务端版本
严格大于本机版本」才更新**，所以版本号漏改的表现是「发布成功但一台机器都不升级」；
`_publish_cs_client.py` 会在版本不递增时直接中止。发完自查三件事：

```bash
curl -s http://127.0.0.1:3001/api/agent/cs-version          # version 是新号，且带 zipUrl
curl -sI http://127.0.0.1:3001/api/agent/download/cs        # 200 且 Content-Length = 装机包大小
curl -sI http://127.0.0.1:3001/api/agent/download/cs-zip    # 200 且 Content-Length = 更新整包大小
```

管理端「客户端版本上报」页（`GET /api/agent/cs-version-status`）按客服心跳里的版本号显示谁还没升上来，
并标注**这条心跳是哪个客户端报的**（`clientKind`：`cs` / `companion`）。

> ⚠️ **别把「陪玩端」那一行当成客服端没升级**（2026-09-30 踩过）：老板 / 店长用的是**陪玩端**窗口，
> 陪玩端页面照样会发 `cs-heartbeat`（只有陪玩角色的账号才走 WebSocket），报的是**陪玩端**版本号。
> 以前那一页照单全收，于是「黄浩 未更新 / hanlei1 未更新」这种假警报把真问题淹没了 ——
> 实查黄浩那台电脑上根本没装客服端。现在页面会标出客户端类型，并显示心跳来源 IP
> （`cs.client.version.<userId>` 里存 `ip`，老客服端不上报机器指纹，至少知道「人在哪台机器」）。

客服端版本号查询间隔是 30 分钟，**不要**为了催更新去重启客服电脑 —— 后台「推送更新」可以直接下发。
**1.0.20260935 起**客服端自己带看门狗 + 静默更新（`repair-cs.bat` 一次性引导），不会再停在老版本；
更早的老客户端（没有 `machine-agent`、自更新还要点 UAC）在管理端「机器管理」里根本看不见，
只能人工在那台电脑上双击一次 `修复客服端.bat`，之后也是全自动。

> ⚠️ **装机脚本 `installer.nsh` 的注释里别写 `${...}`**：要表达安装目录就写 `$INSTDIR`，或者干脆写中文
> 「安装目录」—— 注释里带了 `${...}`，`makensis` 会报「warning 6000: unknown variable」并直接失败
> （2026-09-30 踩过一次）。另外中文 `productName` 过不了 electron-builder 的 ASCII 校验，`$INSTDIR`
> 会被 `initMultiUser` 覆盖成包名目录 `@chunlvcs-electron`，所以 `preInit` / `customInit` 里都要把
> 安装目录写死成 `$PROGRAMFILES64\客服管理`（老目录里的客户端要一起清掉，免得被看门狗找到又拉起来）。

**陪玩端（陪玩管理.exe）：**

```powershell
cd apps\companion-electron
Copy-Item dist-electron/preload.js preload-dist/preload.js -Force   # 打包前必须同步一次
npx electron-builder                                                 # 产出 release\陪玩管理 Setup <版本号>.exe
cd ..\..; python scripts\_publish_client.py <版本号>                  # 更新包 zip + 装机包 + 版本号一起发
```

陪玩端有两条更新路径：**自动更新包**（`uploads/chunlv-latest.zip`，走限速接口
`/api/agent/download/latest`，由看门狗整目录换新 + 校验 + 回滚，见 5.6.1）和**装机包**（`uploads/agent-setup.exe`，
新电脑走 `/api/agent/download/exe`）。`_publish_client.py` 两个都发，漏发装机包会让新装的机器一上来就是旧版本。
陪玩端接单中不执行推送更新（`electron/updater.ts`），所以铺开是逐步的，别急着判定「没生效」。

> ⚠️ **陪玩端也是同一套 `extraResources` 规矩：托盘图标 `public/donkey.png` 必须写在里面**
> （客服端那份教训见上面 5.8 客服端那段的 ⚠）。另外陪玩端 `electron/main.ts` 里
> **「关窗口 = 收进托盘」必须以托盘建成功为前提**：托盘没建出来还照旧隐藏窗口，人就在右下角
> 找不到图标、也再也叫不回窗口。2026-09-27 发 `1.0.20260931` 时把这两处都补齐了。

**发版前先确认装机目录里的看门狗是最新的**（见 5.6 那段 ⚠）：`_publish_client.py` 打的就是
`release/win-unpacked` —— `win-unpacked\resources\SystemHelper.exe` 是什么版本，包里就是什么版本。
改过看门狗就先跑一次 `python scripts\_repack_client_zip.py`（复制新二进制 + 重打包 + 上传 + 核构建号），再发版。
发完自查：`_publish_client.py` 会打印远端 md5 与版本号；再打开管理端「陪玩电脑」页，看版本号是不是新号
（客户端 30 分钟才查一次版本，铺开是逐步的，别急着判定「没生效」）。

**发布看门狗（`SystemHelper.exe`）只要四步**（2026-10-01 起不用再一台台去推）：

1. 改 `apps/watchdog-service/main.go` 里 `serviceBuild` / `serviceBuildNumber` / `buildTagLiteral` 三处构建号；
2. `cd apps/watchdog-service; go build -o SystemHelper.exe .`；
3. `python scripts\_upload_sh_cloud.py`（上传 `uploads/SystemHelper.exe`；脚本会先逐字节自检
   「构建号标记只有一处、且紧跟数字」，不合格直接拒绝上传），再把配置键
   `watchdog.latest_build` 改成新构建号；
4. **两个客户端整包也一起重打**：`python scripts\_repack_client_zip.py` + `python scripts\_repack_cs_zip.py`
   —— 重装 / 从 zip 恢复的机器才会拿到新看门狗（两个脚本都只重打包，不动版本号，不会触发全网更新）。

换到各台机器上靠三条路，按可靠性排：

1. **上报即自愈（最稳）**：机器一上报，服务端发现它的看门狗构建号对不上就自动补一条「开通远程管理」，
   脚本里含「顺手把看门狗换成云端最新」。只要登录账号是管理员就成（客服机 + 绝大多数陪玩机都是）。
   也可以人工点一下管理端「机器管理 → 开通远程管理」立刻触发。
2. **看门狗自己的云端自更新（现在是最靠谱的一条）**：每 30 分钟问一次云端头信息，变了才下载，构建号更新就原子换自己 +
   计划任务重启服务（`cloudSelfUpdateCheck`）。
   ⚠️ 2026-10-01 真因：它**本来就没坏**，坏在 `parseBuildNumber` 只取第一处匹配 ——
   而源码里那半截「标记常量」排在真标记前面、后面不是数字，于是永远读出空串、直接 return（连日志都不打）。
   2026-10-01 已修正（并把新构建做成「老看门狗也能读懂」），实测 4 台自己升上来了。
   **以后发布务必：`_upload_sh_cloud.py` 会自己拦** —— 上传前若发现新文件里「构建号标记」不是只有一处、
   或第一处后面不是数字，直接拒绝上传（两个 `_repack_*_zip.py` 同样）。别绕过这道闸门。
3. `scripts\_push_watchdog_all.py`（走 SMB/atexec，需要运维账号口令）：只在机器上的看门狗老得
   连构建号/自愈都认不出来时兜底。

重启看门狗服务**不打断接单**（日志里会打 `Adopted running client pid=…`），但换完之后记得复查
管理端「陪玩电脑」页那台的「看门狗版本」是不是新号。

### 5.9 远程机器台账与「一键诊断」（客服端 / 陪玩端通用）

老板 2026-09-30：所有客户端电脑（客服端 + 陪玩端 + 以后新招的人）都要能被远程查看 / 一键诊断。
**这些机器在各自的局域网里，云服务器直连不到**，所以链路是反过来做的：

```
客户端（主进程） ──每 5 分钟──▶ POST /api/agent/machine-report   → SystemConfig.client.machine.<machineId>
看门狗（SYSTEM） ──每 60 秒──▶ POST /api/agent/machine-report   → 同上（带 watchdogBuild + systemPoller）
看门狗（SYSTEM） ──每 60 秒──▶ GET  /api/agent/machine-tasks?as=system  ← 管理端排的任务
看门狗 / 客户端执行脚本 ─────▶ POST /api/agent/machine-task-result → onboard-reports/diag/*.log
```

**不依赖中继机**（老板 2026-09-06 定的：以后只开云服务器、不开中继器），也不需要在被控机器上开端口。
客户端没在跑 → 任务挂在队列里，等客户端起来自动执行；超 15 分钟没回来会被标失败（不会一直显示「执行中」）。

**任务由看门狗以 SYSTEM 权限执行（2026-10-01 起）。** 以前是客户端（登录用户身份）领任务，
于是「登录账号不是管理员」就白派 —— 2026-10-01 实拍：叶号那台 `WIN-20260311RKT` 登录账号不是管理员，
脚本第一行就是「是不是管理员: False」。现在看门狗（`SystemHelper`，LocalSystem 服务）也来领，
服务端**优先给看门狗**（`takeTasks` / `systemPollerAlive`：看门狗近 3 分钟报过 → 客户端的 `as=user`
请求就领不到）。好处：没人登录、登录的是普通账号、机器锁屏，任务照样能跑。
看门狗没升级到的老机器上，客户端那条路还在（能跑就跑，跑不了等看门狗升级）。

**看门狗自己也会跟云端升级。** 它每 30 分钟问一次 `/uploads/SystemHelper.exe` 的头信息，
变了才下载，构建号更新就原子换掉自己 + 让服务重启（`cloudSelfUpdateCheck`，构建号写在二进制里的
`CHUNLV_WATCHDOG_BUILD=…`）。所以**换看门狗不再需要人上门**；发新版只做两件事：
`python scripts\_upload_sh_cloud.py` 传新二进制，再把配置键 `watchdog.latest_build` 改成新构建号
（服务端据此判断「这台的看门狗是不是落后」，管理端「机器管理」也显示这个）。比「会自更新」更老的版本
（认不出构建号）得靠派一条「开通远程管理」任务把它带上来 —— 那条脚本里含这一步。

**台账的一行 = 一台机器。** 客户端和运维脚本算 machineId 的算法不一样（客户端按网卡枚举顺序取
第一块非虚拟网卡的 MAC，脚本按 `Get-NetAdapter | Status -eq 'Up'` 的第一块），所以**脚本上报时
按「主机名 + 主 IP」认领客户端那一行**（`machine.service.ts` 的 `pickCanonicalMachine`）——
只按主机名不行，局域网里有 4 台机器都叫 `User-20240831VS`。2026-09-30 之前这一点没做，
客服机 `PC-20230107AFUW` 就多出一行、`remoteReady` 也永远回填不到客户端那一行。
**自愈是自动的：** 客户端 / 看门狗一上报，服务端（`machine.service.ts` 的 `autoHeal`）就顺手看这台机器
缺什么 —— 远程管理没开通、或看门狗构建号跟云端对不上 —— 自动补一条「开通远程管理」任务
（远程管理最多每 6 小时一次、看门狗最多每 2 小时一次），执行者就是看门狗。管理端任务表里这类任务
「谁点的」显示紫色的「自动」。所以新招的人、新装的机器都不用任何人点。
另：这条脚本**本机留过档就沿用原来的运维口令**（`C:\ProgramData\chunlv\remote-account.txt`），
不会每次跑都换口令把管理端抄走的作废。

**存储**：复用 `SystemConfig(key/value jsonb)`，**没有新增表、没有 schema 迁移** ——
`client.machine.<machineId>` 是台账，`client.task.<taskId>` 是任务（只保留最近 400 条，旧的自动清）。
报告正文落 `onboard-reports/diag/`（和 `uploads` 同级，公网下不到）。

**诊断脚本在哪：** `apps/server/src/agent/client-diag.ts`（内嵌在服务端 dist 里下发，改完只需
`python scripts\_deploy_server_cloud.py`，**不用重发两个安装包**）。给一台机器手工取证用的副本是
`scripts/客户端诊断.ps1` / `客户端诊断.bat`，两处改动要同步（脚本正文用 `String.raw` 保存，
**不要出现 `${` 和反引号**，否则会被 TS 模板字符串吃掉）。

**开通远程管理的脚本：** `apps/server/src/agent/client-remote.ts`（同样服务端下发）。
两个安装包在 `!macro customInstall` 里都会现取一次这个脚本并执行
（`apps/cs-electron/build/installer.nsh`、`apps/companion-electron/build/installer.nsh`），
所以**新装的机器装完就是可远程维护的**。注意 NSIS 里 `#` 注释里不要写 `${...}`（要表达安装目录
就写 `$INSTDIR`，或者干脆写中文「安装目录」）—— 注释里带了 `${...}`，`makensis` 会报
「warning 6000: unknown variable」并直接失败（2026-09-30 踩过一次）。

**手工给存量机器开通 / 取证（管理员不用跑过去）：** 让那台电脑上的人双击

- `http://1.117.229.36:3001/uploads/客户端诊断.bat`（跑完报告自动回传）
- `http://1.117.229.36:3001/uploads/开通远程管理.bat`

**上线后自查（每项都能在服务器上验证）：**

```bash
# 1) 接口在不在（都应 200）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/agent/client-diag.ps1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/agent/enable-remote.ps1
# 2) 有几台机器报了（0 就是还没机器上报）
echo <口令> | sudo -S -p "" docker exec chunlv-postgres psql -U postgres -d chunlv -t -c \
  "SELECT count(*) FROM \"SystemConfig\" WHERE key LIKE 'client.machine.%';"
```

**注意：** 这些是**真实机器台账**，不是测试数据；自测造出来的行（`client.machine.*` / `client.task.*`）
和 `onboard-reports/diag/` 里的自测报告，验证完必须删干净（2026-09-30 的自测就是这么收尾的）。

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
