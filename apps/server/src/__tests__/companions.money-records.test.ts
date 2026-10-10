import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionsService } from '../companions/companions.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「他一条条业绩记录」——老板 2026-10-11：
 * 「我要改的是某个陪玩的流水，因为流水会以后差错 我要去修改」→ 确认「数字和一条条记录都要能改」。
 * 这里钉住两件事：
 *   ① 改单子上的业绩时，**必须**把库里存的那个累计业绩按差额一起改（否则列表和记录永远对不上）；
 *   ② 作废 = 不计业绩、还扣回累计业绩，而且能原样恢复。
 */
function build() {
  const prisma = createMockPrisma();
  const service = new CompanionsService(
    prisma as any,
    { getRanking: vi.fn(), getWallet: vi.fn(), checkEntertainmentBlocked: vi.fn() } as any,
    { ensureAttendance: vi.fn(), finalizeAttendance: vi.fn(), getAttendance: vi.fn() } as any,
    { listWorkWechats: vi.fn(), addWorkWechat: vi.fn(), bindWechat: vi.fn(), unbindWechat: vi.fn() } as any,
    { computeForCompanions: vi.fn(), computeOne: vi.fn(), get: vi.fn() } as any,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as any,
    { resignEmployee: vi.fn() } as any,
  );
  return { prisma, service };
}

const mainOrder = (over: any = {}) => ({
  id: 'order-1',
  companionId: 'comp-1',
  coCompanionId: null,
  amount: 50,
  coAmount: null,
  customFields: null,
  ...over,
});

describe('陪玩业绩记录（MoneyRecords）', () => {
  let prisma: MockPrisma;
  let service: CompanionsService;

  beforeEach(() => {
    const b = build();
    prisma = b.prisma;
    service = b.service;
    prisma.companion.findUnique.mockResolvedValue({ id: 'comp-1', monthlyRevenue: 380 });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.walletTransaction.findMany.mockResolvedValue([]);
    prisma.walletTransaction.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.customer.findMany.mockResolvedValue([]);
  });

  it('列记录时，把「按单加起来」和「库里存的业绩」一起给出来对账', async () => {
    prisma.order.findMany.mockResolvedValue([mainOrder({ id: 'o1', amount: 50 })] as any);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', customerCode: 'K001', wechatId: 'wx001' },
    ] as any);
    prisma.order.findMany.mockResolvedValue([
      mainOrder({ id: 'o1', amount: 50, customerId: 'cust-1' }),
    ] as any);

    const data = await service.listMoneyRecords('comp-1');

    expect(data.storedRevenue).toBe(380);
    expect(data.revenueFromOrders).toBe(50);
    expect(data.orders[0]).toMatchObject({
      id: 'o1',
      role: 'MAIN',
      myRevenue: 50,
      customerCode: 'K001',
      voided: false,
    });
  });

  it('主陪改这一单的业绩：写回订单金额，同时把累计业绩按差额同步', async () => {
    prisma.order.findUnique.mockResolvedValue(mainOrder({ amount: 50 }) as any);

    const res = await service.updateOrderRevenueRecord(
      'comp-1',
      'order-1',
      { amount: 80, note: '这单记少了' },
      'hanlei',
    );

    expect(res.revenueDelta).toBe(30);
    const orderUpdate = prisma.order.update.mock.calls[0][0] as any;
    expect(orderUpdate.data.amount).toBe(80);
    const compUpdate = prisma.companion.update.mock.calls[0][0] as any;
    expect(compUpdate.where).toEqual({ id: 'comp-1' });
    expect(compUpdate.data.monthlyRevenue).toEqual({ increment: 30 });
  });

  it('主陪带跨工作室分成时，订单金额要写成「他的业绩 + 分出去的份」', async () => {
    prisma.order.findUnique.mockResolvedValue(
      mainOrder({
        amount: 105,
        customFields: { splits: [{ companionId: 'other', amount: 40 }] },
      }) as any,
    );

    // 他现在这份业绩 = 105 - 40 = 65；改成 100 → 订单金额要写 140
    const res = await service.updateOrderRevenueRecord('comp-1', 'order-1', { amount: 100 }, 'hanlei');

    expect(res.revenueDelta).toBe(35);
    const orderUpdate = prisma.order.update.mock.calls[0][0] as any;
    expect(orderUpdate.data.amount).toBe(140);
  });

  it('搭档改的是 coAmount（不动主陪那份）', async () => {
    prisma.order.findUnique.mockResolvedValue(
      mainOrder({ companionId: 'other', coCompanionId: 'comp-1', amount: 100, coAmount: 35 }) as any,
    );

    const res = await service.updateOrderRevenueRecord('comp-1', 'order-1', { amount: 60 }, 'hanlei');

    expect(res.revenueDelta).toBe(25);
    const orderUpdate = prisma.order.update.mock.calls[0][0] as any;
    expect(orderUpdate.data.coAmount).toBe(60);
    expect(orderUpdate.data.amount).toBeUndefined();
  });

  it('作废 = 不计业绩（还扣回累计业绩），并且能原样恢复', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(mainOrder({ amount: 50 }) as any);
    const voided = await service.updateOrderRevenueRecord(
      'comp-1',
      'order-1',
      { voided: true, note: '这单不算' },
      'hanlei',
    );
    expect(voided.myRevenue).toBe(0);
    expect(voided.revenueDelta).toBe(-50);
    const voidUpdate = prisma.order.update.mock.calls[0][0] as any;
    expect(voidUpdate.data.amount).toBe(0);
    expect(voidUpdate.data.customFields.revenueVoid.prevAmount).toBe(50);

    // 恢复：拿回作废前的金额，累计业绩也加回来
    prisma.order.findUnique.mockResolvedValueOnce(
      mainOrder({
        amount: 0,
        customFields: { revenueVoid: { at: 'x', byName: 'hanlei', prevAmount: 50 } },
      }) as any,
    );
    const restored = await service.updateOrderRevenueRecord('comp-1', 'order-1', { voided: false }, 'hanlei');
    expect(restored.myRevenue).toBe(50);
    expect(restored.revenueDelta).toBe(50);
    const restoreUpdate = prisma.order.update.mock.calls[1][0] as any;
    expect(restoreUpdate.data.amount).toBe(50);
    expect(restoreUpdate.data.customFields.revenueVoid).toBeUndefined();
  });

  it('不是他的单 → 直接拦（不能拿别人的单改业绩）', async () => {
    prisma.order.findUnique.mockResolvedValue(
      mainOrder({ companionId: 'someone-else', coCompanionId: null }) as any,
    );
    await expect(
      service.updateOrderRevenueRecord('comp-1', 'order-1', { amount: 999 }, 'hanlei'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('业绩金额填负数 → 拦下来', async () => {
    prisma.order.findUnique.mockResolvedValue(mainOrder() as any);
    await expect(
      service.updateOrderRevenueRecord('comp-1', 'order-1', { amount: -5 }, 'hanlei'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('改钱包记录：金额改了，备注里留一句「原来多少 → 改成多少、谁改的」', async () => {
    prisma.walletTransaction.findFirst.mockResolvedValue({
      id: 'w1',
      companionId: 'comp-1',
      type: 'WITHDRAW',
      amount: 100,
      note: '10 月支取',
    } as any);
    prisma.walletTransaction.update.mockResolvedValue({ id: 'w1' } as any);

    await service.updateWalletRecord('comp-1', 'w1', { amount: 60, note: '记错了' }, 'hanlei');

    const arg = prisma.walletTransaction.update.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'w1' });
    expect(arg.data.amount).toBe(60);
    expect(arg.data.note).toContain('记错了');
    expect(arg.data.note).toContain('¥100 → ¥60');
    expect(arg.data.note).toContain('hanlei');
  });

  it('删钱包记录：删掉；不是他的那条 → 不动手', async () => {
    prisma.walletTransaction.findFirst.mockResolvedValue(null);
    await expect(service.deleteWalletRecord('comp-1', 'w404', 'hanlei')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.walletTransaction.delete).not.toHaveBeenCalled();

    prisma.walletTransaction.findFirst.mockResolvedValue({ id: 'w1', type: 'DEPOSIT', amount: 200 } as any);
    await service.deleteWalletRecord('comp-1', 'w1', 'hanlei');
    expect(prisma.walletTransaction.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });
});