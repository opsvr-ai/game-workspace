---
id: D-004
slug: react-ant-design-frontend-with-zustand-state-manag
title: React + Ant Design Frontend with Zustand State Management
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# React + Ant Design Frontend with Zustand State Management

前端使用 React 18 + Ant Design 5 + React Router 6，状态管理用 Zustand 5，图表用 Recharts 和 @ant-design/charts。采用 Apple 风格浅色主题（自定义 Ant Design token 配置）。Vite 6 作为构建工具，type: "module" 模式。CSS 使用 antd App 组件支持的静态主题 tokens。

## Reasoning

apps/web/package.json 确认所有依赖。router.tsx 定义 24+ 路由，按角色分为 /owner/*, /admin/*, /cs/*, /companion/* 四个区域。theme.ts 包含 Ant Design 自定义主题配置。
