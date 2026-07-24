# 内置语音通话 (WebRTC)

## Context
聊天系统加 WebRTC 实时语音通话功能。通过现有 Socket.IO 做信令，浏览器/Electron 内直接通话。

## 方案

### 信令层（Backend — WsGateway）
新增 WebSocket 事件：
- `call:offer` — 主叫方发起通话 { targetUserId, sdp }
- `call:answer` — 被叫方接听 { targetUserId, sdp }
- `call:ice-candidate` — ICE 候选 { targetUserId, candidate }
- `call:hangup` — 挂断 { targetUserId }
- `call:ringing` — 被叫方响铃通知（通知主叫方）

WsGateway 新增方法：
- `notifyIncomingCall(targetUserId, data)` — 通知被叫方有来电

### 前端

**ChatHeader** — 加通话按钮（📞），点击发起呼叫

**IncomingCallModal**（新组件）— 来电弹窗：
- 显示主叫方名字
- "接听" / "拒绝" 按钮
- 响铃动画

**VoiceCallBar**（新组件）— 通话中状态条：
- 底部固定条，显示对方名字 + 通话时长
- "挂断" 按钮
- 最小化/展开

**useVoiceCall hook**（新）— WebRTC 连接管理：
- 创建 RTCPeerConnection
- 获取本地媒体流 (getUserMedia)
- 处理信令消息
- 管理通话状态 (idle/ringing/calling/connected)

### 修改文件

| 文件 | 操作 |
|------|------|
| `ws.gateway.ts` | 新增 call 信令转发 |
| `chat/ChatHeader.tsx` | 加 📞 按钮 |
| `components/IncomingCallModal.tsx` | 新：来电弹窗 |
| `components/VoiceCallBar.tsx` | 新：通话状态条 |
| `hooks/useVoiceCall.ts` | 新：WebRTC 管理 |
| `AppLayout.tsx` | 挂载 IncomingCallModal + VoiceCallBar |

### 验证
1. A 和 B 进入同一个聊天 → A 点 📞 → B 看到来电弹窗
2. B 点接听 → 双方进入通话，可听到对方声音
3. 任一方点挂断 → 通话结束
