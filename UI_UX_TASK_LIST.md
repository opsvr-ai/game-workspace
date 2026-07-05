# UI/UX 优化 TASK 清单

> 📅 2026-07-05 | 🎨 全角色覆盖 | 📊 25 条优化建议  
> 🔍 分析方法：3 角色子智能体并行分析（管理端/派单端/桌面端）→ 综合去重

---

## 总览

| 优先级 | 数量 | 涉及角色 |
|:--:|:--:|------|
| 🔴 P0 | **6** | ALL |
| 🟡 P1 | **12** | ALL |
| 🟢 P2 | **7** | ALL |

---

## 🔴 P0 — 阻塞级问题

### UX-01 🔴 OWNER 菜单缺少「报账审核」入口

**问题**：ADMIN 菜单有"报账审核"，OWNER 菜单没有。OWNER 作为老板应看到全局财务，但只能通过直接 URL 访问。

**涉及文件**：`AppLayout.tsx` L60-74（OWNER roleMenus）

**优化**：OWNER 菜单增加 `{ key: '/admin/billing', icon: IconBilling, label: '报账审核' }`

---

### UX-02 🔴 CompanionPage 状态切换按钮标签反直觉

**问题**：`CompanionPage.tsx` L168-172：
```tsx
<Button onClick={() => switchStatus('IDLE')}>娱乐中</Button>     // 点"娱乐中"→切到IDLE
<Button onClick={() => switchStatus('ONLINE')}>空闲</Button>      // 点"空闲"→切到ONLINE
```
按钮文字是**当前状态**还是**目标状态**？语义完全颠倒。`IDLE`=娱乐中、`ONLINE`=空闲，但按钮看起来是点"空闲"变空闲，实际发送的是`ONLINE`。

**涉及文件**：`CompanionPage.tsx` L168-172

**优化**：统一为动作描述："切换为娱乐中"、"切换为空闲"、"切换为休息中"

---

### UX-03 🔴 聊天消息仅 localStorage 存储，不可靠

**问题**：`ChatModal` 消息完全依赖 `localStorage`（`chat-msgs-${orderId}`），上限 200 条。清缓存=丢失所有记录，切换设备看不到历史。

**涉及文件**：`AppLayout.tsx` L173-179, `ChatModal` 组件

**优化**：消息以服务端为准，localStorage 仅离线缓存；打开 ChatModal 后 WebSocket 增量拉取新消息

---

### UX-04 🔴 登录页硬编码测试账号 + 安全隐患

**问题**：
- Web 版 `LoginPage.tsx` L24-25 硬编码 `username='hanlei', password='123456'`
- Electron 版 `LoginPage.tsx` 无 Token 有效性预检，过期 Token 导致后续 API 全部 401

**涉及文件**：`LoginPage.tsx`, `companion-electron/src/pages/LoginPage.tsx`

**优化**：移除硬编码凭据；Electron 登录后先 `GET /auth/me` 验证 Token

---

### UX-05 🔴 远程命令弹窗关闭即执行（严重安全缺陷）

**问题**：`remote-command.ts:111` `.catch(() => { onExecute() })`——用户直接点 × 关闭远程命令弹窗时，executeJavaScript 因窗口已关闭而失败，`.catch()` 中无条件执行 `onExecute()`。这意味着**点击关闭按钮 = 执行关机/重启**。

**涉及文件**：`remote-command.ts` L99-111

**优化**：参照 `blacklist-notification.ts` 修复方案——用 IPC 通信替代 executeJavaScript

---

### UX-06 🔴 CS DispatchPage 陪玩列表过窄且交互混乱

**问题**：
- 左侧陪玩列表仅 3/24 宽度（~212px），进程异常标识 `fontSize:10` 几乎不可见
- 点击陪玩条目同时执行：清除未读 + 打开聊天——CS 只想看详情却被弹聊天窗
- 陪玩详情 Modal（L419-450）存在但 `setSelectedCompanion` 从未被调用（**死代码**）

**涉及文件**：`DispatchPage.tsx` L224-314, L419-450

**优化**：
- 左侧改为 `span={4}`，增加搜索筛选框
- 单击→打开详情 Modal；双击/聊天按钮→打开 ChatModal
- 进程异常标识改为头像角标 + BLOCKED 整行淡红背景

---

## 🟡 P1 — 体验级问题

### UX-07 🟡 AppLayout 图标复用严重

**问题**：`IconPc`（DesktopOutlined）被"远程控制/黑名单/白名单/杀进程日志"4 项共用；`IconAuth`（KeyOutlined）被 3 项共用。收起侧边栏时 4 个相同图标完全无法区分。

**涉及文件**：`AppLayout.tsx` L15-30, L60-107

**优化**：远程控制→`ControlOutlined`、黑名单→`StopOutlined`、白名单→`SafetyOutlined`、杀进程日志→`HistoryOutlined`

---

### UX-08 🟡 OWNER 菜单 14 项扁平无分组

**问题**：高频操作和安全管控操作混排，视觉层次为零。

**涉及文件**：`AppLayout.tsx` L60-74

**优化**：使用 Menu `type:'group'` 分为 4 组：经营概览 / 人员管理 / 系统管控 / 设置

---

### UX-09 🟡 UnifiedDashboard 缺乏运营 KPI

**问题**：数据看板仅"昨日流水"+"全月流水"一个图表，缺少：实时在线数、待审核数、日期筛选、导出按钮。错误状态仅一行灰色"加载失败"。

**涉及文件**：`UnifiedDashboard.tsx`

**优化**：增加 Statistic 卡片行（在线/今日订单/待审核/流水），DatePicker 日期筛选，CSV 导出，Result 组件错误展示

---

### UX-10 🟡 BillingPage 信息过载

**问题**：1374 行单页面承载 6 个子模块（报账记录/申请/审核/总览/月结算/钱包审核），滚动距离极长。

**涉及文件**：`BillingPage.tsx`

**优化**：顶层 Tabs 拆分："报账审核" / "财务结算" / "钱包审核"，增加 Fab 回到顶部

---

### UX-11 🟡 订单卡片信息无层次

**问题**：15+ 字段全部塞入一行 `Row wrap={false}`，无主次之分。3px 左侧竖线区分订单类型，快速扫视时几乎不可见。

**涉及文件**：`DispatchPage.tsx` L354-392

**优化**：
- 第一行（核心）：序号 | 类型Tag | 游戏名 | 金额（红）| 紧急标签 | 时长
- 第二行（辅助，灰）：客户来源 | 微信 | 房间码 | 发布者 | 时间
- 第三行（可折叠）：delta 相关字段
- 左侧竖线 3px→5px + 卡片淡色背景 tint

---

### UX-12 🟡 错误状态展示不一致

**问题**：CustomersPage 用红色横幅、UnifiedDashboard 仅灰色文字、ProcessKillLogPage 静默失败（`/* ignore */`）

**涉及文件**：多个页面

**优化**：创建 `ErrorBanner` 组件统一错误展示；所有 catch 块至少 `message.error()`

---

### UX-13 🟡 AI 分析占位符永久不可用

**问题**：`CustomerDetailPage` 显示"AI 分析功能即将上线"，永久未兑现。

**涉及文件**：`CustomerDetailPage.tsx`

**优化**：短期隐藏该卡片；长期用简单规则引擎替代（如"高消费+30天未下单=流失风险"）

---

### UX-14 🟡 钱包不实时更新

**问题**：CompanionPage 接单/报账后钱包余额不刷新，需手动刷新页面。

**涉及文件**：`CompanionPage.tsx` L42-64

**优化**：WebSocket 推送钱包变动，或在接单/报账成功后主动 `fetchWallet()`

---

### UX-15 🟡 杀进程通知弹窗视觉与远程命令弹窗不统一

**问题**：
- 杀进程弹窗：360×220，红色边框 `#FF4757`，`contextIsolation:false`
- 远程命令弹窗：360×200，橙色边框 `#FF9100`，`contextIsolation:true`
- Toast：320×60，绿色边框 `#00E676`

三套弹窗尺寸/定位/技术方案完全不一致。

**涉及文件**：`blacklist-notification.ts`, `remote-command.ts`

**优化**：抽取公共 `NotificationWindow` 函数，统一尺寸(360×200)、定位（右下角-20px）、交互模式（IPC通信）

---

### UX-16 🟡 CS 无订单筛选和搜索

**问题**：DispatchPage 的 AdminView 有 status 筛选下拉，但 CSView 和 OrderPoolPage 完全没有筛选——CS 无法只看"立即打"订单或按游戏名搜索。

**涉及文件**：`DispatchPage.tsx`, `OrderPoolPage.tsx`

**优化**：增加紧急程度筛选（立即打/预约）、游戏名搜索、金额排序

---

### UX-17 🟡 ReviewPage 拒绝原因在 Popconfirm 中输入体验差

**问题**：拒绝按钮的 Popconfirm 内嵌 TextArea，布局局促。

**涉及文件**：`ReviewPage.tsx`

**优化**：改为 Modal + TextArea + 确认按钮

---

### UX-18 🟡 无可用的移动端响应式

**问题**：全站零响应式：220px 固定侧边栏、LoginPage 固定 400px、DispatchPage 三栏固定 span。CS/陪玩有移动办公需求。

**涉及文件**：全局 CSS + AppLayout + 多页面

**优化**：≤768px 侧边栏自动折叠/底部Tab；LoginPage `max-width:400px; width:90%`；DispatchPage 垂直堆叠

---

## 🟢 P2 — 增强级问题

### UX-19 🟢 无键盘快捷键

**问题**：全部操作依赖鼠标，无任何快捷键支持。

**优化**：`Ctrl+K` 命令面板跳转页面；审核页 Enter=通过、R=拒绝；表格 `/`=聚焦搜索

---

### UX-20 🟢 页面标题风格不统一

**问题**：有的用 `<Text strong>`、有的用 `<Title level={4}>`、有的无标题。

**优化**：统一 `<Title level={4}>` 或创建 `PageHeader` 组件

---

### UX-21 🟢 时间格式化方式不统一

**问题**：`toLocaleString('zh-CN')`、自定义 `formatDate()`、`formatHeartbeat()` 六种方式混用。

**优化**：创建 `dateFormat.ts` 工具模块统一格式化

---

### UX-22 🟢 批量操作缺失

**问题**：除 BillingPage 外均无批量操作。客户/员工/远程控制/黑名单均需逐条操作。

**优化**：Table 增加 `rowSelection` + 批量操作工具栏

---

### UX-23 🟢 ProcessKillLogPage 信息密度过低

**问题**：纯日志表格无统计、无趋势。

**优化**：顶部增加统计卡片（今日杀进程总数、成功率、Top5 进程、Top 陪玩）

---

### UX-24 🟢 Electron 托盘右键菜单功能不足

**问题**：仅"显示/退出"两项。缺少：快速切换在线状态、查看未读订单数 badge。

**优化**：增加子菜单"切换状态→空闲/娱乐中/休息中"，未读订单红点提示

---

### UX-25 🟢 聊天体验缺基础功能

**问题**：表情按钮纯装饰无功能、无图片发送、无已读状态、无消息搜索。

**优化**：接入 emoji-mart、图片发送按钮（复用 `/upload`）、WebSocket 实时同步

---

## 📊 实施建议

| 阶段 | 优先级 | 条数 | 预估工时 |
|:--:|:--:|:--:|:--:|
| 本周 | P0 | 6 | 3d |
| 本月 | P1 | 12 | 8d |
| 远期 | P2 | 7 | 5d |

> 📝 本清单由 3 个角色子智能体（管理端/派单端/桌面端）并行阅读 25+ 个源文件后综合生成。
