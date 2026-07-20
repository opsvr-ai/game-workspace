## Patterns

- **API 前缀:** 所有后端接口使用 `/api/*` 前缀，CORS 允许 localhost:8000 和 localhost:5173
- **JWT 鉴权:** 双 Token (access 15min + refresh 7d)，Socket.IO 连接时验证 JWT
- **角色路由:** 前端按角色分组路由 `/owner/*`, `/admin/*`, `/cs/*`, `/companion/*`
- **Studio 隔离:** 所有数据查询按 studioId 过滤，Socket.IO 房间按 studioId 分组
- **状态机:** 订单 5 状态 (PENDING→GRABBED→CONFIRMED→DONE/CANCELLED)，陪玩师 5 状态 (AVAILABLE/BUSY/ENTERTAINMENT/RESTING/OFFLINE)
- **构建顺序:** shared → server → web（严格遵守）
- **数据库迁移:** 仅通过 `pnpm db:migrate` (prisma migrate dev) 执行
- **种子数据:** 3 个默认账号用于开发，通过 `pnpm db:seed` 初始化
- **Conventional Commits:** feat/fix/chore/docs/refactor，自动更新 CHANGELOG + README + docs/
- **PM2 部署:** `pm2 restart chunlv-server --update-env`，先 fuser -k 3001/tcp