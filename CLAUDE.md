# CLAUDE.md — 蠢驴电竞陪玩派单管理系统

## Commands

```bash
pnpm install                 # Install all dependencies
pnpm dev:server              # Start Nest.js backend (port 3001)
pnpm dev:web                 # Start React frontend (port 5173)
pnpm build                   # Build all packages (shared → server → web)
pnpm db:migrate              # Run Prisma migrations
pnpm db:seed                 # Seed database with test data
docker compose -f docker/docker-compose.yaml up -d   # Start PostgreSQL + Redis
docker compose -f docker/docker-compose.yaml down    # Stop services
cd apps/agent && go build ./cmd/agent/               # Build Go Agent
```

## Architecture

```
Browser (React) ──HTTP──▶ Nest.js (Express) ──▶ PostgreSQL + Redis
                                  △
Go Agent (WebSocket) ─────────────┘
```

- **Monorepo:** pnpm workspaces (`apps/web`, `apps/server`, `apps/agent`, `packages/shared`)
- **Auth:** JWT dual-token (access 15min / refresh 7d), 4 roles (OWNER/ADMIN/CS/COMPANION), `RolesGuard`
- **Real-time:** Socket.IO gateway with JWT auth on connect, studio-based room grouping
- **API:** Nest.js on port 3001, `/api/*` prefix, CORS for localhost:8000/5173
- **Frontend:** React on port 8000, Apple-inspired light theme

## Key Files

| File | Purpose |
|------|---------|
| `apps/server/src/app.module.ts` | Root Nest.js module (imports all feature modules) |
| `apps/server/prisma/schema.prisma` | Database schema (11 models) |
| `apps/web/src/router.tsx` | All 14 frontend routes |
| `apps/web/src/theme.ts` | Ant Design custom theme config |
| `packages/shared/src/enums.ts` | Shared TypeScript enums used by all packages |
| `docker/docker-compose.yaml` | PostgreSQL 16 + Redis 7 |
| `docs/ARCHITECTURE.md` | Architecture diagrams (Mermaid) |
| `docs/DEPLOYMENT.md` | Deployment guide |
| `docs/USER_MANUAL.md` | User manual |

## Auto-Maintenance Rules

### After each feature/fix commit, MUST automatically:

1. **Update CHANGELOG.md:** Add the change under `[Unreleased]` using Keep a Changelog format. Group by Added/Fixed/Changed.

2. **Update README.md when:**
   - New endpoints → update API Reference table
   - New pages → update Project Structure
   - New features → update Recent Updates section
   - Dependencies change → update Tech Stack table

3. **Update docs/ when:**
   - New endpoints/features → `docs/ARCHITECTURE.md` (add to diagrams)
   - Deployment changes → `docs/DEPLOYMENT.md`
   - UI/workflow changes → `docs/USER_MANUAL.md`

4. **Auto-commit docs:** `git add` updated docs and commit as `docs: update documentation for <feature>`

### Commit convention (Conventional Commits):
```
feat: <description>     # New feature → Added section in CHANGELOG
fix: <description>      # Bug fix → Fixed section
chore: <description>    # Maintenance → Changed section
docs: <description>     # Documentation
refactor: <description> # Code refactoring
```

### Default accounts (seed data):

| Username | Password | Role |
|----------|----------|------|
| hanlei | 123456 | OWNER (second password: 888888) |
| kefu01 | 123456 | CS |
| zhangsan | 123456 | COMPANION |
