## 业务术语
| 术语 | 英文 | 说明 |
|------|------|------|
| 工作室 | Studio | 顶级组织单元，包含陪玩、客户、订单 |
| 陪玩 | Companion | 提供游戏陪玩服务的人员 |
| 客服 | CS (Customer Service) | 创建订单、管理客户的运营人员 |
| 老板 | Owner | 系统所有者，查看盈亏统计 |
| 管理员 | Admin | 管理陪玩、审核报账、远程控制 |
| 订单 | Order | 一次陪玩服务记录，含类型(NEW/RENEW/REPURCHASE/TIP) |
| 派单 | Dispatch | 将订单分配给陪玩，分为抢单池(POOL)和指定(DIRECT) |
| 报账 | Transaction | 陪玩完成订单后上报的收费记录，需管理员审核 |
| 桥接 | Bridge | 两个工作室之间的合作关系，共享订单/客户/资源 |
| 支取 | Withdraw | 陪玩从钱包余额中申请提现 |
| 结算 | Settlement | 月底按阶梯分成结算陪玩收入 |
| 进程黑名单 | Process Blacklist | 陪玩电脑上禁止运行的进程列表 |
| 客户画像 | Customer Profile | 19 字段的客户特征描述，含 AI 分析 |

## 技术术语
| 术语 | 说明 |
|------|------|
| broadcastToStudio | WebSocket 向工作室所有成员广播事件 |
| RolesGuard | Nest.js 路由级角色权限守卫 |
| secondPassword | 二级密码，用于敏感操作（如查看盈亏）|
| dual-token | JWT accessToken + refreshToken 双 Token 认证模式 |