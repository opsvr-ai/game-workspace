// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-03：「想转让的订单，需要被转让方同意才能过来，要不然乱套了」。
 *
 * 以前 `POST /orders/:id/transfer` 点一下就换手（直接改 companionId + 写留痕），
 * 当事人（被转让方）根本不知道，单可能被塞给一个正在打游戏的人。
 * 现在改成「申请 → 被转让方同意 → 才真正换手」：
 *   - 申请只落 OrderTransferRequest(PENDING) + 推 WS，**订单一个字段都不动、不写留痕**；
 *   - 同意后才跑老的换手逻辑（写 OrderTransfer + 换 companionId/grabbedAt + 转客户归属）；
 *   - 拒绝 / 撤回 / 30 分钟超时作废，订单原样不动；
 *   - 同意是原子的：重复点、申请处理完、单已经不在发起人名下 —— 一律拒绝，不许换第二次。
 */
const ORDER = {
  id: 'order-400',
  orderCode: 400,
  gameName: '三角洲行动',
  amount: 50,
  status: 'GRABBED',
  companionId: 'from-1',
  coCompanionId: null,
  customerId: 'cus-1',
  studioId: 'studio-1',
  companion: {
    id: 'from-1',
    studioId: 'studio-1',
    userId: 'user-from',
    user: { username: 'wangjiazhen', displayName: '王甲振' },
  },
};

function setup() {
  const prisma: any = createMockPrisma();
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
  prisma.order.findUnique.mockResolvedValue({ ...ORDER });
  prisma.orderSession.count.mockResolvedValue(0);
  prisma.companion.findUnique.mockResolvedValue({
    id: 'to-1',
    studioId: 'studio-1',
    userId: 'user-to',
    isResigned: false,
    user: { username: 'xuzening', displayName: '徐泽宁' },
  });
  prisma.orderTransferRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'req-1', ...data }));
  prisma.orderTransferRequest.updateMany.mockResolvedValue({ count: 1 });
  prisma.orderTransferRequest.update.mockResolvedValue({ id: 'req-1' });
  prisma.orderTransfer.create.mockResolvedValue({ id: 'transfer-1' });
  prisma.order.update.mockImplementation(async ({ where, data }: any) => ({ ...ORDER, ...data, id: where.id }));
  prisma.customer.updateMany.mockResolvedValue({ count: 1 });
  return { service, prisma, gateway };
}

describe('转让订单要经被转让方同意（老板 2026-10-03）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('发起转让只落一条 PENDING 申请并推给对方，订单不动、不写留痕', async () => {
    const { service, prisma, gateway } = setup();
    prisma.orderTransferRequest.findMany.mockResolvedValue([]);

    const res = await service.requestTransfer('order-400', 'from-1', 'to-1', '客户一直没通过');

    expect(res.status).toBe('PENDING');
    expect(res.toName).toBe('徐泽宁');
    expect(prisma.orderTransferRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-400',
        fromCompanionId: 'from-1',
        toCompanionId: 'to-1',
        status: 'PENDING',
      }),
    });
    // 关键：申请阶段绝不换手
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.orderTransfer.create).not.toHaveBeenCalled();
    expect(gateway.pushToCompanion).toHaveBeenCalledWith(
      'to-1',
      'order:transfer_requested',
      expect.objectContaining({ requestId: 'req-1', fromName: '王甲振', orderCode: 400 }),
    );
  });

  it('对方同意 → 才真正换手：写留痕 + 换 companionId + 申请置 ACCEPTED', async () => {
    const { service, prisma, gateway } = setup();
    prisma.orderTransferRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      orderId: 'order-400',
      fromCompanionId: 'from-1',
      toCompanionId: 'to-1',
      reason: '客户一直没通过',
      status: 'PENDING',
    });

    const updated = await service.acceptTransferRequest('req-1', 'to-1');

    expect(prisma.orderTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-400',
        fromCompanionId: 'from-1',
        toCompanionId: 'to-1',
        fromUserId: 'user-from',
        toUserId: 'user-to',
      }),
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-400' },
      data: expect.objectContaining({ companionId: 'to-1', contactStatus: null, screenshotUrl: null }),
    });
    expect(prisma.orderTransferRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    });
    expect(updated.companionId).toBe('to-1');
    expect(gateway.pushToCompanion).toHaveBeenCalledWith(
      'from-1',
      'order:transfer_accepted',
      expect.objectContaining({ toName: '徐泽宁' }),
    );
  });

  it('对方拒绝 → 申请置 REJECTED，订单不动，只通知发起人', async () => {
    const { service, prisma, gateway } = setup();
    prisma.orderTransferRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      orderId: 'order-400',
      fromCompanionId: 'from-1',
      toCompanionId: 'to-1',
      status: 'PENDING',
    });
    prisma.companion.findUnique.mockResolvedValue({ user: { username: 'xuzening', displayName: '徐泽宁' } });

    await service.rejectTransferRequest('req-1', 'to-1', '手上还有单');

    expect(prisma.orderTransferRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'REJECTED' }),
    });
    expect(prisma.orderTransfer.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(gateway.pushToCompanion).toHaveBeenCalledWith(
      'from-1',
      'order:transfer_rejected',
      expect.objectContaining({ byName: '徐泽宁' }),
    );
  });

  it('同意时单已经不在发起人名下 → 拒绝换手（作废）', async () => {
    const { service, prisma } = setup();
    prisma.orderTransferRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      orderId: 'order-400',
      fromCompanionId: 'from-1',
      toCompanionId: 'to-1',
      status: 'PENDING',
    });
    prisma.order.findUnique.mockResolvedValue({ ...ORDER, companionId: 'someone-else' });

    await expect(service.acceptTransferRequest('req-1', 'to-1')).rejects.toThrow();
    expect(prisma.orderTransfer.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('重复同意 / 申请已处理过 → 拒绝，绝不换第二次手', async () => {
    const { service, prisma } = setup();
    prisma.orderTransferRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      orderId: 'order-400',
      fromCompanionId: 'from-1',
      toCompanionId: 'to-1',
      status: 'PENDING',
    });
    prisma.orderTransferRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.acceptTransferRequest('req-1', 'to-1')).rejects.toThrow();
    expect(prisma.orderTransfer.create).not.toHaveBeenCalled();
  });
});
