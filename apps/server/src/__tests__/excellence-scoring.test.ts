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
 *
 * 第四次（本次）：
 *   · 段位多一条**最近 30 天流水硬门槛**（默认 5200 元）：没到线的人一律下等马，其他分再高也不算；
 *   · 反过来，**流水达标的人最低也是中等马**（要的少、挣得少可以理解，留着也妨）；
 *   · 四个档位表按老板举的例子定稿：流水 8000 + 三率都过半 = 90（上等马）、
 *     流水 10000 纯老客 = 90（上等马）、流水 6000 + 三率过半 = 80（中等马）。
 *     （纯新客打满也只有约 4050 元、够不到 5200 门槛 → 必然下等马，不是 60 分中等马。）
 *
 * 第五次（本次）：
 *   · 老板澄清「成交首单就是陪玩点了开始首单那个按钮」→ 首单成功率的**分子改成
 *     「点过『开始首单』（这张首单开过会话）的客户数」，不等单子结束**；
 *   · 分母同时从「添加成功的**单数**」改成「添加成功的**客户数**」（同一客户重复抢单只算一个）。
 *
 * 第六次（2026-10-04）：老板「所有指标都按照最近 30 天统计」→ **流水分档与流水硬门槛
 * 也从「本营业月」改成「最近 30 天」**（续单率 / 复购率 / 首单成功率本来就是 30 天），
 * 月初不再全员归零。变量名 monthlyRevenue* 保留，只换取数窗口。
 */

const LIVE_CFG = [
  { key: 'excellence.revenue_tiers', value: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 30 }, { min: 8000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 50, score: 20 }] },
  { key: 'excellence.repurchase_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 50, score: 20 }] },
  { key: 'excellence.first_success_tiers', value: [{ min: 0, score: 0 }, { min: 30, score: 5 }, { min: 50, score: 10 }] },
  // 老板 2026-10-04 拍板：上等马 90 / 中等马 60（原来是 999 / 0，等于谁都不升不降）
  { key: 'excellence.excellent_threshold', value: 90 },
  { key: 'excellence.middle_tier_threshold', value: 60 },
  // 最近 30 天流水硬门槛（第四次拍板）：「月流水没过 5200 在我眼里就是下等马，就算他各种 KPI 都高」
  { key: 'excellence.revenue_floor', value: 5200 },
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
  /** 最近 30 天这个陪玩标了「添加成功」的**客户数**（首单成功率的分母；按客户去重） */
  added?: Record<string, number>;
  /** 直接给「添加成功」的明细（重复的 customerId 用来验分母去重） */
  addedList?: Array<{ companionId: string; customerId: string }>;
  /** 点了「开始首单」、但这张单还没结束的客户数（首单成功率的分子也要算） */
  startedNotDone?: Record<string, number>;
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

  // 点过「开始首单」的单：默认 = 上面那些成交单（每张都有会话），再加上「开了会话但还没结束」的。
  const startedRows: any[] = windowRows.map((r) => ({ ...r }));
  for (const [companionId, n] of Object.entries(opts.startedNotDone ?? {})) {
    for (let i = 0; i < Number(n); i++) {
      startedRows.push({
        companionId,
        customerId: `${companionId}-started${i}`,
        type: 'NEW',
        createdAt: new Date(2026, 9, 2, 14, 0, 0),
        _count: { sessions: 1 },
      });
    }
  }

  const prisma = {
    order: {
      groupBy: vi.fn((args: any) => {
        if (args?._sum?.amount) {
          return Promise.resolve(Object.entries(opts.monthlyRevenue ?? {}).map(([companionId, amount]) => ({ companionId, _sum: { amount } })));
        }
        return Promise.resolve([]);
      }),
      findMany: vi.fn((args: any) => {
        const where = args?.where ?? {};
        if (where.contactStatus === 'added') {
          if (opts.addedList) return Promise.resolve(opts.addedList);
          const rows: any[] = [];
          for (const [companionId, n] of Object.entries(opts.added ?? {})) {
            for (let i = 0; i < Number(n); i++) {
              rows.push({ companionId, customerId: `${companionId}-added${i}` });
            }
          }
          return Promise.resolve(rows);
        }
        if (where.status === 'DONE') return Promise.resolve(windowRows);
        return Promise.resolve(startedRows);
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

  it('成交首单 = 点了「开始首单」的客户：单子还没结束也算（老板 2026-10-04 澄清）', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }] }, // 只有 1 个客户把单结了
      startedNotDone: { c1: 2 }, // 另外 2 个点了「开始首单」、还在打
      monthlyRevenue: { c1: 6000 },
      added: { c1: 4 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(75); // 3 / 4
    expect(r.firstSuccessScore).toBe(10);
  });

  it('分母按客户去重：同一个客户抢了两张单都标添加成功，只算 1 个', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }] },
      monthlyRevenue: { c1: 6000 },
      addedList: [
        { companionId: 'c1', customerId: 'c1-a' },
        { companionId: 'c1', customerId: 'c1-a' },
      ],
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(100);
  });

  it('理论上分子不会超过分母；真超了按 100% 封顶（不出现 200% 这种数）', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }, { cust: 'b', count: 1 }] },
      monthlyRevenue: { c1: 6000 },
      added: { c1: 1 },
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(100);
  });

  it('首单成功率 = 成交首单客户数 / 添加成功客户数（加了微信没成交的人也进分母）', async () => {
    const svc = setup({
      doneOrders: { c1: [{ cust: 'a', count: 1 }, { cust: 'b', count: 1 }, { cust: 'c', count: 1 }] },
      monthlyRevenue: { c1: 6000 },
      added: { c1: 10 }, // 加了 10 个微信，成交 3 个首单
    });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.newRate).toBe(30);
    expect(r.firstSuccessScore).toBe(5); // 30% 正好够到「过 30% 得 5 分」那一档（新表）
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

describe('健壮性', () => {
  it('令牌里没有 companionId（传进 undefined）时不炸，直接返回空结果', async () => {
    const svc = setup({});
    const r = await svc.computeForCompanions([undefined as unknown as string]);
    expect(r.size).toBe(0);
  });
});

describe('最近 30 天流水硬门槛：没到线一律下等马，流水达标最低中等马（老板 2026-10-04）', () => {
  /** 2 个客户各打 2 单（隔天）→ 续单 100%、复购 100%；成交 2 个首单 ÷ 加了 3 个微信 = 67% */
  const hotCustomerSpec = { c1: [{ cust: 'a', count: 2 }, { cust: 'b', count: 2 }] };
  const hotExtra = { added: { c1: 3 } };

  it('流水 8000 + 三率都过半 = 40+20+20+10 = 90 → 上等马（老板举的目标画像）', async () => {
    const svc = setup({ ...hotExtra, doneOrders: hotCustomerSpec, monthlyRevenue: { c1: 8000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.rankScore).toBe(90);
    expect(r.tier).toBe('TOP');
  });

  it('流水 6000 + 三率都过半 = 30+20+20+10 = 80 → 中等马（差一点的那个）', async () => {
    const svc = setup({ ...hotExtra, doneOrders: hotCustomerSpec, monthlyRevenue: { c1: 6000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.rankScore).toBe(80);
    expect(r.tier).toBe('MIDDLE');
  });

  it('流水 5000 + 三率都过半（分数 70）：没到 5200 就是下等马，分数再高也不算', async () => {
    const svc = setup({ ...hotExtra, doneOrders: hotCustomerSpec, monthlyRevenue: { c1: 5000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.rankScore).toBe(70); // 20 + 20 + 20 + 10
    expect(r.tier).toBe('LOW');
    expect(r.isExcellent).toBe(false);
  });

  it('流水刚到 5200、其他全是 0：分数只有 20，但流水达标 → 至少中等马', async () => {
    const svc = setup({ doneOrders: {}, monthlyRevenue: { c1: 5200 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.rankScore).toBe(20);
    expect(r.tier).toBe('MIDDLE');
  });

  it('门槛填 0 = 关掉这条硬线，退回纯分数判段位', async () => {
    const cfg = LIVE_CFG.map((row) =>
      row.key === 'excellence.revenue_floor' ? { ...row, value: 0 } : row,
    );
    const svc = setup({ ...hotExtra, cfg, doneOrders: hotCustomerSpec, monthlyRevenue: { c1: 5000 } });
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;
    expect(r.rankScore).toBe(70);
    expect(r.tier).toBe('MIDDLE'); // 70 ≥ 中等马线 60
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
    expect(r1.revenueFloor).toBe(5200);
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

describe('流水窗口 = 最近 30 天（老板 2026-10-04「所有指标都按照最近 30 天统计」）', () => {
  it('取数不再卡「营业月」：上界去掉、下界是 30 天前，流水分档照算', async () => {
    const groupByArgs: any[] = [];
    const prisma = {
      order: {
        groupBy: vi.fn((args: any) => {
          groupByArgs.push(args);
          if (args?._sum?.amount) {
            return Promise.resolve([{ companionId: 'c1', _sum: { amount: 12000 } }]);
          }
          return Promise.resolve([]);
        }),
        findMany: vi.fn(() => Promise.resolve([])),
      },
      companion: {
        findMany: vi.fn((args: any) =>
          Promise.resolve(
            (args?.where?.id?.in ?? []).map((id: string) => ({ id, bonusScore: 0, studioId: 'studio-1' })),
          ),
        ),
      },
      systemConfig: { findMany: vi.fn(() => Promise.resolve(LIVE_CFG)) },
      studioConfig: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const svc = new ExcellenceService(prisma as never);
    const r = (await svc.computeForCompanions(['c1'])).get('c1')!;

    const revCall = groupByArgs.find((a) => a?._sum?.amount);
    expect(revCall).toBeTruthy();
    // 不再有「次月 1 日 12:00」那种上界
    expect(revCall.where.createdAt.lt).toBeUndefined();
    // 下界正好是 30 天前（滚动窗口）
    const days = (Date.now() - new Date(revCall.where.createdAt.gte).getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    // 30 天 12000 元 → 达到最高档 50 分
    expect(r.revenueScore).toBe(50);
    expect(r.revenueYuan).toBe(12000);
  });
});
