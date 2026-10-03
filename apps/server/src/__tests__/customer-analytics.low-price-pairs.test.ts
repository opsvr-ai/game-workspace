import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerAnalyticsService, LOW_PRICE_PAIR_WATCH_THRESHOLD } from '../finance/customer-analytics.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「低价搭档」关注表（老板 2026-10-04）：
 *   「这个陪玩经常被邀请，主陪经常在某个客户点首单/续单/复购，他+搭档经常填写最低价，
 *     这时候提醒我，我就会去重点关注这 2 个人了。」
 * 口径：机密 < 35 / 绝密 < 45 才算「低价」，只统计不拦单；
 * 同一对主陪+搭档反复低价到 LOW_PRICE_PAIR_WATCH_THRESHOLD 次 → watch 标红。
 */
function buildService(prisma: any) {
  return new CustomerAnalyticsService(prisma);
}

describe('CustomerAnalyticsService.getLowPricePairs（低价搭档关注）', () => {
  let prisma: MockPrisma;
  let service: CustomerAnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = buildService(prisma);
    (prisma.companion.findMany as any).mockResolvedValue([]);
  });

  const session = (over: Record<string, any> = {}) => ({
    id: 's1',
    companionId: 'A',
    coCompanionId: 'B',
    claimedMode: '机密',
    claimedPrice: 34,
    startedAt: new Date('2026-10-03T10:00:00Z'),
    parentOrder: { type: 'NEW', customerId: 'cus-1' },
    ...over,
  });

  it('只统计低于底线的双陪会话：机密 35 / 绝密 45 等于底线不算低价', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([
      session({ id: 's1', claimedPrice: 34 }),            // 机密 34 → 低价
      session({ id: 's2', claimedPrice: 35 }),            // 机密 35 → 不算
      session({ id: 's3', claimedMode: '绝密', claimedPrice: 44 }), // 绝密 44 → 低价
      session({ id: 's4', claimedMode: '绝密', claimedPrice: 45 }), // 绝密 45 → 不算
      session({ id: 's5', claimedMode: '普通', claimedPrice: 1 }),  // 未知模式 → 不算
    ]);

    const rows = await service.getLowPricePairs('studio-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].lowPriceCount).toBe(2);
    // 这条用例里 5 段都没填副陪金额，所以只有 s2(机密 35) / s4(绝密 45) 进「按底线」计数
    expect(rows[0].floorPriceCount).toBe(2);
    expect(rows[0].sessionCount).toBe(5);
    // 最低主陪价按这一对搭档的所有会话算，所以是 s5 那条 1 元
    expect(rows[0].minPriceYuan).toBe(1);
    expect(rows[0].minPartnerPriceYuan).toBeNull();
    expect(rows[0].modes.sort()).toEqual(['机密', '绝密']);
    expect(rows[0].customerCount).toBe(1);
    expect(rows[0].orderTypes).toEqual(['NEW']);
    expect(rows[0].watch).toBe(false);
  });

  it('副陪单价低于底线也算异常：主陪价正常、副陪填 0 / 填 30 都要抓出来', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([
      // 主陪 45（正常），副陪这段总价 0 → 副陪单价 0 → 异常
      session({ id: 's1', claimedMode: '机密', claimedPrice: 45, coAmount: 0, duration: 2 }),
      // 主陪 40（正常），副陪 2 小时只给 60 → 副陪单价 30 < 35 → 异常
      session({ id: 's2', claimedMode: '机密', claimedPrice: 40, coAmount: 60, duration: 2 }),
      // 主陪 40，副陪 2 小时 80 → 副陪单价 40 → 正常
      session({ id: 's3', claimedMode: '机密', claimedPrice: 40, coAmount: 80, duration: 2 }),
    ]);

    const rows = await service.getLowPricePairs('studio-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].lowPriceCount).toBe(2);
    expect(rows[0].minPartnerPriceYuan).toBe(0);
  });

  it('正好按底线（机密 35 / 绝密 45）打只进「按底线」计数，不标红', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([
      session({ id: 's1', claimedMode: '机密', claimedPrice: 35, coAmount: 35, duration: 1 }),
      session({ id: 's2', claimedMode: '绝密', claimedPrice: 45, coAmount: 45, duration: 1 }),
      session({ id: 's3', claimedMode: '机密', claimedPrice: 50, coAmount: 50, duration: 1 }),
    ]);

    const rows = await service.getLowPricePairs('studio-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].lowPriceCount).toBe(0);
    expect(rows[0].floorPriceCount).toBe(2);
    expect(rows[0].watch).toBe(false);
  });

  it('单陪会话（没有搭档）不进这张表', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([
      session({ coCompanionId: null, claimedPrice: 10 }),
    ]);
    expect(await service.getLowPricePairs('studio-1')).toEqual([]);
  });

  it('同一对搭档主陪/副陪换位也算一对，低价到 3 次标 watch', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([
      session({ id: 's1', companionId: 'A', coCompanionId: 'B', claimedPrice: 10 }),
      session({ id: 's2', companionId: 'B', coCompanionId: 'A', claimedPrice: 20 }),
      session({ id: 's3', companionId: 'A', coCompanionId: 'B', claimedPrice: 30 }),
    ]);
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'A', user: { username: 'a', displayName: '王昊' } },
      { id: 'B', user: { username: 'b', displayName: '王甲振' } },
    ]);

    const rows = await service.getLowPricePairs('studio-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].lowPriceCount).toBe(3);
    expect(rows[0].watch).toBe(true);
    expect(rows[0].watch).toBe(3 >= LOW_PRICE_PAIR_WATCH_THRESHOLD);
    expect(rows[0].mainCompanionName).toBe('王昊');
    expect(rows[0].partnerCompanionName).toBe('王甲振');
    // 最近一次 = 最后一条（按 startedAt 取最大）
    expect(rows[0].lastAt).toEqual(new Date('2026-10-03T10:00:00Z'));
  });

  it('老板不传工作室 = 看全站（不加 studioId 过滤）', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([session({ claimedPrice: 10 })]);
    await service.getLowPricePairs(null);
    const where = (prisma.orderSession.findMany as any).mock.calls[0][0].where;
    expect(where.parentOrder).toBeUndefined();
  });

  it('传了工作室就按工作室过滤', async () => {
    (prisma.orderSession.findMany as any).mockResolvedValue([]);
    await service.getLowPricePairs('studio-9');
    const where = (prisma.orderSession.findMany as any).mock.calls[0][0].where;
    expect(where.parentOrder).toEqual({ studioId: 'studio-9' });
  });
});