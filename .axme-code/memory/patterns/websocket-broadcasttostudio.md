---
slug: websocket-broadcasttostudio
type: pattern
title: WebSocket broadcastToStudio 实时同步
source: session
date: 2026-08-06
keywords: websocket, broadcasttostudio, broadcasttostudio, studioid, order, pool, updated, order
sessionId: d54b32b9-f23f-4f1f-9ec2-953ddf2f0375
---

# WebSocket broadcastToStudio 实时同步

任何订单状态变更操作(创建/抢单/确认/完成/取消/更新金额/更新联系方式)后，必须调用 broadcastToStudio(studioId, 'order:pool_updated', order) 实时推送更新到工作室所有在线成员。遗漏广播会导致前端状态不一致。

## Details


