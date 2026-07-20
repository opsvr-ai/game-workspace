# 蠢驴电竞陪玩派单管理系统 — 优化路线图

## Context

基于对项目三大维度（前端、后端、基础设施）的全面分析，发现 **38 个优化点**，按优先级分为 P0（安全紧急）→ P1（高影响改进）→ P2（质量提升）→ P3（长期战略）四个阶段。共约 **111 小时**工作量。

### 分析范围
- **前端**：26 个页面、10 个共享组件、单一 Zustand Store、零代码分割
- **后端**：12 个 Nest.js 模块、63 个源文件、6 个测试文件、26 个 Prisma 模型
- **基础设施**：Electron 桌面端、Docker、文档、CI/CD、安全性

---

## P0: 关键安全修复（必须立即处理）

| ID | 项目 | 严重性 | 文件 | 工时 |
|----|------|--------|------|------|
| P0-1 | 移除 JWT fallback secret `'fallback-secret'` | CRITICAL | `auth.module.ts`, `billing.module.ts` | 0.5h |
| P0-2 | 移除仓库中的测试密钥 | CRITICAL | `.env`, 新建 `.env.example` | 0.5h |
| P0-3 | 限制 WebSocket CORS `origin: '*'` | HIGH | `ws.gateway.ts` | 0.5h |
| P0-4 | Access token 有效期 24h → 15min | HIGH | `auth.service.ts` | 1h |
| P0-5 | 添加认证接口限流 (@nestjs/throttler) | HIGH | 新建 `rate-limit.config.ts` | 1h |
| P0-6 | 添加 Helmet 安全头中间件 | MEDIUM | `main.ts` | 0.5h |
| P0-7 | 添加缺失的 15+ 数据库索引 | HIGH | `schema.prisma` | 2h |

**P0 总计：~6h**

### P0-3 实现
```typescript
// ws.gateway.ts — 用验证函数替代 '*'
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8000').split(',');
cors: { origin: (origin, cb) => { /* 验证逻辑 */ } }
```

### P0-7 缺失索引
Order: `companionId`, `customerId`, `csUserId`, `status`, `(studioId, createdAt)`
Transaction: `companionId`, `(status, createdAt)`
Customer: `studioId`, `companionId`
Companion: `studioId`, `status`
ExpenseReport: `(studioId, status)`
WalletTransaction: `companionId`
CompanionTimeLog: `(companionId, startedAt)`
User: `studioId`
Expense: `(studioId, createdAt)`

---

## P1: 高影响改进（性能与架构）

| ID | 项目 | 影响 | 关键文件 | 工时 |
|----|------|------|----------|------|
| P1-1 | React.lazy 代码分割 | 初始包减小 ~60% | `router.tsx` | 2h |
| P1-2 | 拆分单体 Zustand Store | 消除全局重渲染 | 1 拆 4 store | 5h |
| P1-3 | 修复 AppLayout 1.5s 轮询重渲染 | 用户感知性能 | `AppLayout.tsx` | 3h |
| P1-4 | 聊天存储内存 → Redis | 持久化+扩展 | 新建 `chat/` 模块 | 6h |
| P1-5 | 拆分超大 Service（3个） | 可维护性 | companions/billing/orders | 13h |
| P1-6 | 消除重复收益分成逻辑（5处） | 一致性 | → `revenue-calculator.ts` | 3h |
| P1-7 | 拆分超大 React 页面（5个） | 可维护性 | BillingPage(1374L)等 | 14h |
| P1-8 | 添加 React.memo（10组件） | 渲染性能 | components/ 全量 | 2h |
| P1-9 | 抽取 4 个自定义 Hooks | DRY | hooks/ | 2h |
| P1-10 | 消除硬编码颜色→主题 Token | 视觉一致 | theme.ts + 10+文件 | 3h |

**P1 总计：~53h**

### 依赖链
```
P1-2 (拆分Store) ← P1-1, P1-3, P1-7, P1-8, P1-9 的前置
P1-3 (轮询修复) ← P1-4 的前置
P1-5 (拆分Service) ← P1-6 的前置
```

### P1-2 Store 拆分
```
authStore.ts (单体) → authStore.ts / chatStore.ts / orderStore.ts / uiStore.ts
```

### P1-7 页面拆分
```
BillingPage.tsx(1374L) → billing/ (TransactionList, ExpenseApproval, SettlementPanel, OverviewPanel, CompanionBillingView)
DispatchPage.tsx(903L) → dispatch/ (CSView, AdminView, CompanionView)
SettingsPage.tsx(654L) → settings/ (StudioSettings, NotificationSettings, PaymentSettings)
EmployeesPage.tsx(634L) → employees/ (EmployeeList, CreateEmployeeModal, EditEmployeeModal, ResetPasswordModal)
AppLayout.tsx(617L) → layouts/ (AppLayout~150L + UrgentOrderPopup, DualCompanionModal, CommandPalette)
```

---

## P2: 质量与可维护性

| ID | 项目 | 关键文件 | 工时 |
|----|------|----------|------|
| P2-1 | 抽取错误处理工具（替换59处重复） | `utils/error-handler.ts` | 1.5h |
| P2-2 | 添加 7 个未测试服务的测试 | `__tests__/` 新建 | 14h |
| P2-3 | 修复 7+ 空 catch 块 | 10 个文件 | 1h |
| P2-4 | 替换内联 require() → import | orders/companions controller | 0.25h |
| P2-5 | Swagger/OpenAPI 文档 | main.ts + 全部 DTO | 6h |
| P2-6 | 请求日志中间件 | `logger.middleware.ts` | 1h |
| P2-7 | ESLint + Prettier 配置 | 新建 .eslintrc/.prettierrc | 2.5h |
| P2-8 | 组织扁平 components/ | 按域分子目录 | 1h |
| P2-9 | 修复 API 模块违规 | api/auth.ts, AppLayout fetch | 1.5h |
| P2-10 | 修复 N+1 查询 | companions.service.ts:getRanking | 1.5h |
| P2-11 | 补充 7 个模块的 DTO | companions/dto/ 等 | 5h |
| P2-12 | 移除未使用 sharp 依赖 | companion-electron/package.json | 0.25h |

**P2 总计：~35h**

### P2-1 错误处理工具
```typescript
export function extractErrorMessage(error: unknown, fallback = '操作失败'): string {
  // 统一提取 Axios 错误、原生 Error、未知错误
}
// 替换前端 59 处 err?.response?.data?.message
```

### P2-10 N+1 修复
```typescript
// 替换 per-companion 查询为单条 groupBy
const orders = await this.prisma.order.groupBy({
  by: ['companionId', 'type'],
  where: { companionId: { in: companionIds }, status: 'DONE' },
  _sum: { amount: true }, _count: { id: true },
});
```

---

## P3: 长期战略

| ID | 项目 | 工时 |
|----|------|------|
| P3-1 | CI/CD (GitHub Actions) | 3h |
| P3-2 | Dockerfile + docker-compose | 3h |
| P3-3 | 瘦身 companion-electron（移除死依赖） | 2.5h |
| P3-4 | 更新过期文档（Go→Electron） | 3h |
| P3-5 | 对齐依赖版本（同版本不同包） | 2.5h |
| P3-6 | 修复基础设施杂项（硬编码IP/tsconfig/editorconfig） | 1.5h |
| P3-7 | 结构化日志（Winston/Pino） | 2h |

**P3 总计：~17h**

---

## 推荐首次冲刺（2周）

**Week 1 — P0 安全紧急**
- Day 1: P0-1, P0-2, P0-4（JWT + 密钥，最高风险快速修复）
- Day 2: P0-3, P0-5, P0-6（CORS + 限流 + Helmet）
- Day 3-4: P0-7（DB 索引，先在 staging 测试）

**Week 2 — P1 核心（解锁后续工作）**
- Day 1-3: P1-2（拆分 Zustand Store，解锁 5 个 P1 项）
- Day 3-4: P1-3（聊天轮询修复，即时体验提升）
- Day 5-6: P1-10（颜色 Token）+ P1-1（代码分割）
- Day 7-8: P1-5 开始（拆分 companions service，可与前端并行）

---

## 验证策略

| 阶段 | 验证方式 |
|------|----------|
| P0 安全 | `grep` 无 fallback-secret；curl CORS 拒绝非授权来源；EXPLAIN ANALYZE 确认 Index Scan |
| P1 性能 | React DevTools Profiler 零无用重渲染；Lighthouse 评分提升；bundle 大小对比 |
| P2 质量 | `pnpm lint` 真实运行；测试覆盖率 >60%；Swagger UI `/api/docs` 可访问 |
| P3 基础设施 | GitHub Actions CI 通过；`docker compose up` 全栈可用；文档可跟随操作 |

---

## 工时汇总

| 阶段 | S项 | M项 | L项 | XL项 | 预估 |
|------|-----|-----|-----|------|------|
| P0 安全 | 5 | 2 | 0 | 0 | ~6h |
| P1 高影响 | 0 | 7 | 1 | 2 | ~53h |
| P2 质量 | 3 | 8 | 1 | 1 | ~35h |
| P3 长期 | 1 | 7 | 0 | 0 | ~17h |
| **合计** | **9** | **24** | **2** | **3** | **~111h** |
