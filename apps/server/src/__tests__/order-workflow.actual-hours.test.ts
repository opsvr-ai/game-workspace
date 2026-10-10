// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi } from 'vitest';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-11：「童祥瑞点复购开始订单好几个小时了，一会儿输入单价 50，也点结束服务了，
 * 怎么只统计进了 50？」
 *
 * 根因：业绩一直按**下单那一刻预填的** `Order.amount`（时长 × 单价，时长默认 1）算，
 * 真正打了多久只写进了 `Order.auditAmountCents`，从没进过业绩。
 * 现在改成「逐段真实时长 × 该段单价」，并把订单金额一起回写。
 */
function setup() {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToBridgedStudios: vi.fn(),
    refreshCompanionBlacklist: vi.fn().mockResolvedValue(undefined),
    pushOrder: vi.fn(),
  };
  const bridge = {
    getBridgedStudioIds: vi.fn().mockResolvedValue([]),
    getVisibleStudioIds: vi.fn().mockResolvedValue(['s1']),
  };
  const service = new OrderWorkflowService(prisma as any, ws as any, bridge as any, {} as any);
  // 订单基础料：复购单，下单时填的是「1 小时 50 元」
  prisma.order.findUnique.mockResolvedValue({
    id: 'o1',
    status: 'CONFIRMED',
    studioId: 's1',
    companionId: 'tong',
    coCompanionId: null,
    customerId: 'c1',
    amount: 50,
    orderCode: '903',
    customFields: {},
  });
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  prisma.order.update.mockResolvedValue({});
  prisma.customer.updateMany.mockResolvedValue({ count: 1 });
  prisma.companion.update.mockResolvedValue({});
  return { service, prisma };
}

const at = (h: number, m = 0) => new Date(`2026-10-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);

describe('完成订单时业绩按「实际时长 × 单价」算', () => {
  it('下单写了 1 小时 50 元、实际打了 1.5 小时 → 业绩 +75，订单金额也回写成 75', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findMany.mockResolvedValue([
      {
        companionId: 'tong',
        coCompanionId: null,
        startedAt: at(20, 0),
        endedAt: at(21, 30),
        totalPausedSec: 0,
        amount: 50,
        coAmount: null,
        duration: 1,
        claimedPrice: 50,
      },
    ]);

    await service.complete('o1');

    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tong' },
        data: { monthlyRevenue: { increment: 75 } },
      }),
    );
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ amount: 75 }) }),
    );
  });

  it('多段（续单）按每段各自的真实时长求和：1h + 0.5h，单价 50 → +75', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findMany.mockResolvedValue([
      {
        companionId: 'tong', coCompanionId: null,
        startedAt: at(10, 0), endedAt: at(11, 0), totalPausedSec: 0,
        amount: 50, coAmount: null, duration: 1, claimedPrice: 50,
      },
      {
        companionId: 'tong', coCompanionId: null,
        startedAt: at(11, 0), endedAt: at(11, 30), totalPausedSec: 0,
        amount: 50, coAmount: null, duration: 1, claimedPrice: 50,
      },
    ]);

    await service.complete('o1');

    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyRevenue: { increment: 75 } } }),
    );
  });

  it('暂停的时长不算钱：2 小时里暂停了 30 分钟 → 只算 1.5 小时', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findMany.mockResolvedValue([
      {
        companionId: 'tong', coCompanionId: null,
        startedAt: at(20, 0), endedAt: at(22, 0), totalPausedSec: 1800,
        amount: 50, coAmount: null, duration: 1, claimedPrice: 50,
      },
    ]);

    await service.complete('o1');

    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyRevenue: { increment: 75 } } }),
    );
  });

  it('一段会话都没有（客服直接改状态完成）→ 退回老口径，不动订单金额', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findMany.mockResolvedValue([]);

    await service.complete('o1');

    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyRevenue: { increment: 50 } } }),
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('还没结束的段不算（endedAt 为空）', async () => {
    const { service, prisma } = setup();
    prisma.orderSession.findMany.mockResolvedValue([
      {
        companionId: 'tong', coCompanionId: null,
        startedAt: at(20, 0), endedAt: null, totalPausedSec: 0,
        amount: 50, coAmount: null, duration: 1, claimedPrice: 50,
      },
    ]);

    await service.complete('o1');

    // 算不出来 → 退回老口径 50
    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyRevenue: { increment: 50 } } }),
    );
  });

  it('搭档按「coAmount ÷ 计划时长」折成小时价：45 元/小时，实际打了 2 小时 → +90', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1', status: 'CONFIRMED', studioId: 's1',
      companionId: 'tong', coCompanionId: 'hu', customerId: 'c1',
      amount: 100, orderCode: '878', customFields: {},
    });
    prisma.orderSession.findMany.mockResolvedValue([
      {
        companionId: 'tong', coCompanionId: 'hu',
        startedAt: at(20, 0), endedAt: at(22, 0), totalPausedSec: 0,
        amount: 100, coAmount: 45, duration: 1, claimedPrice: 100,
      },
    ]);

    await service.complete('o1');

    expect(prisma.companion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'hu' }, data: { monthlyRevenue: { increment: 90 } } }),
    );
  });
});
