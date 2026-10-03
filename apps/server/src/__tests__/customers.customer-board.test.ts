import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomersService } from '../customers/customers.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { currentBusinessDayRange } from '../common/business-day';

/**
 * 客户看板（老板 2026-10-04：「还有个同样口径的客户看板……它俩配合看基本就齐了」）。
 * 锁住跟「实时看板」对齐的今日口径（最容易算错、也最不能算错）：
 *  - 今日消费 / 今日单数：只算 **本营业日**（12:00 至次日 12:00）里、已完成的单；
 *  - 累计消费：全部已完成的单，不受营业日影响；
 *  - 按今日消费排序时，今日消费高的在前。
 */
describe('CustomersService.customerBoard（客户看板 · 今日口径）', () => {
  let prisma: MockPrisma;
  let service: CustomersService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new CustomersService(prisma as any);
  });

  it('今日只算本营业日的已完成单；累计算全部；今日消费排序正确', async () => {
    const { start } = currentBusinessDayRange();
    const inToday = new Date(start.getTime() + 60 * 60 * 1000); // 本营业日内
    const beforeToday = new Date(start.getTime() - 60 * 60 * 1000); // 上一个营业日

    (prisma.customer.findMany as any).mockResolvedValue([
      {
        id: 'cust1', customerCode: 'C0001', wechatId: 'wx1', studioId: 's1', companionId: 'C1',
        platform: '', platformAccount: '', status: 'SERVING', scheduledAt: null, depositBalance: 0,
        createdAt: beforeToday, studio: { name: '蠢驴电竞' },
      },
      {
        id: 'cust2', customerCode: 'C0002', wechatId: 'wx2', studioId: 's1', companionId: null,
        platform: '', platformAccount: '', status: 'PENDING', scheduledAt: null, depositBalance: 0,
        createdAt: beforeToday, studio: { name: '蠢驴电竞' },
      },
    ]);
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'C1', status: 'AVAILABLE', isResigned: false, user: { username: 'c1', displayName: '陪玩一', avatar: null }, pc: { lastHeartbeat: new Date() } },
    ]);
    (prisma.order.findMany as any).mockResolvedValue([
      { id: 'o1', customerId: 'cust1', status: 'DONE', amount: 100, createdAt: inToday }, // 本营业日
      { id: 'o2', customerId: 'cust1', status: 'DONE', amount: 200, createdAt: beforeToday }, // 上一营业日
      { id: 'o3', customerId: 'cust2', status: 'DONE', amount: 50, createdAt: inToday }, // 本营业日
      { id: 'o4', customerId: 'cust1', status: 'ACTIVE', amount: 999, createdAt: inToday }, // 未完成，不参与
    ]);
    (prisma.orderSession.findMany as any).mockResolvedValue([]);
    // 同一个 groupBy 被调两次：带 startedAt 的是「今日」，不带的是「累计」。
    (prisma.orderSession.groupBy as any).mockImplementation(async (args: any) => {
      if (args?.where?.startedAt) return [{ parentOrderId: 'o1', _sum: { duration: 2 } }];
      return [
        { parentOrderId: 'o1', _sum: { duration: 2 } },
        { parentOrderId: 'o2', _sum: { duration: 3 } },
      ];
    });

    const board: any = await service.customerBoard(
      { role: 'ADMIN', studioId: 's1', companionId: null } as any,
      { sort: 'today' },
    );
    const byId = new Map<string, any>(board.rows.map((r: any) => [r.customerId, r]));

    // cust1：累计 100 + 200 = 300（2 单），今日只有 100（1 单）；今日时长 2，累计 5。
    expect(byId.get('cust1').spent).toBe(300);
    expect(byId.get('cust1').orderCount).toBe(2);
    expect(byId.get('cust1').todaySpent).toBe(100);
    expect(byId.get('cust1').todayOrders).toBe(1);
    expect(byId.get('cust1').todayHours).toBe(2);
    expect(byId.get('cust1').hours).toBe(5);

    // cust2：今日 50（1 单）。
    expect(byId.get('cust2').todaySpent).toBe(50);
    expect(byId.get('cust2').todayOrders).toBe(1);

    // 统计：今日 150、累计 350。
    expect(board.counts.todaySpentTotal).toBe(150);
    expect(board.counts.spentTotal).toBe(350);

    // 按今日消费排序：cust1(100) 在 cust2(50) 前。
    expect(board.rows.map((r: any) => r.customerId)).toEqual(['cust1', 'cust2']);
  });
});
