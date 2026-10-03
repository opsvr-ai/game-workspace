import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 点「续单」真正走的是 POST /orders/:id/sessions（addSession）。
 * 老板 2026-10-04：「陪玩去客户 B 的位置点续单，你怎么挡住？」
 * 以前这里只检查「要换的主陪属不属于同店」，发起人根本没查 —— 拿到别人的订单编号就能直接续单抢客户。
 * 现在先确认**这张单 / 这个客户是你的**（见 OrdersService.canActOnOrder）。
 */
function buildService(prisma: any) {
  return new OrdersService(
    prisma,
    {
      broadcastToStudio: vi.fn(),
      broadcastToBridgedStudios: vi.fn(),
      broadcastNewOrder: vi.fn().mockResolvedValue(0),
      broadcastUrgentToBridgedStudios: vi.fn().mockResolvedValue(0),
      broadcastToQualifiedIdleCompanions: vi.fn().mockResolvedValue(0),
      broadcastToBridgedIdleCompanionsByType: vi.fn().mockResolvedValue(0),
      notifyCompanion: vi.fn(),
      notifyUser: vi.fn(),
      pushOrder: vi.fn(),
      pushToCompanion: vi.fn(),
    } as any,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn().mockResolvedValue(false), computeOne: vi.fn() } as any,
    { status: vi.fn(), ensure: vi.fn(), consume: vi.fn().mockResolvedValue(true), refund: vi.fn() } as any,
  );
}

const baseOrder = {
  id: 'order-B',
  companionId: 'comp-other',
  coCompanionId: null,
  customerId: 'customer-B',
  studioId: 'studio-1',
  gameName: '三角洲行动',
};

describe('OrdersService.addSession 归属校验（点续单）', () => {
  let prisma: MockPrisma;
  let service: OrdersService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = buildService(prisma);
    (prisma.orderSession.findMany as any).mockResolvedValue([]);
    (prisma.orderSession.count as any).mockResolvedValue(0);
    (prisma.order.findUnique as any).mockResolvedValue(baseOrder);
    (prisma.customer.findUnique as any).mockResolvedValue({ companionId: 'comp-other' });
    (prisma.order.count as any).mockResolvedValue(0);
  });

  it('不是我的订单 / 客户 → 拿别人的订单编号点续单，直接拒', async () => {
    await expect(
      service.addSession('order-B', { actorCompanionId: 'comp-me', companionId: 'comp-me', amount: 40 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addSession('order-B', { actorCompanionId: 'comp-me', companionId: 'comp-me', amount: 40 } as any),
    ).rejects.toThrow(/这不是你的订单/);
    expect(prisma.orderSession.create).not.toHaveBeenCalled();
  });

  it('我是这张单的主陪 → 放行', async () => {
    (prisma.order.findUnique as any).mockResolvedValue({ ...baseOrder, companionId: 'comp-me' });
    await expect((service as any).canActOnOrder({ ...baseOrder, companionId: 'comp-me' }, 'comp-me')).resolves.toBe(true);
  });

  it('我是这张单的副陪 → 放行', async () => {
    const o = { ...baseOrder, companionId: 'comp-other', coCompanionId: 'comp-me' };
    await expect((service as any).canActOnOrder(o, 'comp-me')).resolves.toBe(true);
  });

  it('我在这张单的历史会话里打过（接手继续）→ 放行', async () => {
    (prisma.orderSession.count as any).mockResolvedValue(1);
    await expect((service as any).canActOnOrder(baseOrder, 'comp-me')).resolves.toBe(true);
  });

  it('这个客户在我名下 → 放行', async () => {
    (prisma.customer.findUnique as any).mockResolvedValue({ companionId: 'comp-me' });
    await expect((service as any).canActOnOrder(baseOrder, 'comp-me')).resolves.toBe(true);
  });

  it('我以前服务过这个客户（DONE 单）→ 放行', async () => {
    (prisma.order.count as any).mockResolvedValue(1);
    await expect((service as any).canActOnOrder(baseOrder, 'comp-me')).resolves.toBe(true);
  });

  it('跟我毫无关系 → 拒', async () => {
    await expect((service as any).canActOnOrder(baseOrder, 'comp-me')).resolves.toBe(false);
  });
});
