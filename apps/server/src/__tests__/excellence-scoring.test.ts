import { describe, it, expect, vi } from 'vitest';
import { ExcellenceService } from '../companions/excellence.service';

/**
 * 综合评分口径回归（老板 2026-10-04 拍板）。
 *
 * 老板原话：「别搞这么复杂，直接流水达到多少、复购率达到多少、续单率达到多少、
 * 首单成功率多少给多少分就行了，满足条件就加上这个分」。
 *
 * 以前是「取达到的最高那一档的分」（阶梯取最高），现在改成 **达标累加**：
 * 每一条「达到 X 加 Y 分」的规则，够到就把 Y 加进去。下面锁住这个口径，
 * 用的是线上那份真实配置，谁改回去这几个用例会直接变红。
 */
const LIVE_CFG = [
  { key: 'excellence.revenue_tiers', value: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.repurchase_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.first_success_tiers', value: [{ min: 0, score: 0 }, { min: 40, score: 5 }, { min: 70, score: 10 }] },
  { key: 'excellence.excellent_threshold', value: 999 },
  { key: 'excellence.middle_tier_threshold', value: 0 },
];

function setup(opts: {
  cfg?: Array<{ key: string; value: any }>;
  /** 已完成单按类型计数：companionId -> { NEW / RENEW / REPURCHASE } */
  doneByType?: Record<string, Record<string, number>>;
  monthlyRevenue?: Record<string, number>;
  /** 抢到的首单数（任意状态） */
  newGrabs?: Record<string, number>;
  /** 首单成交的去重客户数 */
  newCustomers?: Record<string, number>;
  bonus?: Record<string, number>;
  thresholdOverride?: { excellent?: number; middle?: number };
}) {
  const cfg = (opts.cfg ?? LIVE_CFG).map((row) => {
    if (opts.thresholdOverride && row.key === 'excellence.excellent_threshold') return { ...row, value: opts.thresholdOverride.excellent ?? row.value };
    if (opts.thresholdOverride && row.key === 'excellence.middle_tier_threshold') return { ...row, value: opts.thresholdOverride.middle ?? row.value };
    return row;
  });

  const rowsByType: Array<{ companionId: string; type: string; _count: { id: number } }> = [];
  for (const [companionId, byType] of Object.entries(opts.doneByType ?? {})) {
    for (const [type, count] of Object.entries(byType)) rowsByType.push({ companionId, type, _count: { id: count } });
  }

  const prisma = {
    order: {
      groupBy: vi.fn((args: any) => {
        if (Array.isArray(args?.by) && args.by.includes('type')) return Promise.resolve(rowsByType);
        if (args?._sum?.amount) {
          return Promise.resolve(Object.entries(opts.monthlyRevenue ?? {}).map(([companionId, amount]) => ({ companionId, _sum: { amount } })));
        }
        return Promise.resolve(Object.entries(opts.newGrabs ?? {}).map(([companionId, n]) => ({ companionId, _count: { id: n } })));
      }),
      findMany: vi.fn(() => {
        const rows: Array<{ companionId: string; customerId: string }> = [];
        for (const [companionId, n] of Object.entries(opts.newCustomers ?? {})) {
          for (let i = 0; i < n; i++) rows.push({ companionId, customerId: `${companionId}-c${i}` });
        }
        return Promise.resolve(rows);
      }),
    },
    companion: {
      findMany: vi.fn((args: any) => {
        const ids: string[] = args?.where?.id?.in ?? [];
        return Promise.resolve(ids.map((id) => ({ id, bonusScore: opts.bonus?.[id] ?? 0, studioId: 'studio-1' })));
      }),
    },
    systemConfig: { findMany: vi.fn(() => Promise.resolve(cfg)) },
    studioConfig: { findMany: vi.fn(() => Promise.resolve([])) },
  };

  return new ExcellenceService(prisma as never);
}

describe('综合评分：达到就加分（达标累加）', () => {
  it('四项各自达标累加，再叠加战绩图加分（用线上那份配置）', async () => {
    const svc = setup({
      // 26 单：首单 4、续单 12、复购 10 → 续单率 12/26=46%、复购率 10/26=38%
      doneByType: { c1: { NEW: 4, RENEW: 12, REPURCHASE: 10 } },
      monthlyRevenue: { c1: 8500 },
      newGrabs: { c1: 20 },
      newCustomers: { c1: 16 }, // 首单成功率 80%
      bonus: { c1: 3 },
    });

    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;

    // 月流水 8500：0 + 20(3000) + 40(6000) = 60（没到 10000，那 50 分不加）
    expect(r.revenueScore).toBe(60);
    // 续单率 46%：0 + 10(30%) = 10（没到 60%，那 20 分不加）
    expect(r.renewScore).toBe(10);
    // 复购率 38%：0 + 10(30%) = 10（没到 60%，那 20 分不加）
    expect(r.repurchaseScore).toBe(10);
    // 首单成功率 80%：0 + 5(40%) + 10(70%) = 15
    expect(r.firstSuccessScore).toBe(15);
    expect(r.bonusScore).toBe(3);
    expect(r.rankScore).toBe(60 + 10 + 10 + 15 + 3);
    expect(r.renewRate).toBe(46);
    expect(r.repurchaseRate).toBe(38);
    expect(r.newRate).toBe(80);
  });

  it('每一条都是独立的「达到 X 加 Y 分」：够到几条加几条', async () => {
    const cfg = [
      { key: 'excellence.revenue_tiers', value: [{ min: 3000, score: 20 }, { min: 6000, score: 30 }] },
      { key: 'excellence.renew_tiers', value: [] },
      { key: 'excellence.repurchase_tiers', value: [] },
      { key: 'excellence.first_success_tiers', value: [] },
      { key: 'excellence.excellent_threshold', value: 50 },
      { key: 'excellence.middle_tier_threshold', value: 25 },
    ];
    const low = setup({ cfg, monthlyRevenue: { c1: 5000 }, bonus: {} });
    expect((await low.computeForCompanions(['c1'])).get('c1')!.rankScore).toBe(20);

    const high = setup({ cfg, monthlyRevenue: { c1: 6000 }, bonus: {} });
    expect((await high.computeForCompanions(['c1'])).get('c1')!.rankScore).toBe(50);
  });

  it('段位按配置的线判定（线上现在是 999 / 0，所以谁都是中等马）', async () => {
    const svc = setup({
      doneByType: { c1: { NEW: 4, RENEW: 12, REPURCHASE: 10 } },
      monthlyRevenue: { c1: 12000 }, // 流水 110 分
      newGrabs: { c1: 20 },
      newCustomers: { c1: 16 },
      bonus: { c1: 3 },
      thresholdOverride: { excellent: 100, middle: 20 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.excellentThreshold).toBe(100);
    expect(r.middleTierThreshold).toBe(20);
    expect(r.rankScore).toBe(110 + 10 + 10 + 15 + 3); // 148 >= 100
    expect(r.isExcellent).toBe(true);
    expect(r.tier).toBe('TOP');

    // 同一个人、同样的分，线抬到 999 就退回中等马（线上现在就是这个配置）
    const high = setup({
      doneByType: { c1: { NEW: 4, RENEW: 12, REPURCHASE: 10 } },
      monthlyRevenue: { c1: 12000 },
      newGrabs: { c1: 20 },
      newCustomers: { c1: 16 },
      bonus: { c1: 3 },
      thresholdOverride: { excellent: 999, middle: 0 },
    });
    const r2 = (await high.computeForCompanions(['c1'])).get('c1')!;
    expect(r2.isExcellent).toBe(false);
    expect(r2.tier).toBe('MIDDLE');
  });

  it('一单都没成交的人也有结果（战绩图加分不再被吞掉）', async () => {
    const svc = setup({ doneByType: {}, bonus: { c2: 4 } });
    const r = (await svc.computeForCompanions(['c2'])).get('c2')!;
    expect(r.orderCount).toBe(0);
    expect(r.rankScore).toBe(4);
    expect(r.revenueScore).toBe(0);
  });
});
