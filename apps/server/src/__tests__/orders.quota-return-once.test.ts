// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-08 全链路复查：「一张单只能返还一次名额」。
 *
 * 抢单那一刻扣掉 1 个名额（老板 2026-10-04 的口径），失败由管理端补单返还。
 * 但「补单」和「退单」是两套入口、写的是同一张 SupplementRequest 表里的两种 type ——
 * 复查时发现同一张单可以**两条都同意**，于是名额被返还两次（扣 1 还 2，凭空多出一个）。
 * 这条口径一旦错，陪玩第二天就能多抢一单，客服跟他扯不清楚，所以钉死：
 *   * 先「报不成功 → 补单同意」再「退单同意」→ 退单照退，但名额不再 +1；
 *   * 先「退单同意」再让管理端直接补单 → 直接拒（不许重复返还）；
 *   * 正常（没返还过）还是一次全额返还 —— 别把正常路堵了。
 */
function setup() {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToStudio: vi.fn(),
    broadcastToBridgedStudios: vi.fn(),
    pushOrder: vi.fn(),
    notifyUser: vi.fn(),
    refreshCompanionBlacklist: vi.fn().mockResolvedValue(undefined),
  };
  const bridgeService = {
    getBridgedStudioIds: vi.fn().mockResolvedValue([]),
    getVisibleStudioIds: vi.fn().mockResolvedValue(['s1']),
  };
  const quota = {
    status: vi.fn().mockResolvedValue({ balance: 0, remaining: 0 }),
    ensure: vi.fn(),
    consume: vi.fn(),
    reserve: vi.fn(),
    refund: vi.fn(),
    credit: vi.fn().mockResolvedValue(4),
  };
  const service = new OrdersService(
    prisma as any,
    ws as any,
    bridgeService as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn(), computeOne: vi.fn() } as any,
    quota as any,
  );
  return { service, prisma, ws, quota };
}

const ADMIN = { id: 'admin-1', role: 'ADMIN', studioId: 's1' };
const REFUND_ROW = {
  id: 'sr-refund',
  type: 'REFUND',
  status: 'PENDING',
  orderId: 'o1',
  companionId: 'c1',
  studioId: 's1',
  reason: '客户没转钱，最后不打了',
};
const SUPP_ROW = {
  id: 'sr-supp',
  type: 'SUPPLEMENT',
  status: 'PENDING',
  orderId: 'o1',
  companionId: 'c1',
  studioId: 's1',
  reason: 'not_added',
};
const ORDER_ROW = { id: 'o1', companionId: 'c1', studioId: 's1', status: 'GRABBED', notes: null, customFields: {} };

describe('一张单只返还一次名额', () => {
  beforeEach(() => vi.clearAllMocks());

  it('先「补单同意」拿到名额，再「退单同意」→ 退单照退，但不再重复返还名额', async () => {
    const { service, prisma, quota, ws } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue(REFUND_ROW);
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr-refund' });
    // 同单下已经有一条「已同意」的补单记录（名额已经返过一次了）
    prisma.supplementRequest.findFirst.mockResolvedValue({ id: 'sr-supp-old', status: 'APPROVED' });
    prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
    prisma.order.update.mockResolvedValue({ id: 'o1' });
    prisma.companion.findUnique.mockResolvedValue({ userId: 'u-c1' });

    await service.decideSupplement('sr-refund', 'APPROVE', '同意', ADMIN);

    // 这张单还是按退款处理掉了（不计利润与提成、不参与 KPI 计算）
    expect(prisma.order.update.mock.calls[0][0].data.status).toBe('CANCELLED');
    // 但名额一个没多给
    expect(quota.credit).not.toHaveBeenCalled();
    const payload = ws.notifyUser.mock.calls.find((c: any) => c[1] === 'order:supplement')?.[2];
    expect(payload.message).toContain('已同意退单');
    expect(payload.message).not.toContain('+1');
  });

  it('先「退单同意」拿到名额，再让管理端直接补单 → 直接拒（不许重复返还）', async () => {
    const { service, prisma, quota } = setup();
    prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
    prisma.supplementRequest.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.type === 'SUPPLEMENT') return null; // 这张单没有补单记录
      if (args?.where?.status === 'APPROVED') return { id: 'sr-refund' }; // 有一条已同意的退单
      return null;
    });

    await expect(service.supplementOrder('o1', ADMIN, { reason: '手动补偿' })).rejects.toThrow(
      /已经因为补单 \/ 退单返还过名额/
    );
    expect(quota.credit).not.toHaveBeenCalled();
  });

  it('没返还过 → 还是一次全额返还（正常路不能被堵）', async () => {
    const { service, prisma, quota } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue(REFUND_ROW);
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr-refund' });
    prisma.supplementRequest.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
    prisma.order.update.mockResolvedValue({ id: 'o1' });
    prisma.companion.findUnique.mockResolvedValue({ userId: 'u-c1' });

    await service.decideSupplement('sr-refund', 'APPROVE', '同意', ADMIN);

    expect(quota.credit).toHaveBeenCalledWith('c1', 1, 'SUPPLEMENT', expect.objectContaining({ refId: 'o1' }));
  });

  it('补单同意这条路也守同一条规矩（已有已同意的退单 → 不再返还）', async () => {
    const { service, prisma, quota } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue(SUPP_ROW);
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr-supp' });
    prisma.supplementRequest.findFirst.mockResolvedValue({ id: 'sr-refund', status: 'APPROVED' });
    prisma.order.findUnique.mockResolvedValue(ORDER_ROW);
    prisma.order.update.mockResolvedValue({ id: 'o1' });
    prisma.companion.findUnique.mockResolvedValue({ userId: 'u-c1' });

    await service.decideSupplement('sr-supp', 'APPROVE', '同意', ADMIN);

    expect(quota.credit).not.toHaveBeenCalled();
  });
});
