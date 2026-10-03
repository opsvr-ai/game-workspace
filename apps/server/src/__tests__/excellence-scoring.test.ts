import { describe, it, expect, vi } from 'vitest';
import { ExcellenceService } from '../companions/excellence.service';

/**
 * 综合评分口径回归（老板 2026-10-04 两次拍板）。
 *
 * 第一次：「只需要到了什么档次 就给他重新统计为多少分就行了……别叠加，我要求整体别超过 100 分」
 * → 每一项取**达到的最高那一档**的分数，不把几档加起来。
 *
 * 第二次（看到线上那张配置图之后）：「假设这个陪玩一直跟某 2 个客户玩，流水达到 10000 了，也才 50 分，
 * 复购率百分百也才 20 分，这种陪玩没消耗工作室几个首单，但是也才 70 分，还没达到 90 分上等马，
 * 是不是不合理」+「按照你的建议把 30 天」。
 * → 续单率 / 复购率 改成 **按客户算 + 只看最近 30 天**（同一个客户买第 2 单算续单、第 3 单起算复购），
 *   不再按「订单类型」算（那样两栏互斥、且线上没人点按钮）；首单成功率同样只看 30 天。
 *   成交客户不足 5 人按 5 人算，防 1 个客户刷满分。
 */

const LIVE_CFG = [
  { key: 'excellence.revenue_tiers', value: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', value: [{ min: 0, score: 0 }, { min: 10, score: 10 }, { min: 30, score: 20 }] },
  { key: 'excellence.repurchase_tiers', value: [{ min: 0, score: 0 }, { min: 10, score: 10 }, { min: 30, score: 20 }] },
  { key: 'excellence.first_success_tiers', value: [{ min: 0, score: 0 }, { min: 50, score: 5 }, { min: 100, score: 10 }] },
  // 老板 2026-10-04 拍板：上等马 90 / 中等马 60（原来是 999 / 0，等于谁都不升不降）
  { key: 'excellence.excellent_threshold', value: 90 },
  { key: 'excellence.middle_tier_threshold', value: 60 },
];

type CustSpec = { cust: string; count: number };

function setup(opts: {
  cfg?: Array<{ key: string; value: any }>;
  /** 最近 30 天的成单：companionId -> [{ cust, count }]（count = 这个客户买了几单，必须 ≥1） */
  doneOrders?: Record<string, CustSpec[]>;
  monthlyRevenue?: Record<string, number>;
  /** 最近 30 天抢到的首单数（任意状态） */
  newGrabs?: Record<string, number>;
  /** 最近 30 天首单成交的去重客户数 */
  newCustomers?: Record<string, number>;
  bonus?: Record<string, number>;
  thresholdOverride?: { excellent?: number; middle?: number };
}) {
  const cfg = (opts.cfg ?? LIVE_CFG).map((row) => {
    if (opts.thresholdOverride && row.key === 'excellence.excellent_threshold') return { ...row, value: opts.thresholdOverride.excellent ?? row.value };
    if (opts.thresholdOverride && row.key === 'excellence.middle_tier_threshold') return { ...row, value: opts.thresholdOverride.middle ?? row.value };
    return row;
  });

  const windowRows: Array<{ companionId: string; customerId: string }> = [];
  for (const [companionId, custs] of Object.entries(opts.doneOrders ?? {})) {
    for (const c of custs) {
      for (let i = 0; i < Math.max(1, c.count); i++) windowRows.push({ companionId, customerId: `${companionId}-${c.cust}` });
    }
  }
  const newCustomerRows: Array<{ companionId: string; customerId: string }> = [];
  for (const [companionId, n] of Object.entries(opts.newCustomers ?? {})) {
    for (let i = 0; i < n; i++) newCustomerRows.push({ companionId, customerId: `${companionId}-n${i}` });
  }

  const prisma = {
    order: {
      groupBy: vi.fn((args: any) => {
        if (args?._sum?.amount) {
          return Promise.resolve(Object.entries(opts.monthlyRevenue ?? {}).map(([companionId, amount]) => ({ companionId, _sum: { amount } })));
        }
        return Promise.resolve(Object.entries(opts.newGrabs ?? {}).map(([companionId, n]) => ({ companionId, _count: { id: n } })));
      }),
      // 两次 findMany：① 30 天成单明细（不带 type）② 首单成交客户（type=NEW）
      findMany: vi.fn((args: any) =>
        Promise.resolve(args?.where?.type === 'NEW' ? newCustomerRows : windowRows),
      ),
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

describe('综合评分：每项取达到的最高一档（不叠加）', () => {
  it('四项各取最高一档，再叠加战绩图加分', async () => {
    // 26 个成交客户：4 个只买过 1 单、12 个买过 2 单（回头）、10 个买过 3 单（常来）
    // → 续单率 (12+10)/26 = 85%、复购率 10/26 = 38%
    const svc = setup({
      doneOrders: {
        c1: [
          ...Array.from({ length: 4 }, (_, i) => ({ cust: `a${i}`, count: 1 })),
          ...Array.from({ length: 12 }, (_, i) => ({ cust: `b${i}`, count: 2 })),
          ...Array.from({ length: 10 }, (_, i) => ({ cust: `c${i}`, count: 3 })),
        ],
      },
      monthlyRevenue: { c1: 8500 },
      newGrabs: { c1: 20 },
      newCustomers: { c1: 16 }, // 首单成功率 80%
      bonus: { c1: 3 },
    });

    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;

    expect(r.revenueScore).toBe(40); // 8500 → 最高一档 6000 = 40 分（不是 20+40）
    expect(r.renewScore).toBe(20); // 46% ≥ 30% → 20
    expect(r.repurchaseScore).toBe(20); // 38% ≥ 30% → 20
    expect(r.firstSuccessScore).toBe(5); // 80% 只够到 50% 那一档 → 5 分（100% 那档才是 10）
    expect(r.bonusScore).toBe(3);
    expect(r.renewRate).toBe(85);
    expect(r.repurchaseRate).toBe(38);
    expect(r.newRate).toBe(80);
  });

  it('到了什么档次就是多少分：过万只拿最高档的 50，不是 20+40+50', async () => {
    const cfg = [
      { key: 'excellence.revenue_tiers', value: [{ min: 3000, score: 0 }, { min: 6000, score: 20 }, { min: 10000, score: 50 }] },
      { key: 'excellence.renew_tiers', value: [] },
      { key: 'excellence.repurchase_tiers', value: [] },
      { key: 'excellence.first_success_tiers', value: [] },
      { key: 'excellence.excellent_threshold', value: 90 },
      { key: 'excellence.middle_tier_threshold', value: 60 },
    ];
    const low = setup({ cfg, monthlyRevenue: { c1: 5000 } });
    expect((await low.computeForCompanions(['c1'])).get('c1')!.rankScore).toBe(0);

    const mid = setup({ cfg, monthlyRevenue: { c1: 6000 } });
    expect((await mid.computeForCompanions(['c1'])).get('c1')!.rankScore).toBe(20);

    const high = setup({ cfg, monthlyRevenue: { c1: 10000 } });
    expect((await high.computeForCompanions(['c1'])).get('c1')!.rankScore).toBe(50);
  });
});

describe('回头客口径：按客户算 + 只看最近 30 天', () => {
  it('只吃老客的陪玩也能上上等马（老板那个例子：流水过万 + 2 个老客户一直玩）', async () => {
    const svc = setup({
      // 2 个客户，每人买了 5 单 → 续单 2/5=40%、复购 2/5=40%（分母不足 5 人按 5 算）
      doneOrders: { c1: [{ cust: 'a', count: 5 }, { cust: 'b', count: 5 }] },
      monthlyRevenue: { c1: 10000 },
      newGrabs: { c1: 0 },
      newCustomers: { c1: 0 }, // 一个首单都没吃工作室的
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewScore).toBe(20);
    expect(r.repurchaseScore).toBe(20);
    expect(r.firstSuccessScore).toBe(0);
    expect(r.rankScore).toBe(90); // 50 + 20 + 20
    expect(r.tier).toBe('TOP'); // 上等马线正好 90
    expect(r.isExcellent).toBe(true);
  });

  it('旧口径互斥的问题不会再出现：全是复购单的人，续单率不再是 0', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 4 }, { cust: 'b', count: 3 }, { cust: 'c', count: 3 }, { cust: 'd', count: 2 }, { cust: 'e', count: 3 }] },
      monthlyRevenue: { c1: 6000 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewRate).toBe(100); // 5 个客户全部回头
    expect(r.repurchaseRate).toBe(80); // 5 个里 4 个买过 ≥3 单
  });

  it('小样本防刷：只有 1 个客户，分母按 5 人算，刷不出满分', async () => {
    const svc = setup({ doneOrders: { c1: [{ cust: 'a', count: 9 }] }, monthlyRevenue: { c1: 6000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewRate).toBe(20); // 1/5
    expect(r.repurchaseRate).toBe(20);
    expect(r.renewScore).toBe(10); // 达到 10% 这一档
  });

  it('一单都没成交的人也有结果（战绩图加分不再被吞掉）', async () => {
    const svc = setup({ doneOrders: {}, bonus: { c2: 4 } });
    const r = (await svc.computeForCompanions(['c2'])).get('c2')!;
    expect(r.orderCount).toBe(0);
    expect(r.rankScore).toBe(4);
    expect(r.revenueScore).toBe(0);
  });
});

describe('段位按配置的线判定', () => {
  it('线上新线 90 / 60：老客型 90 分是上等马，新客型 60 分是中等马', async () => {
    const oldCustomerType = setup({
      doneOrders: { c1: [{ cust: 'a', count: 5 }, { cust: 'b', count: 5 }] },
      monthlyRevenue: { c1: 10000 },
    });
    const r1 = (await oldCustomerType.computeForCompanions(['c1'])).get('c1')!;
    expect(r1.excellentThreshold).toBe(90);
    expect(r1.middleTierThreshold).toBe(60);
    expect(r1.tier).toBe('TOP');

    const newCustomerType = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }, { cust: 'b', count: 1 }, { cust: 'c', count: 1 }, { cust: 'd', count: 1 }, { cust: 'e', count: 1 }] },
      monthlyRevenue: { c1: 10000 },
      newGrabs: { c1: 10 },
      newCustomers: { c1: 10 }, // 首单成功率 100%
    });
    const r2 = (await newCustomerType.computeForCompanions(['c1'])).get('c1')!;
    expect(r2.rankScore).toBe(60); // 50 + 10
    expect(r2.tier).toBe('MIDDLE');
  });

  it('同一个人、同样的分，线抬到 999 就退回中等马', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 5 }, { cust: 'b', count: 5 }] },
      monthlyRevenue: { c1: 12000 },
      thresholdOverride: { excellent: 999, middle: 0 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.isExcellent).toBe(false);
    expect(r.tier).toBe('MIDDLE');
  });
});
