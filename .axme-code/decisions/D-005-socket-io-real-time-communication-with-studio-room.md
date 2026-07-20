---
id: D-005
slug: socket-io-real-time-communication-with-studio-room
title: Socket.IO Real-Time Communication with Studio Room Isolation
date: 2026-07-19
source: session
enforce: required
sessionId: 
scope: workspace
---

# Socket.IO Real-Time Communication with Studio Room Isolation

实时通信使用 Socket.IO，Nest.js 端通过 @nestjs/websockets 的 WsGateway 处理连接，连接时验证 JWT token。房间按 studioId 分组隔离，确保不同工作室的数据不会交叉泄露。前端使用 socket.io-client 连接。

## Reasoning

WsModule 在 app.module.ts 中注册。server 依赖 @nestjs/platform-socket.io + socket.io，web 依赖 socket.io-client。前端 stores 通过 Socket.IO 事件同步状态。
