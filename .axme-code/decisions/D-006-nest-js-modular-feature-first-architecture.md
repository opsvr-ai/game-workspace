---
id: D-006
slug: nest-js-modular-feature-first-architecture
title: Nest.js Modular Feature-First Architecture
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# Nest.js Modular Feature-First Architecture

后端采用 Nest.js 模块化架构，每个业务域对应一个独立 feature module（auth, studios, companions, customers, orders, billing, dashboard, agent, process-blacklist 等）。PrismaModule 提供全局数据库服务，ConfigModule 全局加载环境变量。所有 API 以 /api/* 为前缀，CORS 允许 localhost:8000/5173。

## Reasoning

app.module.ts 导入 12 个 feature module，main.ts 配置 /api 前缀和 CORS。每个 module 包含 controller + service + module 的标准 Nest.js 三层结构。
