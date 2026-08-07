## 运行时
- **Runtime**: Node.js 20+ (Nest.js 10), Go 1.21+ (Electron agent sidecar)
- **Package Manager**: pnpm 9+ (workspaces monorepo)
- **Database**: PostgreSQL 16 (via Prisma ORM 5)
- **Cache**: Redis 7 (session, realtime state)
- **Real-time**: Socket.IO 4 (WebSocket with JWT auth on connect)

## 后端
- **Framework**: Nest.js 10 (Express/Fastify adapter)
- **Language**: TypeScript 5
- **ORM**: Prisma 5 (schema.prisma, migrations)
- **Auth**: @nestjs/jwt (dual-token: access 15min / refresh 7d), @nestjs/passport
- **Validation**: class-validator + class-transformer (DTO pipes)
- **File Upload**: multer (screenshots, contracts)

## 前端
- **Framework**: React 18 (Vite 5)
- **UI Library**: Ant Design 5 (Apple-inspired light theme)
- **State**: Zustand (chat store), React Query (server state)
- **Router**: React Router 6
- **Auth**: JWT stored in localStorage, axios interceptor for refresh

## 客户端 (Electron)
- **Desktop**: Electron 28+ (main.ts)
- **Local WebUI**: HTTP server on port 9876
- **System Control**: PowerShell (Windows), systemctl/tc (Linux)
- **Process Monitor**: PowerShell process enumeration + taskkill

## DevOps
- **Container**: Docker Compose (PostgreSQL + Redis)
- **Process Manager**: PM2 (chunlv-server, chunlv-web)
- **Reverse Proxy**: Nginx (SSL termination, /api/* → :3001, static → :8000)
- **Backup**: Cron pg_dump daily