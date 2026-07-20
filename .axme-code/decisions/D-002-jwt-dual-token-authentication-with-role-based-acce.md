---
id: D-002
slug: jwt-dual-token-authentication-with-role-based-acce
title: JWT Dual-Token Authentication with Role-Based Access Control
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# JWT Dual-Token Authentication with Role-Based Access Control

认证系统使用 JWT 双 Token 机制：access token 有效期 15 分钟，refresh token 有效期 7 天。4 种角色 (OWNER/ADMIN/CS/COMPANION) 通过 RolesGuard 控制接口权限。OWNER 拥有最高权限，ADMIN 管理工作室日常运营，CS 负责派单和客服，COMPANION 为陪玩师。

## Reasoning

AuthModule 使用 @nestjs/jwt 和 @nestjs/passport 实现。shared/enums.ts 定义 UserRole 枚举包含 4 个角色。前端路由按角色分组：/owner/*, /admin/*, /cs/*, /companion/*。
