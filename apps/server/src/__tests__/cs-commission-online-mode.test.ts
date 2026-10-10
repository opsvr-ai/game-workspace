import { describe, it, expect } from 'vitest';
import { CommissionService } from '../finance/commission.service';

/**
 * 线上俱乐部订单的客服提成口径（老板 2026-09-30「这些数我自己填」）。
 *
 * 两种口径都在「设置 → 客服设置」里由老板自己拨：
 *   - 按业绩比例（`commission.cs_online_rate_percent`，2026-09-29 定的口径，默认）；
 *   - 按成功单数 × 每单单价（`commission.cs_online_per_order_yuan`，`commission.cs_online_mode = 'PER_ORDER'`）。
 *
 * 这份测试只钉一件事：**拨了哪个口径就只有那一个数生效，两个数不会叠加**；
 * 没拨过（库里没有 `commission.cs_online_mode`）= 还是按业绩，钱一分不变。
 */

const STUDIO = 'st-own';
const CS = 'cs-1';
const MONTH = '2026-09';

/** 一张「本店客服发出去、被别人家陪玩接走并反馈成功」的单 */
const order = (over: Record<string, any> = {}) => ({
  id: 'o-1',
  orderCode: 'ON-1',
  type: 'NEW',
  status: 'DONE',
  contactStatus: 'CONTACTED',
  outcome: 'SUCCESS',
  outcomeReason: null,
  refundedAt: null,
  amount: 200,
  coAmount: null,
  duration: 1,
  coCompanionId: null,
  customFields: {},
  companionId: 'c-1',
  csUserId: CS,
  attributedCsUserId: null,
  claimedCsUserId: null,
  createdAt: new Date(),
  companion: {
    studio: { id: 'st-online', type: 'RENTAL' },
    user: { username: 'c1', displayName: '陪玩一' },
  },
  sessions: [{ startedAt: new Date() }],
  ...over,
});

/** 本店线下的单（陪玩是自家店的） */
const offlineOrder = (over: Record<string, any> = {}) =>
  order({ companion: { studio: { id: STUDIO, type: 'OFFLINE' }, user: { username: 'c2', displayName: '陪玩二' } }, ...over });

/** 桥接店接走的单（别家 OFFLINE 工作室） */
const bridgeOrder = (over: Record<string, any> = {}) =>
  order({ companion: { studio: { id: 'st-bridge', type: 'OFFLINE' }, user: { username: 'c3', displayName: '陪玩三' } }, ...over });

function makeService(configs: Record<string, any>, orders: any[]) {
  const prisma: any = {
    systemConfig: {
      findMany: async ({ where }: any) =>
        Object.entries(configs)
          .filter(([k]) => ((where && where.key && where.key.in) || []).includes(k))
          .map(([key, value]) => ({ key, value })),
    },
    studioConfig: { findMany: async () => [] },
    user: { findMany: async () => [{ id: CS, username: 'shaozh', displayName: '邵泽慧' }] },
    order: { findMany: async () => orders },
    csProfile: { findMany: async () => [] },
    payrollConfig: {
      findUnique: async () => ({ baseSalary: 2100, fullAttendanceDays: 4, lateDeduction: 0, absentDeduction: 0 }),
    },
    staffAttendance: { findMany: async () => [] },
    commissionRule: { findMany: async () => [] },
  };
  return new CommissionService(prisma);
}

const row0 = async (configs: Record<string, any>, orders: any[]) =>
  (await makeService(configs, orders).computeCsCommission(STUDIO, MONTH)).rows[0] as any;

describe('客服提成 · 线上口径（老板 2026-09-30）', () => {
  it('线上 · 没配过口径 = 按业绩比例（默认，钱不变）', async () => {
    // 业绩 200 × 5% = 10 元；「每单单价」这时完全不参与
    const row = await row0({ 'commission.cs_online_rate_percent': 5 }, [order()]);
    expect(row.onlineYuan).toBe(10);
    expect(row.totalYuan).toBe(10);
  });

  it('线上 · 按成功单数 × 每单单价（双陪算 2 单）', async () => {
    const single = await row0(
      { 'commission.cs_online_mode': 'PER_ORDER', 'commission.cs_online_per_order_yuan': 3, 'commission.cs_online_rate_percent': 5 },
      [order()],
    );
    // 1 单 × 3 元 = 3 元（业绩比例不再参与，不能两个一起加）
    expect(single.onlineYuan).toBe(3);

    const double = await row0(
      { 'commission.cs_online_mode': 'PER_ORDER', 'commission.cs_online_per_order_yuan': 3, 'commission.cs_online_rate_percent': 5 },
      [order({ coCompanionId: 'c-2', coAmount: 200 })],
    );
    // 双陪 = 2 单 × 3 元 = 6 元
    expect(double.onlineYuan).toBe(6);
  });

  it('线下 · max(业绩 × 比例, 保底)', async () => {
    // 业绩 50 × 1% = 0.5 元 → 不足保底 2 元，按保底发
    expect((await row0({}, [offlineOrder({ amount: 50 })])).offlineYuan).toBe(2);
    // 比例改成 5%：业绩 2000 × 5% = 100 元
    expect((await row0({ 'commission.cs_offline_rate_percent': 5 }, [offlineOrder({ amount: 2000 })])).offlineYuan).toBe(100);
  });

  it('桥接 · 按单量 × 每单单价（双陪算 2 单）', async () => {
    const row = await row0({ 'commission.cs_bridge_per_order_yuan': 1 }, [bridgeOrder({ coCompanionId: 'c-2' })]);
    expect(row.bridgeYuan).toBe(2);
  });

  it('今日看板 · 线上那几列跟着口径走，并且回显用的是哪一种', async () => {
    const byRate = await makeService({ 'commission.cs_online_rate_percent': 5 }, [order()]).getCsCommissionToday(STUDIO);
    expect(byRate.config.onlineMode).toBe('RATE');
    expect((byRate.csList[0] as any).onlineCommission).toBe(10);

    const byPerOrder = await makeService(
      { 'commission.cs_online_mode': 'PER_ORDER', 'commission.cs_online_per_order_yuan': 3, 'commission.cs_online_rate_percent': 5 },
      [order()],
    ).getCsCommissionToday(STUDIO);
    expect(byPerOrder.config.onlineMode).toBe('PER_ORDER');
    expect((byPerOrder.csList[0] as any).onlineCommission).toBe(3);
  });
});
