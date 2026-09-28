// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  wechatTookCustomerMessage,
  assertCustomerNotTakenByCurrentWechat,
} from '../orders/customer-wechat-rule';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-29 改口径：「每个陪玩绑定一个微信，说白了就是同一个微信不能抢同一个客户……
 * 他如果还是用这个微信去抢单就要提示，如果陪玩更换了新的工作微信，那么可以继续抢。」
 *
 * 判重口径 = 客户 + 工作微信（订单接下时把当时绑的微信写在 customFields.workWechatName）。
 */
describe('同一个微信不能抢同一个客户', () => {
  beforeEach(() => vi.clearAllMocks());

  it('这个微信号接过这个客户 → 拦下来，提示里带上微信号', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-old' });
    prisma.order.findMany.mockResolvedValue([{ customFields: { workWechatName: 'wx-old' } }]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(wechatTookCustomerMessage('wx-old'));

    // 查的是「这个客户的历史订单」，不按陪玩过滤：换了人但用同一个微信一样算
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-1' } }),
    );
  });

  it('陪玩换了新的工作微信 → 放行（新微信没接过这个客户）', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-new' });
    prisma.order.findMany.mockResolvedValue([{ customFields: { workWechatName: 'wx-old' } }]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('别人用别的微信接过这个客户 → 跟他没关系，放行', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-b' });
    prisma.order.findMany.mockResolvedValue([
      { customFields: { workWechatName: 'wx-a' } },
      { customFields: { workWechatName: 'wx-c' } },
    ]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-2', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('历史单上没写工作微信（老数据 / 客服发的单）→ 放行', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-old' });
    prisma.order.findMany.mockResolvedValue([
      { customFields: null },
      { customFields: { csWorkWechatName: 'wx-old' } },
      { customFields: { workWechatName: '  ' } },
    ]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('没绑工作微信 / 没陪玩 / 没客户 → 不查库、直接放行', async () => {
    const prisma = createMockPrisma();

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, null, 'customer-1'),
    ).resolves.toBeUndefined();
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', null),
    ).resolves.toBeUndefined();
    expect(prisma.workWechat.findUnique).not.toHaveBeenCalled();

    // 有陪玩但还没绑微信：判不了，放行，且不去翻订单
    prisma.workWechat.findUnique.mockResolvedValue(null);
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).resolves.toBeUndefined();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
