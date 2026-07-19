# UI 设计系统落地优化 — 设计文档

> 日期: 2026-07-19 | 方案: A | 风格: 浅色主题 · 简约风 | 预估: 3.5 天

## 设计方向

**浅色简约风**：保持青色 `#00D4FF` 作为品牌强调色，收敛 cyber glow 效果。用留白、清晰层级、克制色彩替代装饰性发光。

关键调整：
- 阴影从三层 cyber glow → 单层 `0 1px 3px rgba(0,0,0,0.06)` 轻阴影
- 圆角从 12px → 8px 统一
- 网格背景 → 纯色 `#F8FAFC`
- 减少渐变使用（仅品牌 logo 和登录页保留）
- 字号从 13px → 14px base

---

## 第一章：Token 驱动颜色改造（1.5 天）

### 1.1 简化主题 Token

文件: `apps/web/src/theme.ts`

- 新增语义 Token：`colorChart1-4`、`colorAmountPositive/Negative`、`colorAvatarFallback`
- 收敛阴影：`boxShadowSecondary/Tertiary` 改为轻阴影，移除 cyan 发光
- 收敛圆角：`borderRadiusLG` 8px，`borderRadius` 6px
- 提升字号：`fontSize` 14px

### 1.2 扩展 CSS 变量

文件: `apps/web/src/index.css`

新增:
- `--color-success: #00E676`
- `--color-warning: #FF9100`
- `--color-error: #FF4757`
- `--color-bg-hover: #f8fafc`
- `--color-bg-error: #fff2f0`

### 1.3 替换高频硬编码色

| 硬编码 | 替换为 | 目标 |
|--------|--------|------|
| `#1677ff` | `useToken().colorPrimary` | ~15 页 |
| `#52c41a` | `var(--color-success)` | ~8 页 |
| `#ff4d4f` | `var(--color-error)` | ~6 页 |
| `#f0f0f0` | `var(--color-bg-hover)` | ~5 页 |
| `#faad14` | `var(--color-warning)` | ~4 页 |

### 1.4 全局背景简化

文件: `apps/web/src/styles/global.css`

- body 背景: grid-pattern → 纯色 `#F8FAFC`
- scrollbar: 保持青色，减淡
- 移除 `grab-ripple` 死代码

---

## 第二章：统一组件使用（1 天）

### 2.1-2.2 ErrorBanner 增强 + 全页替换

文件: `apps/web/src/components/ErrorBanner.tsx`

Props: `message`, `onRetry?`, `style?`

替换: `CustomersPage`, `CompanionsPage`, `CSDispatchView`, `OrdersPage` 中的内联错误 div

### 2.3-2.4 PageHeader 增强 + 全页替换

文件: `apps/web/src/components/PageHeader.tsx`

Props: `title`, `subtitle?`, `extra?`, `breadcrumb?`

替换: 所有 `Text strong style={{fontSize:16}}` 内联页面标题

### 2.5-2.6 EmptyState 组件

新建: `apps/web/src/components/EmptyState.tsx`

Props: `description?`, `image?`, `action?`

### 2.7-2.8 表格 Card 包裹标准化

所有数据列表页统一用 `<Card size="small">` 包裹

---

## 第三章：骨架屏 + 基础无障碍（0.5 天）

### 3.1-3.2 骨架屏组件

新建: `TableSkeleton.tsx`, `CardSkeleton.tsx`

### 3.3 页面替换

| 页面 | Spin → Skeleton |
|------|-----------------|
| UnifiedDashboard | CardSkeleton + chart Skeleton |
| CustomersPage / OrdersPage / CompanionsPage / BillingPage | TableSkeleton |

### 3.4-3.5 基础无障碍

- `ConfigProvider` `theme.hashed: false`
- 状态指示器/自定义交互元素加 `role`/`aria-label`

---

## 第四章：聊天对话深度优化（0.5 天）

### 4.1 ChatModal 视觉重构

文件: `apps/web/src/components/ChatModal.tsx`（当前 243 行）

| 项目 | 现状 | 优化 |
|------|------|------|
| 头部 | 硬编码深色 + emoji 头像 | 使用 token 色 + Gradient 文字标题 |
| 消息气泡 | 简单圆角矩形 | 发送/接收差异化（右蓝左灰），圆角 12px，微阴影 |
| 输入区 | 基础 Input + 按钮 | 圆角输入框 + 发送按钮渐变色，focus 时微边框发光 |
| 时间戳 | 无 | 消息间超过 5 分钟显示时间分隔线 |
| 滚动 | 无自动 | 新消息自动滚到底部，带 smooth 过渡 |
| 空状态 | 无 | 首次打开显示 "暂无聊天记录，发送第一条消息吧" |
| emoji | 系统 emoji | 增加常用快捷 emoji 栏（👍❤️😊😂🎉🔥） |

### 4.2 聊天消息提醒

| 场景 | 现状 | 优化 |
|------|------|------|
| 新消息通知 | `chat:new` WS 事件已有 | 增加浏览器 Notification API（需用户授权） |
| 侧边栏未读 | 硬编码 pulse 动画 badge | 改为简洁红色圆点 + 未读数字，复用 token |
| 页面标题闪烁 | 无 | 新消息时 `document.title = '🔔 新消息 — Chunlv'`，切回标签页恢复 |
| 声音提醒 | 无 | 新消息播放短促提示音（可选，默认关闭） |
| 聊天入口高亮 | 无 | 侧边栏聊天菜单项有未读时文字变青色 + 微动效 |

### 4.3 聊天列表侧边栏

文件: `apps/web/src/pages/dispatch/CSDispatchView.tsx`（companion 列表区域）

| 项目 | 优化 |
|------|------|
| 列表项交互 | hover 时微右移 2px + 背景色过渡，当前选中项左边框青色 |
| 未读标记 | 每个 companion 旁显示未读红点 |
| 在线状态 | 绿色圆点呼吸动画（保留）但颜色改用 `var(--color-success)` |
| 搜索过滤 | 顶部增加搜索框，实时过滤 companion 名称 |

### 4.4 聊天持久化确认

P1-4 已实现 Prisma 持久化 + WS 实时推送。前端确保：
- ChatModal 打开时自动从 `/api/companions/chat-pending` 加载历史消息
- 新消息通过 `chat:new` Socket 事件实时追加
- 发送失败时消息旁显示红色感叹号 + 点击重发

---

## 验证策略

| 维度 | 方法 |
|------|------|
| Token 替换 | `grep '#1677ff\|#52c41a\|#ff4d4f\|#f0f0f0' apps/web/src/` 大幅减少 |
| 组件统一 | 所有页面用同一个 ErrorBanner / PageHeader / EmptyState |
| 编译 | `pnpm typecheck` 零新增错误 |
| 骨架屏 | 加载中显示骨架而非 Spin |
| 聊天提醒 | 发送消息后检查浏览器通知、标题闪烁、侧边栏红点 |
| 简约风格 | 截图对比，确认去除 cyber glow、网格背景，干净留白 |
