# 修复聊天消息左右位置 & 表情收藏持久化

## Context

用户反馈两个聊天功能 bug：

1. **消息位置错乱**：zhangsan(陪玩) 发给 kefu01(客服) 的消息，在 kefu01 的聊天框显示在右边（应该是左边/对方消息位置）
2. **收藏表情丢失**：用户收藏的自定义表情图片重新登录后消失，没有持久化到服务端

## 根因分析

### Bug 1 — 消息 from 标签错误

**后端** `apps/server/src/companions/companions.controller.ts`:
- L424: `chatNotify` 存储内存消息时 `from` 硬编码为 `'them'`，不记录发送者 ID
- L65: `chat-pending` 从内存读取时全部强制 `from: 'them'`
- L74-76: 数据库路径正确（根据 senderId 判断），但内存路径优先

**前端** `apps/web/src/components/ChatModal.tsx`:
- L52: `m.from === 'me' ? 'them' : m.from` — 把服务端正确标记的 `'me'` 翻转成 `'them'`，破坏了唯一正确的 DB 路径

### Bug 2 — 纯 localStorage 存储

`ChatModal.tsx` L30: `customEmojis` 只存在 `localStorage`（key `custom-emojis`），换浏览器/设备即丢失。

## 修改方案

### Part A: 修复消息 from 标签

**A1. 后端 `chatNotify` — 记录 senderId**

内存 ChatMsg 接口新增 `senderId` 字段写入时从 `req.user` 获取。

**A2. 后端 `chat-pending` — 用 senderId 计算 from**

内存路径改为和 DB 路径一致的逻辑：`senderId === 请求用户ID ? 'me' : 'them'`

**A3. 前端 — 删除错误的翻转逻辑**

删除 L52-53 的 `'me' → 'them'` 翻转，直接信任服务端返回的 `from`。

**A4. 前端 — localStorage key 加 userId 隔离**

`STORAGE_KEY` 改为 `chat-msgs-${userId}`，防止同浏览器切账号导致消息归属混乱。

### Part B: 表情收藏持久化

**B1. Prisma Schema — User 模型加字段**

`User` 表新增 `customEmojis Json @default("[]")`

**B2. 数据库迁移**

运行 `pnpm db:migrate` 生成迁移文件

**B3. 后端 API**

`apps/server/src/auth/auth.controller.ts` 新增:
- `GET /api/auth/me/emojis` — 返回当前用户的收藏表情列表
- `PUT /api/auth/me/emojis` — 更新当前用户的收藏表情列表

**B4. 前端 — 服务端同步**

`ChatModal.tsx`:
- 初始化时从 `/auth/me/emojis` 加载收藏表情
- 收藏/删除时同步调用 PUT 接口
- localStorage 保留作为快速缓存

## 涉及文件

| 文件 | 改动 |
|------|------|
| `apps/server/prisma/schema.prisma` | User 模型加 `customEmojis` 字段 |
| `apps/server/src/companions/companions.controller.ts` | ChatMsg 加 senderId，内存路径用 senderId 计算 from |
| `apps/server/src/auth/auth.controller.ts` | 新增 emojis GET/PUT 端点 |
| `apps/web/src/components/ChatModal.tsx` | 删除翻转逻辑，key 隔离，表情服务端同步 |

## 验证

1. **消息位置**：zhangsan→kefu01 消息在左边(白底)，kefu01 自己的在右边(绿底)，刷新后正确
2. **表情持久化**：收藏表情 → 退出登录 → 重新登录 → 表情仍在
3. **API 验证**：`GET /api/auth/me/emojis` 返回已保存的表情列表
