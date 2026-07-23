# OWNER 员工管理 三级标签

## Context

OWNER 的"员工管理"目前是单一路由 `/owner/employees`。需要改为二级+三级标签结构：

```
员工管理
├─ 线上俱乐部
│   ├─ 店长
│   ├─ 客服
│   └─ 陪玩
└─ 线下工作室
    ├─ 店长
    ├─ 客服
    └─ 陪玩
```

## 方案

复用现有 `EmployeesPage`，通过 URL query params 传递筛选条件：

| 菜单项 | 路由 | studioType | role |
|--------|------|------------|------|
| 线上俱乐部 → 店长 | `/owner/employees?studioType=RENTAL&role=ADMIN` | RENTAL | ADMIN |
| 线上俱乐部 → 客服 | `/owner/employees?studioType=RENTAL&role=CS` | RENTAL | CS |
| 线上俱乐部 → 陪玩 | `/owner/employees?studioType=RENTAL&role=COMPANION` | RENTAL | COMPANION |
| 线下工作室 → 店长 | `/owner/employees?studioType=DIRECT&role=ADMIN` | DIRECT | ADMIN |
| 线下工作室 → 客服 | `/owner/employees?studioType=DIRECT&role=CS` | DIRECT | CS |
| 线下工作室 → 陪玩 | `/owner/employees?studioType=DIRECT&role=COMPANION` | DIRECT | COMPANION |

## 修改文件

### 1. `AppLayout.tsx` — OWNER 菜单
将单条 `{ key: '/owner/employees', label: '员工管理' }` 替换为带 children 的二级+三级结构。

### 2. `EmployeesPage.tsx` — 读取 query params
从 `useSearchParams` 读取 `studioType` 和 `role`，用于：
- 自动设置工作室类型过滤（线上/RENTAL vs 线下/DIRECT）
- 自动设置角色过滤（ADMIN/CS/COMPANION）
- 页面标题显示对应标签名

### 3. `StudiosService.getEmployees()` — 后端加过滤
已有 `studioId` 参数，但缺 `studioType` 和 `role` 过滤。需要：
- 按 `studioType` 过滤工作室（RENTAL/DIRECT）
- 按 `role` 过滤用户

## 验证

1. OWNER 登录 → 侧边栏"员工管理"展开 → 看到"线上俱乐部"+"线下工作室"二级标签
2. 点击"线上俱乐部→陪玩" → 页面显示所有线上俱乐部的陪玩
3. 点击"线下工作室→店长" → 页面显示所有线下工作室的店长
