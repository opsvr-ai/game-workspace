// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-03：「放在订单列表那一行点转让或者点接受不行么」。
 *
 * 别人想转给我的单**现在还不挂在我名下**，以前压根不在我的订单列表里，
 * 只能靠顶栏铃铛 / 弹窗提醒。现在 findAll 会把「待我确认」的单也捞进「我接的单」，
 * 并逐行挂上 pendingTransferForMe（前端那一行据此长出「接手 / 拒绝」）。
 * 这个文件只盯这一件事：哪些行该挂、哪些行不该挂。
 */
const ME = { id: 'user-to', role: 'COMPANION', companionId: 'to-1', studioId: 'studio-1' };

function orderRow(over: Record<string, any> = {}) {
  return {
    id: 'order-400',
    orderCode: 400,
    gameName: '三角洲行动',
    amount: 50,
    status: 'GRABBED',
    dispatchType: 'POOL',
    companionId: 'from-1',
    coCompanionId: null,
    customerId: 'cus-1',
    studioId: 'studio-1',
    customer: null,
    transfers: [],
    sessions: [],
    ...over,
  };
}

function setup(orders: any[], requests: any[]) {
  const prisma: any = createMockPrisma();
  const gateway = { pushToCompanion: vi.fn(), pushOrder: vi.fn(), notifyCompanion: vi.fn() };
  const service = new OrdersService(
    prisma as any,
    gateway as any,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn(), computeOne: vi.fn().mockResolvedValue({ tier: 'TOP', score: 0 }) } as any,
    { status: vi.fn(), ensure: vi.fn(), consume: vi.fn(), refund: vi.fn() } as any,
  );
  prisma.orderTransferRequest.findMany.mockResolvedValue(requests);
  prisma.order.findMany.mockResolvedValue(orders);
  prisma.companion.findMany.mockResolvedValue([
    { id: 'from-1', user: { username: 'wangjiazhen', displayName: '王甲振' } },
  ]);
  return { prisma, service };
}

const PENDING = {
  id: 'req-1',
  orderId: 'order-400',
  fromCompanionId: 'from-1',
  reason: '客户一直没通过',
  createdAt: new Date(),
};

describe('订单列表：别人转给我的单要出现在「我接的单」里', () => {
  it('有效的申请：这一行挂上 pendingTransferForMe（带 requestId / 谁转的 / 什么时候作废）', async () => {
    const { prisma, service } = setup([orderRow()], [PENDING]);
    const rows: any[] = await service.findAll(ME as any);
    expect(rows).toHaveLength(1);
    const p = rows[0].pendingTransferForMe;
    expect(p).toBeTruthy();
    expect(p.requestId).toBe('req-1');
    expect(p.fromCompanionId).toBe('from-1');
    expect(p.fromName).toBe('王甲振');
    expect(p.reason).toBe('客户一直没通过');
    // 30 分钟有效期：到这里应该还剩不到半小时、但还没作废
    expect(p.expiresAt).toBeGreaterThan(Date.now());
    expect(p.expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
    // 这张单不在我名下，但必须被查出来（不然列表里根本没有这一行）
    const or = prisma.order.findMany.mock.calls[0][0].where.OR;
    expect(JSON.stringify(or)).toContain('order-400');
  });

  it('单子已经不在对方名下了（换过手 / 被收回）→ 不挂申请，别让陪玩点出一个报错的按钮', async () => {
    const { service } = setup([orderRow({ companionId: 'someone-else' })], [PENDING]);
    const rows: any[] = await service.findAll(ME as any);
    expect(rows[0].pendingTransferForMe).toBeNull();
  });

  it('单子已经不是「已抢单 / 已确认」了 → 不挂申请', async () => {
    const { service } = setup([orderRow({ status: 'COMPLETED' })], [PENDING]);
    const rows: any[] = await service.findAll(ME as any);
    expect(rows[0].pendingTransferForMe).toBeNull();
  });

  it('申请已经超过 30 分钟 → 不挂申请（后端等清理任务作废，前端先别显示）', async () => {
    const stale = { ...PENDING, createdAt: new Date(Date.now() - 31 * 60 * 1000) };
    const { prisma, service } = setup([orderRow()], [stale]);
    const rows: any[] = await service.findAll(ME as any);
    expect(rows[0].pendingTransferForMe).toBeNull();
    // 过期的那条压根不该把单子拉进列表：查询里就必须把「超过 30 分钟」挡掉
    const where = prisma.orderTransferRequest.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toBeTruthy();
  });

  it('没有申请的单照常返回，pendingTransferForMe 是 null（不影响原有口径）', async () => {
    const { service } = setup([orderRow(), orderRow({ id: 'order-401', orderCode: 401 })], []);
    const rows: any[] = await service.findAll(ME as any);
    expect(rows.every((r: any) => r.pendingTransferForMe === null)).toBe(true);
  });
});
