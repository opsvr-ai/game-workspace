import { describe, it, expect, vi } from 'vitest';
import { ExcellenceService } from '../companions/excellence.service';

/**
 * 综合评分口径回归（老板 2026-10-04 三次拍板）。
 *
 * 第一次：「只需要到了什么档次 就给他重新统计为多少分就行了……别叠加，我要求整体别超过 100 分」
 * → 每一项取**达到的最高那一档**的分数，不把几档加起来。
 *
 * 第二次：「假设这个陪玩一直跟某 2 个客户玩，流水达到 10000 了，也才 50 分……」+「按照你的建议把 30 天」
 * → 续单率 / 复购率 改成 **按客户算 + 只看最近 30 天**，不再按「订单类型」算。
 *
 * 第三次（本次）：
 *   · 续单 = 该客户在你这有**第 2 段及以后会话**（点「续单」加出来的那段），或有一张 RENEW / REPURCHASE 成交单；
 *   · 复购 = 打完首单 / 续单后，**隔了一个营业日**客户又来打了（另有一张成交单）；
 *   · 首单成功率 = 成交首单客户数 / **添加成功数**；
 *   · 续单率 / 复购率**分母统一 = 打了首单的客户数**；窗口 30 天；营业日以 **12:00** 为界。
 *   两栏仍然**不互斥**：隔天回头的客户两边都算。
 */

const LIVE_CFG = [
  { key: 'excellence.revenue_tiers', value: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.repurchase_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.first_success_tiers', value: [{ min: 0, score: 0 }, { min: 40, score: 5 }, { min: 70, score: 10 }] },
  // 老板 2026-10-04 拍板：上等马 90 / 中等马 60（原来是 999 / 0，等于谁都不升不降）
  { key: 'excellence.excellent_threshold', value: 90 },
  { key: 'excellence.middle_tier_threshold', value: 60 },
];

type CustSpec = {
  cust: string;
  /** 这个客户在窗口内的成交单数 */
  count: number;
  /** 这些单都发生在同一个营业日（默认每单各自一个营业日 → 隔了一个营业日，算复购） */
  sameDay?: boolean;
  /** 这个客户在你这总共有多少段会话（默认 = 单数；给更大的值表示同一张单里点过「续单」加段） */
  sessions?: number;
};

function setup(opts: {
  cfg?: Array<{ key: string; value: any }>;
  /** 最近 30 天的成交：companionId -> 每个客户买了几单 / 几段 */
  doneOrders?: Record<string, CustSpec[]>;
  monthlyRevenue?: Record<string, number>;
  /** 最近 30 天这个陪玩标了「添加成功」的首单数（首单成功率的分母） */
  added?: Record<string, number>;
  bonus?: Record<string, number>;
  thresholdOverride?: { excellent?: number; middle?: number };
}) {
  const cfg = (opts.cfg ?? LIVE_CFG).map((row) => {
    if (opts.thresholdOverride && row.key === 'excellence.excellent_threshold') return { ...row, value: opts.thresholdOverride.excellent ?? row.value };
    if (opts.thresholdOverride && row.key === 'excellence.middle_tier_threshold') return { ...row, value: opts.thresholdOverride.middle ?? row.value };
    return row;
  });

  // 30 天内的成交单明细：默认每张单落在各自的营业日、各 1 段会话。
  const windowRows: any[] = [];
  for (const [companionId, custs] of Object.entries(opts.doneOrders ?? {})) {
    for (const c of custs) {
      const count = Math.max(1, c.count);
      const totalSessions = Math.max(count, c.sessions ?? count);
      for (let i = 0; i < count; i++) {
        const dayIdx = c.sameDay ? 0 : i;
        const sessions = i === 0 ? totalSessions - (count - 1) : 1;
        windowRows.push({
          companionId,
          customerId: `${companionId}-${c.cust}`,
          type: 'NEW',
          createdAt: new Date(2026, 9, 1 + dayIdx, 14, 0, 0),
          _count: { sessions },
        });
      }
    }
  }

  const prisma = {
    order: {
      groupBy: vi.fn((args: any) => {
        if (args?._sum?.amount) {
          return Promise.resolve(Object.entries(opts.monthlyRevenue ?? {}).map(([companionId, amount]) => ({ companionId, _sum: { amount } })));
        }
        return Promise.resolve(Object.entries(opts.added ?? {}).map(([companionId, n]) => ({ companionId, _count: { id: n } })));
      }),
      findMany: vi.fn(() => Promise.resolve(windowRows)),
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
    // 26 个客户：4 个只打 1 单、12 个打了 2 单、10 个打了 3 单（默认每单各一个营业日）
    // 分母 = 打了首单的客户数 = 26；续单 = 22（有第 2 段）、复购 = 22（隔了营业日）→ 都 85%
    const svc = setup({
      doneOrders: {
        c1: [
          ...Array.from({ length: 4 }, (_, i) => ({ cust: `a${i}`, count: 1 })),
          ...Array.from({ length: 12 }, (_, i) => ({ cust: `b${i}`, count: 2 })),
          ...Array.from({ length: 10 }, (_, i) => ({ cust: `c${i}`, count: 3 })),
        ],
      },
      monthlyRevenue: { c1: 8500 },
      added: { c1: 32 }, // 成交 26 个首单 ÷ 加了 32 个微信 = 81%
      bonus: { c1: 3 },
    });

    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;

    expect(r.revenueScore).toBe(40); // 8500 → 最高一档 6000 = 40 分（不是 20+40）
    expect(r.renewScore).toBe(20); // 85% ≥ 60% → 20
    expect(r.repurchaseScore).toBe(20); // 85% ≥ 60% → 20
    expect(r.firstSuccessScore).toBe(10); // 81% ≥ 70% → 10
    expect(r.bonusScore).toBe(3);
    expect(r.renewRate).toBe(85);
    expect(r.repurchaseRate).toBe(85);
    expect(r.newRate).toBe(81);
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

describe('回头客口径：按客户算 + 最近 30 天 + 12 点营业日', () => {
  it('只吃老客的陪玩也能上上等马（老板那个例子：流水过万 + 2 个老客户一直玩）', async () => {
    const svc = setup({
      // 2 个客户，每人打了 5 单（隔天再来）→ 续单 2/2=100%、复购 2/2=100%
      doneOrders: { c1: [{ cust: 'a', count: 5 }, { cust: 'b', count: 5 }] },
      monthlyRevenue: { c1: 10000 },
      added: { c1: 0 }, // 一个首单都没吃工作室的
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
    expect(r.renewRate).toBe(100); // 5 个客户全部有第 2 段
    expect(r.repurchaseRate).toBe(100); // 5 个客户全部隔了营业日又回来
  });

  it('分母就是「打了首单的客户数」：只有 1 个客户、只有 1 单 → 两栏都是 0', async () => {
    const svc = setup({ doneOrders: { c1: [{ cust: 'a', count: 1 }] }, monthlyRevenue: { c1: 6000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewRate).toBe(0);
    expect(r.repurchaseRate).toBe(0);
  });

  it('同一天里点「续单」加出来的第 2、3 段：算续单、不算复购（12 点前接着打）', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1, sessions: 3 }] }, // 1 张单里点了 2 次续单
      monthlyRevenue: { c1: 6000 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewRate).toBe(100); // 第 2 段及以后 → 续单
    expect(r.repurchaseRate).toBe(0); // 还是同一个营业日 → 不算复购
  });

  it('隔了一个营业日又来打：续单、复购都算', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1, sessions: 3 }, { cust: 'b', count: 2 }] },
      monthlyRevenue: { c1: 6000 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.renewRate).toBe(100); // a 靠第 2 段、b 靠第 2 单
    expect(r.repurchaseRate).toBe(50); // 只有 b 隔了营业日
  });

  it('首单成功率 = 成交首单客户数 / 添加成功数（加了微信没成交的人也进分母）', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }, { cust: 'b', count: 1 }, { cust: 'c', count: 1 }] },
      monthlyRevenue: { c1: 6000 },
      added: { c1: 10 }, // 加了 10 个微信，成交 3 个首单
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(30);
    expect(r.firstSuccessScore).toBe(0); // 30% 没够到 40% 那一档
  });

  it('一个「添加成功」都没有时，首单成功率是 0（不炸）', async () => {
    const svc = setup({ doneOrders: { c1: [{ cust: 'a', count: 1 }] }, monthlyRevenue: { c1: 6000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(0);
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
      added: { c1: 5 }, // 5 个客户 5 个首单 → 100%
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
