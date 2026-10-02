// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-03 报：「订单 400 王甲振邀请徐泽宁，徐泽宁接受邀请后，一直不让徐泽宁启动游戏」。
 *
 * 根因：「接单中」只能由服务端自动进入（开始服务 / 接受搭档邀请），陪玩本人点不出来
 * —— ws.gateway 收到手动 BUSY 直接丢。可服务端把库里状态改成 BUSY 之后**没有推黑名单**，
 * 客户端于是停在「空闲」，把「空闲才杀」的那条黑名单继续挂着：他刚启动游戏就被自己的
 * 看门狗杀掉，看起来就是「接了单，却一直不让启动游戏」。
 *
 * 这两条用例锁住：主陪 / 搭档落库 BUSY 之后，都必须各推一次黑名单（先落库、再推）。
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
  // mock 里没铺的几个写操作：不补的话 `.catch` 会挂在 undefined 上直接炸
  (prisma as any).customer.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  (prisma as any).order.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  prisma.order.update = vi.fn().mockResolvedValue({});
  prisma.order.findUnique = vi.fn().mockResolvedValue({ customerId: null });
  prisma.orderSession.update = vi.fn().mockResolvedValue({ id: 'session-1' });
  prisma.companion.update = vi.fn().mockResolvedValue({ id: 'companion' });
  return { service, prisma, gateway };
}

describe('服务端自动进入「接单中」必须推黑名单（老板 2026-10-03）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('接受搭档邀请：主陪和搭档都落库 BUSY，且各推一次黑名单', async () => {
    const { service, prisma, gateway } = setup();
    prisma.orderSession.findUnique.mockResolvedValue({
      id: 'session-1',
      parentOrderId: 'order-400',
      companionId: 'main-1',
      coCompanionId: null,
      status: 'ACTIVE',
      startedAt: null,
      createdAt: new Date(),
      parentOrder: { id: 'order-400', companionId: 'main-1', gameName: '三角洲行动', studioId: 'studio-1' },
    });
    prisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE', studioId: 'studio-1' });

    await service.acceptPartnerInvite('session-1', 'partner-1');

    expect(prisma.companion.update).toHaveBeenCalledWith({ where: { id: 'main-1' }, data: { status: 'BUSY' } });
    expect(prisma.companion.update).toHaveBeenCalledWith({ where: { id: 'partner-1' }, data: { status: 'BUSY' } });
    expect(gateway.refreshCompanionBlacklist).toHaveBeenCalledWith('main-1');
    expect(gateway.refreshCompanionBlacklist).toHaveBeenCalledWith('partner-1');
  });

  it('开始服务：主陪 + 副陪都各推一次黑名单', async () => {
    const { service, prisma, gateway } = setup();
    prisma.orderSession.findUnique.mockResolvedValue({
      id: 'session-1',
      parentOrderId: 'order-400',
      companionId: 'main-1',
      coCompanionId: 'partner-1',
    });

    await service.startSession('session-1');

    expect(gateway.refreshCompanionBlacklist).toHaveBeenCalledWith('main-1');
    expect(gateway.refreshCompanionBlacklist).toHaveBeenCalledWith('partner-1');
  });
});
