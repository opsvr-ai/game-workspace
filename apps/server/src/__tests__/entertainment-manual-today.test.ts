/**
 * 手工补录「今日业绩」（老板 2026-10-11）。
 *
 * 娱乐门槛 / 接单解锁 / 陪玩端首页看的都是**今日业绩**，而那个数是当天打单算出来的、手改不了
 * （「编辑财务 → 今日业绩」填了以前被服务端忽略）。现在老板能在「陪玩列表 → 编辑业绩」里补录：
 * 只算补录的那一个营业日，过了自动失效 —— 不然补录一次这个人就永久免单了。
 */
import { describe, expect, it } from 'vitest';
import { businessDayKey } from '../common/business-day';
import { loadEntertainmentStanding, manualTodayBoost } from '../common/entertainment-fee';

const todayKey = businessDayKey(new Date());
const otherDayKey = businessDayKey(new Date(Date.now() - 36 * 3600 * 1000));

describe('手工补录今日业绩 manualTodayBoost', () => {
  it('补录就是今天 → 加上它', () => {
    expect(manualTodayBoost({ todayRevenueBoost: 300, todayRevenueBoostDay: todayKey })).toBe(300);
  });

  it('补录是别的营业日 → 不算（不然补一次永久免单）', () => {
    expect(manualTodayBoost({ todayRevenueBoost: 300, todayRevenueBoostDay: otherDayKey })).toBe(0);
  });

  it('没补录过 / 拿不到人 → 0', () => {
    expect(manualTodayBoost({ todayRevenueBoost: 0, todayRevenueBoostDay: todayKey })).toBe(0);
    expect(manualTodayBoost({ todayRevenueBoost: 300, todayRevenueBoostDay: null })).toBe(0);
    expect(manualTodayBoost(null)).toBe(0);
  });
});

describe('娱乐门槛认补录的今日业绩（老板 2026-10-11）', () => {
  const fakePrisma = (boost: { todayRevenueBoost: number; todayRevenueBoostDay: string | null }) =>
    ({
      companion: {
        findUnique: async () => ({
          balance: 0,
          deposit: 0,
          status: 'AVAILABLE',
          studioId: null,
          ...boost,
        }),
      },
      order: { findMany: async () => [] },
      orderSession: { findMany: async () => [] },
      systemConfig: {
        findMany: async () => [{ key: 'entertainment.revenue_threshold', value: 300 }],
      },
      studioConfig: { findMany: async () => [] },
    }) as any;

  it('补到免单线 → 余额 0 也算「今天免费」', async () => {
    const standing = await loadEntertainmentStanding(
      fakePrisma({ todayRevenueBoost: 300, todayRevenueBoostDay: todayKey }),
      'c1',
    );
    expect(standing?.todayRevenue).toBe(300);
    expect(standing?.freeToday).toBe(true);
  });

  it('补录是昨天的 → 今天不免费（不会一直有效）', async () => {
    const standing = await loadEntertainmentStanding(
      fakePrisma({ todayRevenueBoost: 300, todayRevenueBoostDay: otherDayKey }),
      'c1',
    );
    expect(standing?.todayRevenue).toBe(0);
    expect(standing?.freeToday).toBe(false);
  });
});
