# 蠢驴电竞陪玩派单管理系统 — 架构说明

> 以图表形式阐述整个平台的系统架构、数据流转、业务流程和部署拓扑。

---

## 1. 系统全景架构

```mermaid
graph TB
    subgraph 客户端层
        BROWSER["🖥️ 浏览器<br/>管理端 / 客服端"]
        AGENT["🤖 Go Agent<br/>陪玩桌面端"]
    end

    subgraph 网关层
        NGINX["🔀 Nginx<br/>反向代理 / 静态资源"]
    end

    subgraph 应用层
        WEB["⚛️ React SPA<br/>Ant Design 5<br/>端口 :8000"]
        API["🟢 Nest.js API<br/>Fastify + TypeScript<br/>端口 :3001"]
        WS["📡 Socket.IO Gateway<br/>WebSocket 实时通道"]
    end

    subgraph 数据层
        PG[("🐘 PostgreSQL 16<br/>主数据库<br/>12 张表")]
        REDIS[("⚡ Redis 7<br/>缓存 / 会话")]
        DISK["📁 本地存储<br/>uploads/screenshots/"]
    end

    subgraph 陪玩PC
        LOCAL["🌐 本地 WebUI<br/>:9876<br/>计时 / 接单 / 模式切换"]
        TIMER["⏱️ TimeTracker<br/>WORK / ENTERTAINMENT"]
        NET["🌐 netctrl<br/>tc QoS 限速"]
        SYS["⚙️ sysctrl<br/>关机 / 重启"]
    end

    BROWSER -->|"HTTP :8000"| NGINX
    AGENT -->|"WebSocket"| WS
    NGINX -->|"/ 静态资源"| WEB
    NGINX -->|"/api/* 反向代理"| API
    API --> PG
    API --> REDIS
    API --> WS
    API --> DISK
    AGENT --> LOCAL
    AGENT --> TIMER
    AGENT --> NET
    AGENT --> SYS
```

## 2. 网络拓扑

```mermaid
graph LR
    subgraph 公网
        USER["👤 老板/管理员/客服<br/>任意浏览器"]
        CP["🖥️ 陪玩电脑<br/>Go Agent 客户端"]
    end

    subgraph 服务器
        NGINX["Nginx :80/443"]
        WEB["React :8000"]
        API["Nest.js :3001"]
        PG[("PostgreSQL :5432")]
        REDIS[("Redis :6379")]
        UPLOAD["uploads/"]
    end

    USER -->|"HTTPS :443"| NGINX
    CP -->|"WSS :443"| NGINX
    NGINX -->|"proxy_pass :8000"| WEB
    NGINX -->|"proxy_pass :3001"| API
    NGINX -->|"proxy_pass :3001"| UPLOAD
    API --> PG
    API --> REDIS
```

## 3. 核心业务流程

### 3.1 订单全生命周期

```mermaid
stateDiagram-v2
    [*] --> PENDING: 客服创建订单
    PENDING --> GRABBED: 陪玩抢单 (POOL)
    PENDING --> CONFIRMED: 指定派单 (DIRECT)
    PENDING --> CANCELLED: 客服取消
    GRABBED --> CONFIRMED: 陪玩确认接单
    GRABBED --> CANCELLED: 客服取消
    CONFIRMED --> DONE: 陪玩完成
    CONFIRMED --> CANCELLED: 客服取消
```

### 3.2 派单流程时序

```mermaid
sequenceDiagram
    actor CS as 客服
    participant API as Nest.js API
    participant WS as WebSocket
    participant CP as 陪玩 Agent
    actor ADMIN as 管理员

    CS->>API: POST /api/orders (POOL)
    API->>API: create order status=PENDING
    API->>WS: broadcastToStudio('order:pool_updated')
    WS-->>CP: order:new 推送

    CP->>API: POST /api/orders/:id/grab
    API->>API: validateTransition → GRABBED
    API->>WS: broadcastToStudio('order:pool_updated')
    WS-->>CS: 池更新通知

    CP->>API: POST /api/orders/:id/confirm
    API->>API: validateTransition → CONFIRMED

    CP->>API: POST /api/orders/:id/complete
    API->>API: validateTransition → DONE

    CP->>API: POST /api/transactions (报账)
    API->>API: create PENDING transaction

    ADMIN->>API: GET /api/transactions?status=PENDING
    ADMIN->>API: PUT /api/transactions/:id/approve
    API->>API: customer.totalSpent += amount
    API->>API: companion.monthlyRevenue += amount

    Note over ADMIN,CP: 踢下线流程
    ADMIN->>API: POST /companions/:id/kick
    API->>WS: sendCommand('kick')
    WS-->>CP: pc:command { command: "kick" }
    CP-->>CP: 断开连接并退出
```

### 3.3 报账审核流程

```mermaid
flowchart LR
    COMPANION["陪玩提交报账<br/>POST /api/transactions"] --> PENDING["PENDING<br/>待审核"]
    PENDING --> APPROVE["ADMIN 审核通过<br/>PUT /approve"]
    PENDING --> REJECT["ADMIN 拒绝<br/>PUT /reject"]
    APPROVE --> UPDATE["更新统计<br/>customer.totalSpent ↑<br/>companion.monthlyRevenue ↑"]
    REJECT --> END["REJECTED<br/>流程结束"]
```

## 4. 数据模型 ER 图

```mermaid
erDiagram
    User ||--o| Companion : "1:1"
    User }o--|| Studio : "belongs to"
    Studio ||--o{ Companion : "has"
    Studio ||--o{ Order : "has"
    Studio ||--o{ Customer : "has"
    Studio ||--o{ Expense : "has"
    Companion ||--o{ Order : "serves"
    Companion ||--o| CompanionPC : "controls"
    Companion ||--o{ CompanionTimeLog : "records"
    Companion ||--o{ Transaction : "submits"
    Companion ||--o{ Customer : "manages"
    Customer ||--o{ Order : "places"
    Order ||--o{ Transaction : "billed"
    CompanionPC ||--o{ PCOperationLog : "logged"

    User {
        uuid id PK
        string username UK
        string passwordHash
        string role "OWNER|ADMIN|CS|COMPANION"
        uuid studioId FK
        bool isAuthorized
        string secondPasswordHash
    }

    Studio {
        uuid id PK
        string name
    }

    Companion {
        uuid id PK
        uuid userId FK
        uuid studioId FK
        json games
        string status "ONLINE|IDLE|BUSY|OFFLINE"
        string billingCode UK
        float revenueShare
        float monthlyRevenue
    }

    Order {
        uuid id PK
        string type "NEW|RENEW|REPURCHASE|TIP"
        uuid studioId FK
        uuid csUserId FK
        uuid companionId FK
        uuid customerId FK
        string dispatchType "POOL|DIRECT"
        string status "PENDING|GRABBED|CONFIRMED|DONE|CANCELLED"
        float amount
        string gameName
    }

    Customer {
        uuid id PK
        uuid studioId FK
        uuid companionId FK
        string customerCode UK
        string wechatId
        float totalSpent
    }

    Transaction {
        uuid id PK
        uuid orderId FK
        uuid companionId FK
        float amount
        string paymentMethod
        string screenshotUrl
        string status "PENDING|APPROVED|REJECTED"
        uuid reviewedById
    }
```

## 5. 前端路由与角色权限

```mermaid
graph TB
    LOGIN["🔐 /login<br/>登录页"]

    LOGIN --> OWNER
    LOGIN --> ADMIN
    LOGIN --> CS

    subgraph OWNER["👑 OWNER 老板"]
        O1["/owner/revenue<br/>盈亏统计 ★"]
        O2["/owner/customers<br/>客户管理"]
        O3["/owner/employees<br/>员工管理"]
        O4["/owner/studios<br/>工作室管理"]
        O5["/owner/authorizations<br/>客户端授权"]
    end

    subgraph ADMIN["🛡️ ADMIN 管理员"]
        A1["/admin/dispatch<br/>派单管理"]
        A2["/admin/companions<br/>陪玩管理"]
        A3["/admin/customers<br/>客户管理"]
        A4["/admin/billing<br/>报账审核"]
        A5["/admin/revenue<br/>收入流水"]
        A6["/admin/pc-control<br/>远程控制"]
    end

    subgraph CS["💬 CS 客服"]
        C1["/cs/dispatch<br/>派单工作台"]
        C2["/cs/orders<br/>派单记录"]
        C3["/cs/companions<br/>陪玩状态"]
    end

    style OWNER fill:#e8f5e9
    style ADMIN fill:#e3f2fd
    style CS fill:#fff3e0
```

> ★ 盈亏统计需二级密码验证（5 分钟 secondToken）

## 6. WebSocket 事件流

```mermaid
sequenceDiagram
    participant AGENT as Go Agent
    participant GW as Socket.IO Gateway
    participant DB as PostgreSQL
    participant BROWSER as 浏览器 (CS/Admin)

    Note over AGENT,GW: 连接建立
    AGENT->>GW: connect ?token=JWT
    GW->>GW: JWT 验证
    GW->>GW: join studio:${studioId}
    GW->>GW: join companion:${companionId}
    GW->>DB: UPDATE companion.status=ONLINE
    GW-->>BROWSER: status:broadcast ONLINE

    Note over AGENT,GW: 心跳 (30s)
    loop 每 30 秒
        AGENT->>GW: companion:heartbeat
        GW->>DB: upsert CompanionPC
        GW->>DB: insert CompanionTimeLog
    end

    Note over AGENT,BROWSER: 订单推送
    BROWSER-->>GW: (CS 创建订单触发)
    GW-->>AGENT: order:new

    Note over AGENT,GW: 远程命令
    BROWSER->>GW: POST /companions/:id/command
    GW-->>AGENT: pc:command { shutdown/restart/throttle }
    AGENT-->>GW: pc:command_ack { success }
    GW->>DB: insert PCOperationLog

    Note over AGENT,BROWSER: 踢下线 (kick)
    BROWSER->>GW: ADMIN/OWNER 触发 kick
    GW-->>AGENT: pc:command { command: "kick" }
    AGENT-->>AGENT: 断开连接并退出进程
    GW->>DB: UPDATE companion.status=OFFLINE

    Note over AGENT,GW: 断开
    AGENT-->>GW: disconnect
    GW->>DB: UPDATE companion.status=OFFLINE
    GW-->>BROWSER: status:broadcast OFFLINE
```

## 7. 认证流程

```
老板创建陪玩(自动授权) → 陪玩输入账号密码 → Agent自动登录 → 在线
```

## 8. Go Agent 内部架构

```mermaid
graph TB
    subgraph main["main.go"]
        ENTRY["入口<br/>读取 AGENT_SERVER_URL<br/>AGENT_TOKEN"]
    end

    subgraph ws["wsclient"]
        WSC["WebSocket Client<br/>自动重连 5s<br/>心跳 30s"]
        CMDS["CommandChan<br/>接收 pc:command"]
        ORDERS["订单缓存<br/>SetLatestOrder"]
    end

    subgraph engine["engine"]
        TRACKER["TimeTracker<br/>WORK / ENTERTAINMENT<br/>计时引擎"]
    end

    subgraph http["httplocal"]
        HTTP_SRV["HTTP Server :9876<br/>GET /api/status<br/>POST /api/mode<br/>GET /api/orders/latest<br/>POST /api/orders/confirm<br/>POST /api/orders/complete"]
    end

    subgraph ctrl["netctrl + sysctrl"]
        NETCTRL_LINUX["throttle_linux.go<br/>tc qdisc tbf"]
        NETCTRL_WIN["throttle.go<br/>PowerShell QoS"]
        SYSCTRL_LINUX["commands_linux.go<br/>systemctl"]
        SYSCTRL_WIN["commands.go<br/>shutdown /s /r"]
    end

    subgraph webui["webui/"]
        UI["index.html<br/>模式切换<br/>计时显示<br/>订单通知"]
    end

    ENTRY --> WSC
    ENTRY --> HTTP_SRV
    ENTRY --> TRACKER
    WSC --> CMDS
    WSC --> ORDERS
    CMDS --> NETCTRL_LINUX
    CMDS --> NETCTRL_WIN
    CMDS --> SYSCTRL_LINUX
    CMDS --> SYSCTRL_WIN
    HTTP_SRV --> TRACKER
    HTTP_SRV --> WSC
    HTTP_SRV --> UI
    UI -.->|"fetch /api/*"| HTTP_SRV
```

## 9. 部署架构

```mermaid
graph TB
    subgraph VPS["☁️ 云服务器 (Ubuntu 22.04)"]
        subgraph Docker["Docker Compose"]
            PG_D["PostgreSQL 16<br/>:5432<br/>data: ./docker/data/postgres/"]
            REDIS_D["Redis 7<br/>:6379<br/>data: ./docker/data/redis/"]
        end

        subgraph App["应用服务 (PM2)"]
            API_P["chunlv-server<br/>node dist/main.js<br/>:3001"]
            WEB_P["chunlv-web<br/>vite preview<br/>:8000"]
        end

        NGINX_P["Nginx<br/>:80 / :443<br/>SSL 终端<br/>反向代理"]
        CRON["Cron<br/>pg_dump 每日备份<br/>00:00"]
    end

    subgraph Client["🖥️ 陪玩 PC (Windows)"]
        AGENT_EXE["agent.exe<br/>nssm Windows Service<br/>管理员权限"]
    end

    INTERNET["🌐 公网"] --> NGINX_P
    NGINX_P --> API_P
    NGINX_P --> WEB_P
    API_P --> PG_D
    API_P --> REDIS_D
    API_P --> DISK_P["uploads/screenshots/"]
    AGENT_EXE -->|"WSS"| INTERNET
    INTERNET -.-> NGINX_P
    CRON --> PG_D
```

---

> 图表使用 Mermaid 语法，支持 GitHub / VS Code / 多数 Markdown 渲染器直接预览。
