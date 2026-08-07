---
id: D-007
slug: jwt-token
title: JWT 双 Token 认证模式
date: 2026-08-06
source: session
enforce: required
sessionId: 
---

# JWT 双 Token 认证模式

使用 accessToken (15min) + refreshToken (7d) 双 Token 模式。accessToken 放在 Authorization header 用于 API 鉴权；refreshToken 用于前端 axios interceptor 在 401 时自动刷新。Socket.IO 连接也通过 JWT token 认证。

## Reasoning

短寿命 accessToken 限制泄露风险窗口，长寿命 refreshToken 减少重复登录。前端自动刷新无感，WebSocket 连接也复用同一认证机制。
