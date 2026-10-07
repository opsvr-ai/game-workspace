// craftsman-ignore: TS001,TS003
import { describe, it, expect } from 'vitest';
import {
  checkEntertainmentEligibility,
  computeEntertainmentFee,
  depositPlayedCredit,
  entertainmentMinutesLeft,
  entertainmentBasisRevenue,
  isEntertainmentFree,
  sumDepositPlayedToday,
} from '../common/entertainment-fee';

// 娱乐费在老板的系统里只有一个算法（看板 / 工作台 / 搭档结算 / 余额预警共用），
// 这里的用例就是那个算法的说明书。
describe('娱乐费唯一口径', () => {
  it('当日流水达到免单线 → 免费', () => {
    expect(
      computeEntertainmentFee({ minutes: 120, todayRevenue: 300, hourlyRate: 60, freeThreshold: 300 }),
    ).toBe(0);
  });

  it('没到免单线 → 按小时费率折算到分钟', () => {
    expect(
      computeEntertainmentFee({ minutes: 30, todayRevenue: 0, hourlyRate: 60, freeThreshold: 300 }),
    ).toBe(30);
  });

  it('费率为 0（老板线上现在填的就是 0）→ 全免', () => {
    expect(
      computeEntertainmentFee({ minutes: 120, todayRevenue: 0, hourlyRate: 0, freeThreshold: 0 }),
    ).toBe(0);
  });

  it('免单线填 0 表示不设免单线', () => {
    expect(
      computeEntertainmentFee({ minutes: 10, todayRevenue: 99999, hourlyRate: 60, freeThreshold: 0 }),
    ).toBe(10);
  });

  it('金额四舍五入到角', () => {
    // 7 分钟 × ¥50/小时 = ¥5.8333… → ¥5.8
    expect(
      computeEntertainmentFee({ minutes: 7, todayRevenue: 0, hourlyRate: 50, freeThreshold: 0 }),
    ).toBe(5.8);
  });

  it('异常输入不炸（负数分钟 / NaN）', () => {
    expect(computeEntertainmentFee({ minutes: -5, todayRevenue: 0, hourlyRate: 60, freeThreshold: 0 })).toBe(0);
    expect(computeEntertainmentFee({ minutes: NaN, todayRevenue: 0, hourlyRate: 60, freeThreshold: 0 })).toBe(0);
  });

  it('isEntertainmentFree 与扣费口径一致', () => {
    expect(isEntertainmentFree(300, 300)).toBe(true);
    expect(isEntertainmentFree(299, 300)).toBe(false);
    expect(isEntertainmentFree(99999, 0)).toBe(false);
  });
});

// ── 老板 2026-10-04：「打存单也算在娱乐那个门槛里」 ──
// 存单常加在老的续单上打（父单 createdAt 不是今天），按订单取数的当日流水会漏，
// 所以按「今天结束的存单会话」补一份；父单本身就是今天建的就不重复加。
describe('打存单也算进娱乐门槛（老板 2026-10-04）', () => {
  const day = { start: new Date('2026-10-04T12:00:00+08:00'), end: new Date('2026-10-05T12:00:00+08:00') };

  let lastArgs: any = null;
  const fakePrisma = (rows: any[]) =>
    ({
      orderSession: {
        findMany: async (args: any) => {
          lastArgs = args;
          return rows;
        },
      },
    }) as any;

  it('主陪按 单价×时长、副陪按那一段总价，各记一份', () => {
    expect(
      depositPlayedCredit({ companionId: 'c1', coCompanionId: 'c2', claimedPrice: 40, duration: 2, coAmount: 70 }),
    ).toEqual([
      { companionId: 'c1', amount: 80 },
      { companionId: 'c2', amount: 70 },
    ]);
  });

  it('父单是老的（不是今天建）→ 今天打掉的存单要补进门槛', async () => {
    const prisma = fakePrisma([
      {
        companionId: 'c1',
        coCompanionId: null,
        claimedPrice: 40,
        duration: 9,
        amount: 360,
        coAmount: null,
        parentOrder: { createdAt: new Date('2026-09-20T13:00:00+08:00') },
      },
    ]);
    const map = await sumDepositPlayedToday(prisma, ['c1'], day);
    expect(map.get('c1')).toBe(360);
    // 只查「今天结束 + 存单付款」的会话
    const where = lastArgs.where;
    expect(where.status).toBe('DONE');
    expect(where.paidByDeposit).toBe(true);
    expect(where.endedAt).toEqual({ gte: day.start, lt: day.end });
  });

  it('父单本身就是今天建的 → 已经在今日流水里，不重复加', async () => {
    const prisma = fakePrisma([
      {
        companionId: 'c1',
        coCompanionId: null,
        claimedPrice: 40,
        duration: 2,
        amount: 80,
        coAmount: null,
        parentOrder: { createdAt: new Date('2026-10-04T18:00:00+08:00') },
      },
    ]);
    const map = await sumDepositPlayedToday(prisma, ['c1'], day);
    expect(map.get('c1')).toBeUndefined();
  });

  it('副陪那份存单也记在副陪头上', async () => {
    const prisma = fakePrisma([
      {
        companionId: 'c1',
        coCompanionId: 'c2',
        claimedPrice: 40,
        duration: 9,
        amount: 360,
        coAmount: 315,
        parentOrder: { createdAt: new Date('2026-09-20T13:00:00+08:00') },
      },
    ]);
    const map = await sumDepositPlayedToday(prisma, ['c1', 'c2'], day);
    expect(map.get('c1')).toBe(360);
    expect(map.get('c2')).toBe(315);
  });

  it('查不到数据 / 报错都不炸（宁可少算，不让娱乐功能挂）', async () => {
    const map = await sumDepositPlayedToday({ orderSession: { findMany: async () => { throw new Error('boom'); } } } as any, ['c1'], day);
    expect(map.size).toBe(0);
    const empty = await sumDepositPlayedToday(fakePrisma([]), [], day);
    expect(empty.size).toBe(0);
  });

  it('门槛口径：流水 0 + 存单 300 = 300 → 免费', () => {
    const basis = entertainmentBasisRevenue(0, 300);
    expect(basis).toBe(300);
    expect(isEntertainmentFree(basis, 300)).toBe(true);
    expect(computeEntertainmentFee({ minutes: 540, todayRevenue: basis, hourlyRate: 10, freeThreshold: 300 })).toBe(0);
  });
});

// ── 「能不能进娱乐 / 该不该踢回空闲」的唯一判定（老板 2026-10-08） ──
// 老板报的原话：「刚才张权选择娱乐模式，怎么把 python 杀了，三角洲也进不去？」
// 线上现场：余额 0、押金 0、娱乐费率 10 元/小时、免单线 0（= 没开）——
// 于是「进娱乐 → 20 秒后被心跳按余额不足踢回空闲」，这十几秒里娱乐名单（python.exe）
// 和空闲名单（三角洲）各套了一遍，两边的进程都被杀了。
describe('娱乐能不能进 / 该不该踢（老板 2026-10-08）', () => {
  it('费率 0（全免）→ 谁都能玩，永远不踢', () => {
    expect(entertainmentMinutesLeft(0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(
      checkEntertainmentEligibility({ availableFunds: 0, hourlyRate: 0, freeThreshold: 0, freeToday: false }).ok,
    ).toBe(true);
  });

  it('余额够玩满 1 分钟 → 能进', () => {
    expect(entertainmentMinutesLeft(10, 60)).toBe(10);
    expect(
      checkEntertainmentEligibility({ availableFunds: 10, hourlyRate: 60, freeThreshold: 0, freeToday: false }).ok,
    ).toBe(true);
  });

  it('余额 0、也没到免单线 → 切状态那一下（enter）就该拒绝，并说清怎么办', () => {
    const verdict = checkEntertainmentEligibility({
      availableFunds: 0,
      hourlyRate: 10,
      freeThreshold: 0,
      freeToday: false,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.minutesLeft).toBe(0);
    expect(verdict.reason).toContain('余额 + 押金不够玩娱乐');
  });

  it('宽限只给「已经进去的人」：stay 刚进去 20 秒不踢，到 60 秒才踢；enter 一律不宽限', () => {
    const params = { availableFunds: 0, hourlyRate: 10, freeThreshold: 0, freeToday: false };
    expect(checkEntertainmentEligibility({ ...params, context: 'stay', elapsedSeconds: 20 }).ok).toBe(true);
    expect(checkEntertainmentEligibility({ ...params, context: 'stay', elapsedSeconds: 60 }).ok).toBe(false);
    expect(checkEntertainmentEligibility({ ...params, context: 'enter', elapsedSeconds: 20 }).ok).toBe(false);
  });

  it('免单线到了 → 余额 0 也能玩', () => {
    expect(
      checkEntertainmentEligibility({ availableFunds: 0, hourlyRate: 10, freeThreshold: 300, freeToday: true }).ok,
    ).toBe(true);
  });

  it('钱是负的 / NaN 一律当 0 处理，不返回 NaN', () => {
    expect(entertainmentMinutesLeft(-5, 60)).toBe(0);
    expect(entertainmentMinutesLeft(Number.NaN, 60)).toBe(0);
    expect(entertainmentMinutesLeft(100, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });
});
