// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  wechatTookCustomerMessage,
  noWorkWechatMessage,
  assertCustomerNotTakenByCurrentWechat,
} from '../orders/customer-wechat-rule';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-29 定口径：「每个陪玩绑定一个微信，说白了就是同一个微信不能抢同一个客户……
 *   他如果还是用这个微信去抢单就要提示，如果陪玩更换了新的工作微信，那么可以继续抢。」
 * 老板 2026-10-02 补：「同一个客户咨询了我好几个小红书矩阵并留下微信号，发布订单的时候完全可以发 3 单，
 *   只要被不同的陪玩（工作微信不同）接走。」—— 所以「同一个客户」按**微信号**算，不按客户档案编号。
 * 老板 2026-10-02 定方案 B：「保持只按微信 —— 那就得去「工作微信 → 陪玩工作微信」把每个人的号绑上，
 *   绑一个生效一个」+「抢单时如果不绑定工作微信，提示抢不了，提示去绑定工作微信」
 *   —— 所以**没绑工作微信就直接拦**，不再按人兜底。
 */
describe('同一个微信不能抢同一个客户', () => {
  beforeEach(() => vi.clearAllMocks());

  const mockCustomer = (
    prisma: ReturnType<typeof createMockPrisma>,
    wechatId: string,
    sameCustomers: Array<{ id: string }> = [],
  ) => {
    (prisma.customer.findUnique as any).mockResolvedValue({ wechatId });
    (prisma.customer.findMany as any).mockResolvedValue(sameCustomers);
  };

  it('没绑工作微信 → 抢不了，提示去「工作微信 → 陪玩工作微信」绑定', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue(null);
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(noWorkWechatMessage());
    // 没微信就没得判，不查历史单
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('工作微信绑的是空串 → 一样拦下来', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: '   ' });
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(noWorkWechatMessage());
  });

  it('这个微信号接过这个客户 → 拦下来，提示里带上微信号', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-old' });
    prisma.order.findMany.mockResolvedValue([{ companionId: 'c9', customFields: { workWechatName: 'wx-old' } }]);
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).rejects.toThrow(wechatTookCustomerMessage('wx-old'));

    // 判重不按陪玩过滤：换了人但用同一个微信一样算
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companionId: { not: null } }) }),
    );
  });

  it('同一个微信号挂着好几条客户档案（客服发了 3 张单）→ 也按同一个客户判', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-b' });
    // 这个微信号上已经有一张单被 wx-b 接走了（那张单挂在另一条客户档案 customer-9 下）
    prisma.order.findMany.mockResolvedValue([{ companionId: 'companion-9', customFields: { workWechatName: 'wx-b' } }]);
    mockCustomer(prisma, '18700682660', [{ id: 'customer-1' }, { id: 'customer-9' }]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-2', 'customer-1'),
    ).rejects.toThrow(wechatTookCustomerMessage('wx-b'));

    // 查历史单时把这个微信号名下的档案都带上（不能只看当前这张单的档案编号）
    const where = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(JSON.stringify(where.OR[0])).toContain('customer-9');
  });

  it('陪玩换了新的工作微信 → 放行（新微信没接过这个客户）', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-new' });
    prisma.order.findMany.mockResolvedValue([{ companionId: 'companion-1', customFields: { workWechatName: 'wx-old' } }]);
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('别人用别的微信接过这个客户 → 跟他没关系，放行', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-b' });
    prisma.order.findMany.mockResolvedValue([
      { companionId: 'c1', customFields: { workWechatName: 'wx-a' } },
      { companionId: 'c2', customFields: { workWechatName: 'wx-c' } },
    ]);
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-2', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('老单上没写工作微信（那会儿还没绑）→ 不参与判重，放行', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-mine' });
    prisma.order.findMany.mockResolvedValue([
      { companionId: 'companion-1', customFields: null },
      { companionId: 'companion-1', customFields: { csWorkWechatName: '客服的微信' } },
    ]);
    mockCustomer(prisma, 'wx-customer');

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1'),
    ).resolves.toBeUndefined();
  });

  it('客户档案上没写微信号时，退回用订单上客服填的客户微信比', async () => {
    const prisma = createMockPrisma();
    prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-mine' });
    prisma.order.findMany.mockResolvedValue([{ companionId: 'companion-1', customFields: { workWechatName: 'wx-mine' } }]);
    mockCustomer(prisma, '', [{ id: 'customer-9' }]);

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', 'customer-1', '18700682660'),
    ).rejects.toThrow(wechatTookCustomerMessage('wx-mine'));
  });

  it('没陪玩 / 没客户 → 不查库、直接放行', async () => {
    const prisma = createMockPrisma();

    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, null, 'customer-1'),
    ).resolves.toBeUndefined();
    await expect(
      assertCustomerNotTakenByCurrentWechat(prisma as any, 'companion-1', null),
    ).resolves.toBeUndefined();
    expect(prisma.workWechat.findUnique).not.toHaveBeenCalled();
  });
});
