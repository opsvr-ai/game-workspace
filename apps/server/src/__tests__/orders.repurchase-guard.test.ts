import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「怎么防止陪玩随便去客户管理找一个客户就点复购了？」（老板 2026-10-04）
 * 只卡**陪玩自己发起**的复购：
 *   ① 客户必须真成交过（有 DONE 单）；
 *   ② 只能复购自己服务过（主陪或副陪）或归属自己的客户。
 * 客服 / 店长 / 老板代发不受限。
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

describe('OrdersService.create 复购兜底校验', () => {
  let prisma: MockPrisma;
  let service: OrdersService;

  const companionDto = {
    type: 'REPURCHASE',
    studioId: 'studio-1',
    csUserId: 'user-comp-1',
    customerId: 'customer-1',
    dispatchType: 'DIRECT',
    companionId: 'comp-1',
    amount: 40,
    duration: 1,
    gameName: '三角洲行动',
    isOnline: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = buildService(prisma);
    prisma.systemConfig.upsert.mockResolvedValue({ key: 'counter.global_code', value: '0' });
    prisma.orderSession.create.mockResolvedValue({ id: 'sess-1', coCompanionId: null });
    (prisma.user.findUnique as any).mockResolvedValue({ role: 'COMPANION', username: 'wanghao' });
    (prisma.companion.findUnique as any).mockResolvedValue({ id: 'comp-1', studioId: 'studio-1' });
  });

  it('客户没有成交记录 → 不能算复购', async () => {
    (prisma.order.count as any).mockResolvedValue(0);
    await expect(service.create(companionDto as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(companionDto as any)).rejects.toThrow(/还没有成交记录/);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('客户成交过，但不是自己服务/归属的 → 不能复购', async () => {
    // 第一次 count = 该客户 DONE 单数（1）；第二次 = 我服务过的 DONE 单数（0）
    (prisma.order.count as any).mockImplementation(async (args: any) =>
      args?.where?.OR ? 0 : 1,
    );
    (prisma.customer.findUnique as any).mockResolvedValue({ companionId: 'someone-else' });

    await expect(service.create(companionDto as any)).rejects.toThrow(/只能复购你自己服务过的客户/);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('自己服务过（当过副陪也算）→ 放行', async () => {
    (prisma.order.count as any).mockResolvedValue(1);
    (prisma.customer.findUnique as any).mockResolvedValue({ companionId: 'comp-1' });
    (prisma.order.create as any).mockResolvedValue({
      id: 'order-1',
      ...companionDto,
      orderCode: '1',
      status: 'GRABBED',
      companionId: 'comp-1',
      coCompanionId: null,
      customFields: {},
      poolScope: null,
    });

    const res = await service.create(companionDto as any);
    expect(res.id).toBe('order-1');
    expect(prisma.order.create).toHaveBeenCalled();
    // 副陪身份也算服务过：OR 条件里必须同时含 companionId / coCompanionId
    const servedCall = (prisma.order.count as any).mock.calls.find((c: any[]) => c[0]?.where?.OR);
    expect(servedCall[0].where.OR).toEqual([{ companionId: 'comp-1' }, { coCompanionId: 'comp-1' }]);
  });

  it('客服 / 店长代发复购不校验（真实老客户前一单还没 DONE 也能发）', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ role: 'CS', username: 'kefu01' });
    (prisma.order.create as any).mockResolvedValue({
      id: 'order-2',
      ...companionDto,
      type: 'REPURCHASE',
      orderCode: '2',
      status: 'GRABBED',
      customFields: {},
      poolScope: null,
    });

    const res = await service.create({ ...companionDto, csUserId: 'user-cs-1' } as any);
    expect(res.id).toBe('order-2');
    // 压根不该去数成交单
    expect(prisma.order.count).not.toHaveBeenCalled();
  });
});