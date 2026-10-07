import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsService } from '../stats/stats.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { businessDayKey, currentBusinessDayRange } from '../common/business-day';

/**
 * 每日数据（老板 2026-10-07）：「陪玩端 + 管理端清清楚楚知道每天打了多少单、
 * 多少续了、续单率多少、多少复购、复购率多少、客户什么情况，能点开看明细」。
 *
 * 锁住最容易错、也最不能错的几条：
 *  - 营业日 12:00 边界（12:00 之前的单算前一天）；
 *  - 单型拆分 + 「按单」的续单率 / 复购率（不是 30 天 KPI 那个「按客户」口径）；
 *  - 客户按人去重、新客 = 当天在他这打首单的客户；
 *  - 搭档（被邀请）参与的单也算他的量，但单独计数；
 *  - 陪玩只能看自己（传别人的 id 无效）、管理端看全店。
 */
describe('StatsService.getDailyKpi（每日数据）', () => {
  let prisma: MockPrisma;
  let service: StatsService;
  const today = businessDayKey(new Date());
  const { start } = currentBusinessDayRange();
  /** 本营业日 12:00 之后再过 h 小时 */
  const at = (h: number) => new Date(start.getTime() + h * 3600 * 1000);

  /** 让 mock 也像真库一样按 where 过滤（否则会把别人的单一起算进来，测不出取数口径）。 */
  const filterOrders = (rows: any[], where: any) =>
    rows.filter((r) => {
      if (where?.studioId && r.studioId !== where.studioId) return false;
      if (where?.type && r.type !== where.type) return false;
      if (where?.OR) return where.OR.some((c: any) => c.companionId === r.companionId || c.coCompanionId === r.coCompanionId);
      return true;
    });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new StatsService(prisma as any);
    (prisma.orderSession.findMany as any).mockResolvedValue([]);
    (prisma.companion.findMany as any).mockResolvedValue([]);
  });

  it('按营业日分桶：12:00 之前下的单算前一天', async () => {
    (prisma.order.findMany as any).mockResolvedValue([
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(1) },
      { id: 'o2', type: 'NEW', amount: 50, customerId: 'c2', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: new Date(start.getTime() - 3600 * 1000) },
    ]);

    const res = await service.getDailyKpi({}, { role: 'OWNER' } as any);
    const todayRow = res.rows.find((r) => r.date === today)!;
    const prevRow = res.rows.find((r) => r.date !== today)!;
    expect(todayRow.orders).toBe(1);
    expect(prevRow.orders).toBe(1);
    expect(res.total.orders).toBe(2);
    expect(res.rows[0].date).toBe(today); // 新的在前
  });

  it('单型拆分 / 按单的续单率复购率 / 客户去重与新客 / 搭档单单独计数', async () => {
    const raw = [
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(1) },
      { id: 'o2', type: 'RENEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(2) },
      // 这一单他不是主陪，是被 B 拉来当搭档的 → 也算他的量
      { id: 'o3', type: 'REPURCHASE', amount: 200, customerId: 'c2', companionId: 'B', coCompanionId: 'A', studioId: 's1', createdAt: at(3) },
      { id: 'o4', type: 'NEW', amount: 30, customerId: 'c3', companionId: 'C', coCompanionId: null, studioId: 's1', createdAt: at(4) },
    ];
    (prisma.order.findMany as any).mockImplementation(async (args: any) => filterOrders(raw, args?.where));
    (prisma.orderSession.findMany as any).mockResolvedValue([
      { startedAt: at(1), duration: 2 },
      { startedAt: at(2), duration: 1.5 },
    ]);
    (prisma.companion.findUnique as any).mockResolvedValue({ user: { username: '周达', displayName: null } });

    const res = await service.getDailyKpi({ companionId: 'A' }, { role: 'ADMIN', studioId: 's1' } as any);
    expect(res.scope).toBe('COMPANION');
    expect(res.companionName).toBe('周达');
    const row = res.rows[0];
    expect(row.orders).toBe(3); // o1 / o2 / o3（o4 是 C 的单，不算他的）
    expect(row.first).toBe(1);
    expect(row.renew).toBe(1);
    expect(row.repurchase).toBe(1);
    expect(row.renewRate).toBe(33); // 1 ÷ 3（按单）
    expect(row.repurchaseRate).toBe(33);
    expect(row.customers).toBe(2); // c1 / c2
    expect(row.newCustomers).toBe(1); // c1
    expect(row.partnerOrders).toBe(1); // o3
    expect(row.amount).toBe(400);
    expect(row.hours).toBe(3.5);
    expect(res.total.orders).toBe(3);
  });

  it('管理端看全店：不按人过滤；同一个客户由两个人服务也只算一个客户', async () => {
    const raw = [
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: 'B', studioId: 's1', createdAt: at(1) },
      { id: 'o2', type: 'RENEW', amount: 100, customerId: 'c1', companionId: 'B', coCompanionId: null, studioId: 's1', createdAt: at(2) },
      { id: 'o3', type: 'NEW', amount: 80, customerId: 'c2', companionId: 'A', coCompanionId: null, studioId: 's2', createdAt: at(3) },
    ];
    (prisma.order.findMany as any).mockImplementation(async (args: any) => filterOrders(raw, args?.where));

    const res = await service.getDailyKpi({}, { role: 'ADMIN', studioId: 's1' } as any);
    const row = res.rows[0];
    expect(res.scope).toBe('STORE');
    expect(row.orders).toBe(2); // 另一个店的 o3 不算
    expect(row.customers).toBe(1);
    expect(row.renewRate).toBe(50);
  });

  it('陪玩端只能看自己：传别人的陪玩 id 不生效', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);

    const res = await service.getDailyKpi(
      { companionId: 'SOMEONE_ELSE' },
      { role: 'COMPANION', companionId: 'ME', studioId: 's1' } as any,
    );
    expect(res.companionId).toBe('ME');
    const where = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ companionId: 'ME' }, { coCompanionId: 'ME' }]);
    expect(where.studioId).toBe('s1');
  });

  it('管理端给出陪玩下拉（含已离职标记）', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'A', isResigned: false, user: { username: '周达', displayName: null } },
      { id: 'B', isResigned: true, user: { username: '老秦', displayName: '秦硕' } },
    ]);

    const res = await service.getDailyKpi({}, { role: 'ADMIN', studioId: 's1' } as any);
    expect(res.companions).toEqual([
      { id: 'B', name: '秦硕', resigned: true },
      { id: 'A', name: '周达', resigned: false },
    ]);
  });

  it('区间归一化：默认最近 14 个营业日；给反了 / 给太长都能兜住', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);

    const def = await service.getDailyKpi({}, { role: 'ADMIN', studioId: 's1' } as any);
    expect(def.dateTo).toBe(today);
    expect(def.dateFrom).toBe('2026-09-24');
    expect(def.total.date).toBe('2026-09-24 ~ 2026-10-07');

    const flipped = await service.getDailyKpi({ dateFrom: today, dateTo: '2026-09-01' }, { role: 'ADMIN', studioId: 's1' } as any);
    expect(flipped.dateFrom).toBe(flipped.dateTo);

    const tooLong = await service.getDailyKpi(
      { dateFrom: '2020-01-01', dateTo: today },
      { role: 'ADMIN', studioId: 's1' } as any,
    );
    expect(tooLong.dateFrom).toBe('2026-08-07'); // 只回退 62 天
  });
});
