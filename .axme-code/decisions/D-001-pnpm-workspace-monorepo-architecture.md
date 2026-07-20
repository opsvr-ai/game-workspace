---
id: D-001
slug: pnpm-workspace-monorepo-architecture
title: pnpm Workspace Monorepo Architecture
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# pnpm Workspace Monorepo Architecture

项目采用 pnpm workspaces 管理 monorepo，包含 apps/web (React 前端)、apps/server (Nest.js 后端)、packages/shared (共享类型/enum)。构建顺序必须为 shared → server → web。allowBuilds 配置允许 native 模块 (@prisma/client, esbuild, electron) 在 pnpm 隔离环境中构建。

## Reasoning

根 package.json 定义 pnpm workspaces，pnpm-workspace.yaml 配置 apps/* 和 packages/* 目录。build 脚本明确按 shared → server → web 顺序构建。packages/shared 被 server 和 web 通过 workspace:* 协议引用。
