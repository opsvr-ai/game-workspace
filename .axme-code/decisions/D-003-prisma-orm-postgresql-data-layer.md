---
id: D-003
slug: prisma-orm-postgresql-data-layer
title: Prisma ORM + PostgreSQL Data Layer
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# Prisma ORM + PostgreSQL Data Layer

数据层使用 Prisma ORM 连接 PostgreSQL 16，schema 定义 26 个模型覆盖用户、工作室、陪玩师、订单、客户、交易、考勤、进程管理等全部业务域。通过 PrismaModule 全局注入 PrismaService。数据库迁移必须通过 pnpm db:migrate (prisma migrate dev) 执行。

## Reasoning

prisma/schema.prisma 包含 26 个模型，覆盖完整的业务场景。PrismaModule 在 app.module.ts 中导入。docker-compose.yaml 提供 PostgreSQL 16 + Redis 7 环境。
