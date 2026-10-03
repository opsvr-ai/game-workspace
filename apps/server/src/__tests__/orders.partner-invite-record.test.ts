// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-03：「陪玩抢单/发布订单都能在订单记录里找到，但是**被邀请方打的这个订单找不到**，
 * 给我在订单记录中生成」。
 *
 * 根因之一：搭档邀请**超时就把整段会话（以及复购/直接派单的订单）标成 DONE** ——
 * 陪玩在游戏里没看到横幅、或就差几秒，邀请一超时整段会话就作废，主陪只好重新开一单，
 * 被邀请方记录里什么都留不下，两边对不上账。
 *
 * 这两条用例锁住：
 *  1. 超时只撤「待搭档」（coCompanionId → null），会话保持 ACTIVE，主陪仍能单人开打 / 再邀请；
 *  2. 搭档接受后，**订单级**也要写上搭档（coCompanionId + coAmount），
 *     管理端按陪玩筛「今日打单记录」/ 看板 / 报表读的都是订单级字段。
 */
function setup() {
  const prisma = createMockPrisma();
  const gateway = {
    broadcastToStudio: vi.fn(),
    broadcastToBridgedStudios: vi.fn(),
    pushOrder: vi.fn(),
    pushToCompanion: vi.fn(),
    notifyUser: vi.fn(),
    refreshCompanionBlacklist: vi.fn().mockResolvedValue(undefined),
  };
  const service = new OrdersService(
    prisma as any,
    gateway as any,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn(), computeOne: vi.fn().mockResolvedValue({ tier: 'TOP', score: 0 }) } as any,
    { status: vi.fn(), ensure: vi.fn(), consume: vi.fn(), refund: vi.fn() } as any,
  );
  (prisma as any).customer.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  (prisma as any).order.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  prisma.order.update = vi.fn().mockResolvedValue({});
  prisma.order.findUnique = vi.fn().mockResolvedValue({ customerId: null });
  prisma.orderSession.update = vi.fn().mockResolvedValue({ id: 'session-1' });
  prisma.companion.update = vi.fn().mockResolvedValue({ id: 'companion' });
  return { service, prisma, gateway };
}

describe('搭档邀请 / 被邀请方的订单记录（老板 2026-10-03）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('邀请超时后再点接受：只撤搭档，不把会话/订单标 DONE', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findUnique.mockResolvedValue({
      id: 'session-1',
      parentOrderId: 'order-1',
      companionId: 'main-1',
      coCompanionId: null,
      coAmount: 35,
      status: 'ACTIVE',
      startedAt: null,
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      parentOrder: { id: 'order-1', companionId: 'main-1', gameName: '三角洲行动', studioId: 'studio-1' },
    });

    await expect(service.acceptPartnerInvite('session-1', 'partner-1')).rejects.toThrow();

    expect(prisma.orderSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { coCompanionId: null },
    });
    expect(prisma.orderSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }),
    );
  });

  it('搭档接受后：订单级写上 coCompanionId + coAmount（管理端按人筛选才查得到）', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findUnique.mockResolvedValue({
      id: 'session-1',
      parentOrderId: 'order-1',
      companionId: 'main-1',
      coCompanionId: null,
      coAmount: 35,
      status: 'ACTIVE',
      startedAt: null,
      createdAt: new Date(),
      parentOrder: { id: 'order-1', companionId: 'main-1', gameName: '三角洲行动', studioId: 'studio-1' },
    });
    prisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE', studioId: 'studio-1' });

    await service.acceptPartnerInvite('session-1', 'partner-1');

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({ coCompanionId: 'partner-1', coAmount: 35 }),
      }),
    );
  });
});
