// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  COMPANION_TOOK_CUSTOMER_MESSAGE,
  assertCustomerNotTakenByCompanion,
} from '../orders/customer-companion-rule';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-29：「允许同一个客户被不同的陪玩去抢单，但是不允许同一个客户同一个陪玩去抢。」
 *
 * 以前按「工作微信」判重（谁绑了同一个微信都一样、换了微信就能再接），
 * 会误拦换了微信 / 换了人的情况。现在按「陪玩」判重。
 */
describe('同一个客户同一个陪玩只能接一次', () => {
  beforeEach(() => vi.clearAllMocks());

  it('这个陪玩已经接过这个客户（手上还有单）→ 拦下来', async () => {
    const prisma = createMockPrisma();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', orderCode: 101 });

    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(COMPANION_TOOK_CUSTOMER_MESSAGE);

    // 查的是「这个客户 + 这个陪玩（含搭档）」，跟工作微信没关系
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'customer-1', OR: [{ companionId: 'companion-1' }, { coCompanionId: 'companion-1' }] },
      }),
    );
    expect((prisma.order.findFirst.mock.calls[0][0] as any).where).not.toHaveProperty('contactStatus');
  });

  it('同一个客户、换别的陪玩 → 放行（不同陪玩互不影响）', async () => {
    const prisma = createMockPrisma();
    // 按陪玩过滤后查不到：客户被别人接过也不算这个人接过
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-2', 'customer-1'),
    ).resolves.toBeUndefined();
    expect((prisma.order.findFirst.mock.calls[0][0] as any).where.OR).toEqual([
      { companionId: 'companion-2' },
      { coCompanionId: 'companion-2' },
    ]);
  });

  it('他当过搭档的双人局也算接过 → 拦下来', async () => {
    const prisma = createMockPrisma();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-9', orderCode: 109 });

    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-3', 'customer-9'),
    ).rejects.toThrow(COMPANION_TOOK_CUSTOMER_MESSAGE);
  });

  it('客服指定派单 / 陪玩接受指定单：这张单本身就是派给他的，要排除自己', async () => {
    const prisma = createMockPrisma();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-1', 'customer-1', {
        excludeOrderId: 'order-assigned',
      }),
    ).resolves.toBeUndefined();
    expect((prisma.order.findFirst.mock.calls[0][0] as any).where.id).toEqual({ not: 'order-assigned' });
  });

  it('没有陪玩或没有客户（老数据）→ 不查库、直接放行', async () => {
    const prisma = createMockPrisma();

    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, null, 'customer-1'),
    ).resolves.toBeUndefined();
    await expect(
      assertCustomerNotTakenByCompanion(prisma as any, 'companion-1', null),
    ).resolves.toBeUndefined();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});
