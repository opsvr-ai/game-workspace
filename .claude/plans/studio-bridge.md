## 工作室数据隔离 & 共享方案

### 默认：完全隔离

每个工作室数据独立 — 订单池/抢单/客户/报账/KPI 全部 `studioId` 过滤。

### 共享：Owner 发起 → 店长确认

```
Owner 发起打通 A ↔ B
  → A店长 接受?  B店长 接受?
  → 双向共享 A+B 的数据
  → 可配置: 订单池/抢单/客户/报账/KPI 分别开关
```

### 数据模型

```
StudioBridge: A工作室 ↔ B工作室, 状态(PENDING/ACTIVE/REJECTED)
StudioBridgePermission: 每个功能独立的接受/拒绝状态
```

### 查询适配

现有 `where.studioId` 将扩展为 `where.studioId IN [myStudio, ...bridgedStudios]`
