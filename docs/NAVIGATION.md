# 导航与信息架构（2026-10-18 P1）

> 目标：**一个外壳 + 四个角色工作区**，一级导航最多 5 组；入口合并、能力保留、旧地址重定向。
> 这是 P1；P2 再把订单 / 客户 / 财务的多个页面收成页签，P3 收敛后端聚合接口。

## 一级导航

| 角色 | 一级 |
|---|---|
| 老板 / 店长 | 工作台、订单、客户、团队与财务、设置与设备 |
| 客服 | 工作台、订单、客户、团队与财务、设置 |
| 陪玩 | 工作台、订单、客户、收入、设置 |

- 「待处理」在「工作台」里
- 「高级设置」在「设置与设备」最后：AI / 语音 / 内容查重 / 客服设置 / 工作室账号 / 桥接 / 授权
- 页面 URL 仍是一个页面一条地址；菜单只做入口收敛

## 旧地址重定向

| 旧地址 | 新地址 |
|---|---|
| `/owner/orders` | `/admin/orders` |
| `/owner/order-review` | `/admin/order-review` |
| `/owner/customers` | `/admin/customers` |
| `/owner/customers/:id` | `/admin/customers/:id` |
| `/owner/customer-board` | `/admin/customer-board` |
| `/owner/employees` | `/admin/employees` |
| `/owner/work-wechats` | `/admin/work-wechats` |
| `/owner/review` | `/admin/review` |
| `/owner/settings` | `/admin/settings` |
| `/profile-setup` | `/profile` |
| `/ui-kit` | `/login` |

`?role=`、`?type=` 等查询参数原样保留；`/owner/studios`、`/owner/bridges`、`/owner/authorizations`
是老板独有页面，继续保留原地址。

## 已删除的内部页

- `/ui-kit`：设计校对页（内部工具，不面向用户）
- `/profile-setup`：独立首次资料页；游戏资料已并入「个人设置 → 游戏资料」卡
  （`apps/web/src/components/CompanionGameProfileCard.tsx`）

## 后续

- P2：订单中心（派单 / 全部 / 成交核对）、客户中心、财务中心页签化，URL 继续用旧地址重定向
- P3：工作台 / 财务聚合接口，减少前端多请求拼页；删掉真正重复的旧接口前先跑契约测试
- 原则：**功能不减少，入口不增加；旧书签不失效**
