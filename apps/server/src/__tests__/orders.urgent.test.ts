// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-27 报「派单记录 229 怎么没显示被谁抢走，也没出现在流转失败里」。
 *
 * 查清了：客户 229 那张单（单号 230）从头到尾没人抢（那 10 分钟里全站一条抢单请求都没有），
 * 所以确实没有「被谁抢走」可显示；它**是在**流转失败明细里的 —— 只是那个接口按 createdAt asc
 * 返回，最老的排最前面，刚失败的那条被压在最后一行（线上实测排第 29/29 条），看着就像没进去。
 *
 * 这两条用例锁住：① 查询按「新的在前」；② 已消失的仍然排最前（客服要先处理真失败的）。
 */
function setup() {
  const prisma = createMockPrisma();
  const bridgeService = { getBridgedStudioIds: vi.fn().mockResolvedValue([]) };
  const service = new OrdersService(
    prisma as any,
    { broadcastToStudio: vi.fn(), broadcastToBridgedStudios: vi.fn(), pushOrder: vi.fn() } as any,
    bridgeService as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn(), computeOne: vi.fn().mockResolvedValue({ tier: 'TOP', score: 0 }) } as any,
    { status: vi.fn(), ensure: vi.fn(), consume: vi.fn(), refund: vi.fn() } as any,
  );
  // 等太久的单会顺带查「快结束的陪玩」，单测里给个空列表就够
  prisma.companion.findMany.mockResolvedValue([]);
  return { service, prisma };
}

describe('订单池流转失败明细 (/orders/urgent)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按「新的在前」查询，刚失败的单不会被几十行旧单压在最后', async () => {
    const { service, prisma } = setup();
    prisma.order.findMany.mockResolvedValue([]);

    await service.findUrgent('studio-1', { id: 'u-1', role: 'OWNER' });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('已消失（流转失败）的排最前，同一组里新的在前', async () => {
    const { service, prisma } = setup();
    const fresh = {
      id: 'fresh',
      orderCode: '230',
      status: 'PENDING',
      dispatchType: 'POOL',
      studioId: 'studio-1',
      createdAt: new Date(),
      contactStatus: null,
      // 刚失败：新的、已消失
      customFields: { urgency: 'now', poolExpired: true },
      customer: { wechatId: 'w', customerCode: '229', platform: null },
      csUser: { id: 'cs-1', username: '邵泽慧', avatar: null, displayName: null, role: 'CS' },
    };
    const olderExpired = {
      ...fresh,
      id: 'older-expired',
      orderCode: '27',
      createdAt: new Date(Date.now() - 86400000 * 10),
    };
    const stillWaiting = {
      ...fresh,
      id: 'waiting',
      orderCode: '231',
      customer: { wechatId: 'w2', customerCode: '230', platform: null },
      customFields: { urgency: 'now' },
    };
    // 数据库按 createdAt desc 给出来（新 → 旧）
    prisma.order.findMany.mockResolvedValue([stillWaiting, fresh, olderExpired]);

    const result = await service.findUrgent('studio-1', { id: 'u-1', role: 'OWNER' });

    expect(result.map((o: any) => o.id)).toEqual(['fresh', 'older-expired', 'waiting']);
    expect(result[0].orderCode).toBe('230');
  });

  it('客服已经处理过（poolHandled）/ 判定添加失败的单不再出现', async () => {
    const { service, prisma } = setup();
    const base = {
      status: 'PENDING',
      dispatchType: 'POOL',
      studioId: 'studio-1',
      createdAt: new Date(),
      customer: { wechatId: 'w', customerCode: '1', platform: null },
      csUser: { id: 'cs-1', username: '邵泽慧', avatar: null, displayName: null, role: 'CS' },
    };
    prisma.order.findMany.mockResolvedValue([
      { ...base, id: 'handled', contactStatus: null, customFields: { urgency: 'now', poolExpired: true, poolHandled: true } },
      { ...base, id: 'failed-add', contactStatus: 'not_accepted', customFields: { urgency: 'now', poolExpired: true } },
      { ...base, id: 'kept', contactStatus: null, customFields: { urgency: 'now', poolExpired: true } },
    ]);

    const result = await service.findUrgent('studio-1', { id: 'u-1', role: 'OWNER' });

    expect(result.map((o: any) => o.id)).toEqual(['kept']);
  });

  it('预约单没过期不出现，过期了才出现', async () => {
    const { service, prisma } = setup();
    const base = {
      status: 'PENDING',
      dispatchType: 'POOL',
      studioId: 'studio-1',
      createdAt: new Date(),
      contactStatus: null,
      customer: { wechatId: 'w', customerCode: '1', platform: null },
      csUser: { id: 'cs-1', username: '邵泽慧', avatar: null, displayName: null, role: 'CS' },
    };
    prisma.order.findMany.mockResolvedValue([
      { ...base, id: 'later-ok', customFields: { urgency: 'later' } },
      { ...base, id: 'later-expired', customFields: { urgency: 'later', poolExpired: true } },
    ]);

    const result = await service.findUrgent('studio-1', { id: 'u-1', role: 'OWNER' });

    expect(result.map((o: any) => o.id)).toEqual(['later-expired']);
  });
});
