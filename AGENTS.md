# AGENTS.md — 蠢驴电竞陪玩派单管理系统

## 工作准则（最高优先级，先于一切任务）

这是用户明确要求、必须长期遵守的最基本干活方式：

1. **先验证链路，再动功能。** 动手修任何具体功能前，先确认整条交付链路是通的：
   `代码改动 → 打包 → 服务器部署 → 客户端自动更新 → 落地安装/目录`。
   链路没通，修再多功能都是白搭。
2. **修根，不修叶子。** 用户报多个症状时，先判断是不是同一个根因，一起挖到根、一起改。
   不要用户报一个就单独修一个，导致反复返工。
3. **自己先验证，少让用户重复试。** 能在服务端/后台/脚本里验证的，先自己验证完；
   只把用户真正必须手动点的那一步交给他，并给清晰清单，不要反复让他“再试一次”。
4. **改完必复查整条链路。** 每次交付前，用可验证的证据确认结果（部署成功、版本正确、
   目录正确、自动更新可完成），而不是口头说“应该好了”。
5. **提交、打包、发布、部署不必先问，直接做。**（用户明确要求，2026-09-19）
   只要**不影响陪玩正在接单**（接单中不打断、不强制更新），
   代码改完就自己提交、打包、发布、部署，并自己验证到底，不要反复问“要不要发”。
   具体：前端 `python scripts\_deploy_web_cloud.py` + `python scripts\_set_web_version.py vXXX`；
   服务端 `python scripts\_deploy_server_cloud.py`；客户端 `python scripts\_publish_client.py <版本号>`（安装包在
   `apps/companion-electron/release/win-unpacked`）。发布客户端后不要去强制推送（会打断接单），
   客户端自己每 5 分钟查一次版本，接单中会自动跳过。
6. **线上业务开关是老板的东西，脚本/自动化一律不许改。**（用户明确要求，2026-09-20）
   具体：`blacklist.auto_kill`（「自动结束黑名单进程」总开关）**只由老板在管理端手动拨动**；
   任何脚本、验证流程、维护/复位动作都不得把它改成别的值；测试必须先读原值、测完原样恢复。
   2026-09-20 就发生过两次「脚本顺手把它恢复成开」，把正在打游戏的陪玩进程杀掉，
   老板反复找不到原因。确实要临时改，先跟老板确认，改完回读确认并写进 CHANGELOG。

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
```

## Architecture

```
Browser (React) ──HTTP──▶ Nest.js (Express) ──▶ PostgreSQL + Redis
```

- **Monorepo:** pnpm workspaces (`apps/web`, `apps/server`, `packages/shared`)
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

## AXME Code

### Session Start (MANDATORY)
Call axme_context at the start of every session.
If it returns "not initialized": offer the user AXME setup, and on consent
EXECUTE the inline setup flow from axme_context / the server instructions
(a sequence of axme_save_decision / axme_save_memory / axme_update_safety /
axme_save_oracle tool calls). Do NOT try to run `axme-code` via the Bash
tool — on plugin installs it is not on PATH.
Do NOT skip — without context you will miss critical project rules.

## RTFM — Indexed Knowledge Base

This project has been indexed with RTFM.

For any **exploratory search** (finding which files/modules/classes are relevant
to a topic), use `rtfm_search` instead of Glob, find, ls, or broad Grep.
Then use `rtfm_expand` to read easily most relevant files/sections.
