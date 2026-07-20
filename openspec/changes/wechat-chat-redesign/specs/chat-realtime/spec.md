# Chat Realtime

## Overview

Single WebSocket event for real-time message delivery. No polling.

## Event: chat:message

Direction: Server → Client

Payload: `{ conversationId: string, message: { id: string, senderId: string, text: string, createdAt: string } }`

## Server Requirements

- After saving a message (via POST /conversations/:id/messages), emit `chat:message` to the OTHER participant's WebSocket socket
- Look up recipient socket by `user:${userId}` room (not by companion room)
- If recipient is offline, event is silently dropped (message still persisted)
- Do NOT emit to the sender (they get confirmation from HTTP response)

## Client Requirements

- On `chat:message` event, call `chatStore.receiveMessage(msg)`
- `receiveMessage` handles: dedup (by message.id), append, unread tracking, reorder conversation list
- No other WebSocket chat events exist (no `chat:notify`, `chat:new`, `chat:send`)

## Reconnection

- Socket.IO auto-reconnects on disconnect
- On reconnect, client refreshes conversation list via GET /conversations
- No message replay needed (messages are persisted, history endpoint fills gaps)
