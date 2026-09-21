// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-09-21：「发布出去的订单都显示在系统，已经被抢的抢单显示灰色」。
 *
 * 以前的订单池只返回 PENDING + 没被抢的单，陪玩一忙 / 一看视频就以为工作室没单，
 * 其实是被人抢走了。现在陪玩端会额外拿到「今天（营业日 12:00 起）已被抢的单」，
 * 前端灰掉展示；关键约束：
 *  ① 管理端/客服不拿这份灰色列表（他们在「全部订单」里看得到，避免重复）；
 *  ② 灰色列表里绝对不能带客户微信号（那是别人抢到的单）。
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
  return { service, prisma, bridgeService };
}

describe('订单池：今天已被抢走的单（灰色记录）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('管理端/客服（没有 companionId）不返回灰色记录，只走原来的查询', async () => {
    const { service, prisma } = setup();
    prisma.order.findMany.mockResolvedValue([]);

    const result = await service.findPool(undefined, 'studio-1');

    expect(result).toEqual([]);
    // 只查了一次（可抢的单），没有第二次查询
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  });

  it('陪玩端：可抢的单 + 今天被抢的单一起返回，被抢的带灰色标记和抢单人', async () => {
    const { service, prisma } = setup();
    const created = new Date().toISOString();
    prisma.order.findMany
      .mockResolvedValueOnce([
        {
          id: 'open-1',
          status: 'PENDING',
          dispatchType: 'POOL',
          // 自家工作室的单：桥接工作室的单默认要等 30 秒才可见，测试里不用等
          studioId: 'studio-1',
          companionId: null,
          createdAt: created,
          customFields: {},
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'taken-1',
          status: 'GRABBED',
          dispatchType: 'POOL',
          companionId: 'other-companion',
          coCompanionId: null,
          createdAt: created,
          grabbedAt: created,
          updatedAt: created,
          customFields: {},
          companion: { user: { displayName: '钱鸿鸣', username: 'qhm' } },
        },
        {
          id: 'taken-mine',
          status: 'CONFIRMED',
          dispatchType: 'POOL',
          companionId: 'companion-1',
          coCompanionId: null,
          createdAt: created,
          grabbedAt: created,
          updatedAt: created,
          customFields: {},
          companion: { user: { displayName: '我', username: 'me' } },
        },
      ]);

    const result = await service.findPool('companion-1', 'studio-1');

    expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
    const open = result.filter((o: any) => !o._taken);
    const taken = result.filter((o: any) => o._taken);
    expect(open.map((o: any) => o.id)).toEqual(['open-1']);
    expect(taken.map((o: any) => o.id)).toEqual(['taken-1', 'taken-mine']);
    expect(taken[0]).toMatchObject({ _takenByMe: false, _takenByName: '钱鸿鸣' });
    expect(taken[1]).toMatchObject({ _takenByMe: true, _takenByName: '我' });
    // 灰色记录里不带客户信息
    expect(taken[0].customer).toBeNull();
    expect(taken[1].customer).toBeNull();
    // 灰色记录只查「今天」的、且只查订单池的单
    const takenWhere = prisma.order.findMany.mock.calls[1][0].where;
    expect(takenWhere.dispatchType).toBe('POOL');
    expect(takenWhere.status.in).toContain('GRABBED');
    expect(takenWhere.OR[0].createdAt.gte).toBeInstanceOf(Date);
  });

  it('客服已处理 / 流转失败的单不出现在灰色记录里', async () => {
    const { service, prisma } = setup();
    prisma.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'handled', status: 'GRABBED', customFields: { poolHandled: true }, companionId: 'c9' },
        { id: 'expired', status: 'GRABBED', customFields: { poolExpired: true }, companionId: 'c9' },
        { id: 'ok', status: 'GRABBED', customFields: {}, companionId: 'c9' },
      ]);

    const result = await service.findPool('companion-1', 'studio-1');

    expect(result.map((o: any) => o.id)).toEqual(['ok']);
  });
});
