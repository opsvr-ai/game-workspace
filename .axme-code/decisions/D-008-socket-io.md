---
id: D-008
slug: socket-io
title: Socket.IO 工作室房间广播模式
date: 2026-08-06
source: session
enforce: required
sessionId: 
---

# Socket.IO 工作室房间广播模式

WebSocket 实时通信使用 Socket.IO，以工作室(studio)为单位建立房间分组。JWT 认证通过后在网关层自动 join `studio:${studioId}` 房间。所有订单状态变更、陪玩上下线、远程命令都通过房间广播推送。

## Reasoning

订单状态变更需要实时通知工作室所有成员（客服、管理员、陪玩）。Socket.IO 天然支持房间(room)模型，与工作室(studio)完全对应。陪玩 Electron 客户端和浏览器端统一通过 WebSocket 接收推送。
