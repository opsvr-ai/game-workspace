## Structure

```
game-workspace/
├── apps/
│   ├── server/              # Nest.js 后端 (端口 3001)
│   │   ├── prisma/          # Schema + 种子数据
│   │   └── src/
│   │       ├── auth/        # JWT 认证 + 角色守卫
│   │       ├── studios/     # 工作室管理
│   │       ├── companions/  # 陪玩师管理
│   │       ├── customers/   # 客户管理
│   │       ├── orders/      # 订单管理
│   │       ├── billing/     # 账单管理
│   │       ├── dashboard/   # 仪表盘
│   │       ├── ws/          # WebSocket 实时通信
│   │       ├── agent/       # 陪玩端 PC 代理
│   │       ├── ai/          # AI 功能模块
│   │       ├── health/      # 健康检查
│   │       ├── process-blacklist/  # 进程黑名单管理
│   │       └── prisma/      # Prisma 服务
│   ├── web/                 # React 前端 (端口 5173/8000)
│   │   └── src/
│   │       ├── pages/       # 按角色分 admin/owner/cs/companion
│   │       ├── components/  # 共享 UI 组件
│   │       ├── stores/      # Zustand 状态管理
│   │       ├── hooks/       # 自定义 hooks
│   │       └── api/         # API 请求封装
│   └── companion-electron/  # Electron 陪玩端桌面应用
├── packages/
│   └── shared/              # 共享 TypeScript 类型/enum
├── docker/                  # Docker Compose (PG + Redis)
└── docs/                    # 文档 (ARCHITECTURE/DEPLOYMENT/USER_MANUAL)
```

**入口:** server main.ts | web main.tsx | shared index.ts