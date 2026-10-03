// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionQuotaService, QUOTA_REASON } from '../orders/companion-quota.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';
import { businessDayKey } from '../common/business-day';

/**
 * 老板 2026-10-04 定的名额口径：
 *  - 抢单那一刻就扣（不是「添加成功 / 转账了才算」）；
 *  - 陪玩自己发的单、客服指定单不占；
 *  - 线下工作室（DIRECT）的预约单也占，线上俱乐部（RENTAL）不占；
 *  - 没用完的累计；每次变动写一行台账，点开能看到每天加了多少、用了多少。
 */
function setup() {
  const prisma = createMockPrisma();
  const excellence = { computeOne: vi.fn().mockResolvedValue({ tier: 'MIDDLE', score: 0 }) };
  const service = new CompanionQuotaService(prisma as any, excellence as any);
  prisma.studio.findUnique.mockResolvedValue({ type: 'DIRECT' });
  return { service, prisma, excellence };
}

describe('抢单名额：哪些单占名额', () => {
  beforeEach(() => vi.clearAllMocks());

  it('陪玩自己发布的单不占名额（哪怕是立即打）', () => {
    const { service } = setup();
    expect(service.countsOrder({ isPeerOrder: true, isImmediate: true, studioType: 'DIRECT' })).toBe(false);
  });

  it('立即打占名额（客服发的预约之外的单）', () => {
    const { service } = setup();
    expect(service.countsOrder({ isImmediate: true, studioType: 'RENTAL' })).toBe(true);
  });

  it('预约单：线下工作室占，线上俱乐部不占', () => {
    const { service } = setup();
    expect(service.countsOrder({ isImmediate: false, studioType: 'DIRECT' })).toBe(true);
    expect(service.countsOrder({ isImmediate: false, studioType: 'RENTAL' })).toBe(false);
  });

  it('查不到工作室类型时按线下算（宁可多扣一个）', async () => {
    const { service, prisma } = setup();
    prisma.studio.findUnique.mockResolvedValue(null);
    expect(await service.studioTypeOf('s-unknown')).toBe('DIRECT');
    expect(await service.studioTypeOf(null)).toBe('DIRECT');
  });
});

describe('抢单名额：扣 / 加 / 台账', () => {
  beforeEach(() => vi.clearAllMocks());

  it('抢单即扣：余额减 1，并写一条带订单号的 GRAB 台账', async () => {
    const { service, prisma } = setup();
    const today = new Date();
    prisma.companion.findUnique.mockResolvedValue({
      studioId: 's1',
      quotaBalance: 3,
      // 今天已经发过名额 → ensure 不再补发
      quotaGrantedThrough: today,
    });
    prisma.companion.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.reserve('c1', 1, { refId: 'order-1', note: '抢单扣名额 · 订单 O1' });

    expect(res.ok).toBe(true);
    expect(res.tier).toBe('MIDDLE');
    expect(res.dailyLimit).toBe(2);
    expect(prisma.companion.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', quotaBalance: { gte: 1 } },
      data: { quotaBalance: { decrement: 1 } },
    });
    expect(prisma.companionQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companionId: 'c1',
          delta: -1,
          reason: QUOTA_REASON.GRAB,
          refId: 'order-1',
        }),
      }),
    );
  });

  it('余额不足：扣不动，不写台账', async () => {
    const { service, prisma } = setup();
    prisma.companion.findUnique.mockResolvedValue({
      studioId: 's1',
      quotaBalance: 0,
      quotaGrantedThrough: new Date(),
    });
    prisma.companion.updateMany.mockResolvedValue({ count: 0 });

    const res = await service.reserve('c1');

    expect(res.ok).toBe(false);
    expect(prisma.companionQuotaLog.create).not.toHaveBeenCalled();
  });

  it('管理端同意补单：credit 加 1，写 SUPPLEMENT 台账', async () => {
    const { service, prisma } = setup();
    prisma.companion.update.mockResolvedValue({ studioId: 's1', quotaBalance: 4 });

    const balance = await service.credit('c1', 1, QUOTA_REASON.SUPPLEMENT, {
      refId: 'order-1',
      note: '管理端同意补单',
    });

    expect(balance).toBe(4);
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { quotaBalance: { increment: 1 } },
      select: { studioId: true, quotaBalance: true },
    });
    expect(prisma.companionQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delta: 1,
          reason: QUOTA_REASON.SUPPLEMENT,
          refId: 'order-1',
        }),
      }),
    );
  });

  it('首次遇到：按段位把今天的名额发下来，并记一笔 GRANT', async () => {
    const { service, prisma } = setup();
    prisma.companion.findUnique.mockResolvedValue({
      studioId: 's1',
      quotaBalance: 0,
      quotaGrantedThrough: null,
    });
    prisma.companion.update.mockResolvedValue({ quotaBalance: 2 });

    const res = await service.ensure('c1');

    expect(res).toEqual({ balance: 2, granted: 2 });
    expect(prisma.companionQuotaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delta: 2,
          reason: QUOTA_REASON.GRANT,
          dayKey: businessDayKey(new Date()),
        }),
      }),
    );
  });

  it('状态接口：带上每天加/用和最近明细，供陪玩点开看', async () => {
    const { service, prisma } = setup();
    prisma.companion.findUnique.mockResolvedValue({
      studioId: 's1',
      quotaBalance: 2,
      quotaGrantedThrough: new Date(),
    });
    prisma.companionQuotaLog.findMany.mockResolvedValue([
      { id: 'l1', delta: 2, reason: QUOTA_REASON.GRANT, refId: null, note: '每日名额', dayKey: businessDayKey(new Date()), createdAt: new Date() },
      { id: 'l2', delta: -1, reason: QUOTA_REASON.GRAB, refId: 'order-1', note: '抢单扣名额', dayKey: businessDayKey(new Date()), createdAt: new Date() },
    ]);

    const st = await service.status('c1');

    expect(st.remaining).toBe(2);
    expect(st.usedToday).toBe(1);
    expect(st.todayGranted).toBe(2);
    expect(st.days[0]).toMatchObject({ granted: 2, used: 1, net: 1 });
    expect(st.recentLogs).toHaveLength(2);
  });
});