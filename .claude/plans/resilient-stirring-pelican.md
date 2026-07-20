# Plan: 增强聊天消息通知 — 声音 + 右下角浮动图标 + 铃铛增强

## Context

当前系统中，陪玩发消息给客服时，客服端只有右上角小铃铛的 Badge 数字 + 浏览器通知 + 标题栏闪烁。用户反映铃铛提醒不明显，需要增加：
1. **声音提醒** — 新消息到达时播放提示音
2. **右下角浮动图标** — 类似 QQ/微信的悬浮聊天气泡，闪烁提醒
3. **铃铛增强** — 更大的 Badge + 发光动画

所有改动零新增 npm 依赖，使用 Web Audio API 生成提示音，复用现有 Zustand chatStore。

## Files to Create

### 1. `apps/web/src/utils/notificationSound.ts` (新文件)

Web Audio API 提示音工具模块：
- 懒加载 `AudioContext` 单例（首次调用时创建，非模块导入时）
- 导出 `playMessageSound()` 函数
- 生成 QQ 风格双音调：800Hz 正弦波 100ms → 1000Hz 150ms，每个带指数衰减防止爆音
- 整体 try/catch 保护，不支持 Audio API 的环境静默跳过
- `AudioContext.state === 'suspended'` 时自动 `resume()`，并注册一次性 `document.click` 监听器确保用户交互后可用

### 2. `apps/web/src/components/FloatingChatWidget.tsx` (新文件)

右下角浮动聊天气泡组件：

**Props:**
```typescript
interface Props { onOpenChat: (companionId: string, companionName: string) => void }
```

**核心逻辑：**
- `position: fixed; z-index: 1050`，默认位置右下角（距右 20px，距底 80px 给 UrgentOrderPopup 留空间）
- 圆形按钮 56×56px，蓝色背景 `#2563EB`，带 `<Badge>` 显示总未读数
- **拖拽**：mousedown/touchstart 记录起始位置 → document mousemove/touchmove 更新位置（限制在视口内）→ mouseup/touchend 保存到 localStorage `chat-widget-pos`。移动超过 3px 判定为拖拽，否则为点击
- **点击**（非拖拽）：打开 `<Popover placement="topRight">` 显示通知列表
- **通知列表**：与 AppLayout 中 NotificationList 相同模式 — 按 companionId 去重，时间戳降序，最多 10 条。每条：头像圆圈 + 陪玩名 + 消息预览 + 时间 + 未读 Badge。点击条目调用 `onOpenChat` 并关闭 Popover
- **角色门控**：`user.role !== 'COMPANION'` 时才渲染，陪玩端不显示
- **动画**：有未读消息时应用 `float-widget-pulse`（呼吸发光），新通知到达时短暂应用 `float-widget-bounce`（弹跳缩放，0.5s 一次性），通过监听 `chatNotifications.length` 变化触发

**用到的 Store：**
- `useAuthStore` → 获取 `user.role` 做角色判断
- `useChatStore` → 获取 `chatNotifications`、`chatUnread`、`isChatOpen`

## Files to Modify

### 3. `apps/web/src/stores/chatStore.ts`

新增两个字段到 `ChatState`：
```typescript
lastSoundPlayedAt: Record<string, number>;  // companionId → 上次播放声音的时间戳
markSoundPlayed: (companionId: string, timestamp: number) => void;
```
初始值 `lastSoundPlayedAt: {}`，`markSoundPlayed` 实现与现有 pattern 一致（spread 更新）。

### 4. `apps/web/src/styles/global.css`

在 `scale-in` 块之后（~line 270）添加三个 `@keyframes` 和两个工具类：

- `@keyframes float-pulse` — 呼吸发光：box-shadow 0→12px→0，蓝色半透明，2s infinite
- `@keyframes float-bounce` — 弹跳缩放：1→1.15→0.95→1，0.5s ease-out
- `@keyframes bell-glow` — 铃铛发光：box-shadow 4px→12px→4px，蓝色半透明，2s infinite
- `.float-widget-pulse` — 绑定 float-pulse 动画
- `.float-widget-bounce` — 绑定 float-bounce 动画

### 5. `apps/web/src/layouts/AppLayout.tsx`

**Import 新增：**
```typescript
import FloatingChatWidget from '../components/FloatingChatWidget';
import { playMessageSound } from '../utils/notificationSound';
```

**Socket 事件处理中增加声音调用：**

在 `onChatNotify` 和 `onChatNew` 中，`addChatNotification` 之后加入声音去重逻辑：
- 检查 `!isChatOpen`（聊天窗口开着时不播放）
- 用 `companionId || senderId` 作为去重 key
- 时间戳大于上次播放时间戳才播放声音

**轮询循环中增加声音调用**，同样在 `addChatNotification` 之后，同样逻辑。

**铃铛增强：**
- `Badge size="small"` → `size="default"`
- 添加 `overflowCount={99}`

**渲染 FloatingChatWidget：**
```tsx
<FloatingChatWidget onOpenChat={openChatFromNotification} />
```
放在 ChatModal 之后、CommandPalette 之前。

## Verification

1. `cd apps/web && npx tsc --noEmit` — 零类型错误
2. 用 CS 账号（kefu01 / 123456）登录：确认浮动图标 + 铃铛 Badge 变大
3. 用陪玩账号发送消息：确认提示音 + 浮动图标弹跳 + 铃铛数字更新
4. 点击浮动图标 → 通知列表正确显示
5. 点击通知条目 → ChatModal 打开
6. ChatModal 打开时再发消息 → 不播放声音（抑制）
7. 拖拽浮动图标 → 位置更新，刷新后保持
8. 陪玩账号登录 → 无浮动图标、无铃铛
