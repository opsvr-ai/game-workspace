---
id: D-011
slug: pnpm-workspaces-monorepo
title: pnpm Workspaces Monorepo 结构
date: 2026-08-06
source: session
enforce: required
sessionId: 
---

# pnpm Workspaces Monorepo 结构

使用 pnpm workspaces 管理 monorepo：apps/server(Nest.js) + apps/web(React) + apps/companion-electron(Electron) + packages/shared(共享类型)。构建顺序: shared → server → web。

## Reasoning

前后端共享 TypeScript 类型(枚举、DTO 接口)，放在 packages/shared 中避免重复定义。pnpm workspaces 提供原生 monorepo 支持，比 npm/yarn workspaces 更快更严格。
