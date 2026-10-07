import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsService } from '../stats/stats.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';
import { businessDayKey, currentBusinessDayRange } from '../common/business-day';

/**
 * 每日数据（老板 2026-10-07）：「陪玩端 + 管理端清清楚楚知道每天打了多少单、
 * 多少续了、续单率多少、多少复购、复购率多少、客户什么情况，能点开看明细」。
 *
 * 口径 2026-10-08 统一（老板：「续单率现在有两套算法……统一成一套」）：
 * 续单 / 复购 **按客户**算，跟优秀度 / 陪玩 KPI 共用 `common/customer-rates.ts` 的判定 ——
 * 「同一个单里加打一段」这种续单必须算进来（以前按订单类型数单，正好漏掉它）。
 *
 * 锁住最容易错、也最不能错的几条：
 *  - 营业日 12:00 边界（12:00 之前的单算前一天）；
 *  - 单型拆分 + 「按客户」的续单率 / 复购率（分母 = 当天服务过且打过首单的客户）；
 *  - 「加打一段」（会话 seq > 1）也算续单；
 *  - 客户按人去重、新客 = 当天在他这打首单的客户；
 *  - 搭档（被邀请）参与的单也算他的量，但单独计数；
 *  - 陪玩只能看自己（传别人的 id 无效）、管理端看全店。
 */
describe('StatsService.getDailyKpi（每日数据）', () => {
  let prisma: MockPrisma;
  let service: StatsService;
  const today = businessDayKey(new Date());
  const { start } = currentBusinessDayRange();
  /** 本营业日 12:00 之后再过 h 小时（负数是昨天的同一时刻） */
  const at = (h: number) => new Date(start.getTime() + h * 3600 * 1000);

  /** 让 mock 也像真库一样按 where 过滤（否则会把别人的单一起算进来，测不出取数口径）。 */
  const filterOrders = (rows: any[], where: any) =>
    rows.filter((r) => {
      if (where?.studioId && r.studioId !== where.studioId) return false;
      if (where?.type && r.type !== where.type) return false;
      if (where?.OR) return where.OR.some((c: any) => c.companionId === r.companionId || c.coCompanionId === r.coCompanionId);
      return true;
    });

  /** 模拟 order.groupBy：按 customerId 取最早的 createdAt（firstNew / firstAny 各查一次）。 */
  const groupOrders = (rows: any[], where: any) => {
    const min = new Map<string, Date>();
    for (const r of filterOrders(rows, where)) {
      const t = r.createdAt as Date;
      const cur = min.get(r.customerId);
      if (!cur || t.getTime() < cur.getTime()) min.set(r.customerId, t);
    }
    return [...min.entries()].map(([customerId, t]) => ({ customerId, _min: { createdAt: t } }));
  };

  const wireOrders = (raw: any[]) => {
    (prisma.order.findMany as any).mockImplementation(async (args: any) => filterOrders(raw, args?.where));
    (prisma.order.groupBy as any).mockImplementation(async (args: any) => groupOrders(raw, args?.where));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new StatsService(prisma as any);
    (prisma.orderSession.findMany as any).mockResolvedValue([]);
    (prisma.orderSession.groupBy as any).mockResolvedValue([]);
    (prisma.order.groupBy as any).mockResolvedValue([]);
    (prisma.customer.findMany as any).mockResolvedValue([]);
    (prisma.companion.findMany as any).mockResolvedValue([]);
  });

  it('按营业日分桶：12:00 之前下的单算前一天', async () => {
    wireOrders([
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

  it('单型拆分 / 按客户的续单率复购率 / 客户去重与新客 / 搭档单单独计数', async () => {
    const raw = [
      { id: 'o0', type: 'NEW', amount: 100, customerId: 'c2', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(-20) },
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(1) },
      { id: 'o2', type: 'RENEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(2) },
      // 这一单他不是主陪，是被 B 拉来当搭档的 → 也算他的量
      { id: 'o3', type: 'REPURCHASE', amount: 200, customerId: 'c2', companionId: 'B', coCompanionId: 'A', studioId: 's1', createdAt: at(3) },
      { id: 'o4', type: 'NEW', amount: 30, customerId: 'c3', companionId: 'C', coCompanionId: null, studioId: 's1', createdAt: at(4) },
    ];
    wireOrders(raw);
    (prisma.orderSession.findMany as any).mockResolvedValue([
      { startedAt: at(1), duration: 2 },
      { startedAt: at(2), duration: 1.5 },
    ]);
    (prisma.companion.findUnique as any).mockResolvedValue({ user: { username: '周达', displayName: null } });

    const res = await service.getDailyKpi({ companionId: 'A' }, { role: 'ADMIN', studioId: 's1' } as any);
    expect(res.scope).toBe('COMPANION');
    expect(res.companionName).toBe('周达');
    const row = res.rows[0];
    expect(row.orders).toBe(3); // o1 / o2 / o3（o0 是昨天，o4 是 C 的单）
    expect(row.first).toBe(1);
    expect(row.renew).toBe(2); // c1（续单单）+ c2（复购单）——按客户去重
    expect(row.repurchase).toBe(1); // c2：昨天来过，今天又来
    expect(row.renewRate).toBe(100); // 2 ÷ 2（都是打过首单的客户）
    expect(row.repurchaseRate).toBe(50); // 1 ÷ 2
    expect(row.customers).toBe(2); // c1 / c2
    expect(row.newCustomers).toBe(1); // c1
    expect(row.partnerOrders).toBe(1); // o3
    expect(row.amount).toBe(400);
    expect(row.hours).toBe(3.5);
    expect(res.total.orders).toBe(4);
    expect(res.total.renew).toBe(2);
    expect(res.total.repurchase).toBe(1);
  });

  it('「同一个单里加打一段」（会话 seq > 1）也算续单 —— 老板 2026-10-08 报的那个洞', async () => {
    wireOrders([
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1', createdAt: at(1) },
    ]);
    // 客户在同一天加了第 2 段（没有新订单，只有一条 seq=2 的会话）
    (prisma.orderSession.findMany as any).mockResolvedValue([
      { id: 's1', seq: 1, duration: 1, startedAt: at(1), parentOrder: { type: 'NEW', customerId: 'c1', companionId: 'A', coCompanionId: null } },
      { id: 's2', seq: 2, duration: 1, startedAt: at(2), parentOrder: { type: 'NEW', customerId: 'c1', companionId: 'A', coCompanionId: null } },
    ]);

    const res = await service.getDailyKpi({ companionId: 'A' }, { role: 'ADMIN', studioId: 's1' } as any);
    const row = res.rows[0];
    expect(row.orders).toBe(1);
    expect(row.renew).toBe(1); // 以前这里是 0 —— 加打一段进不了续单率
    expect(row.renewRate).toBe(100);
    expect(row.hours).toBe(2);
  });

  it('管理端看全店：不按人过滤；同一个客户由两个人服务也只算一个客户', async () => {
    const raw = [
      { id: 'o1', type: 'NEW', amount: 100, customerId: 'c1', companionId: 'A', coCompanionId: 'B', studioId: 's1', createdAt: at(1) },
      { id: 'o2', type: 'RENEW', amount: 100, customerId: 'c1', companionId: 'B', coCompanionId: null, studioId: 's1', createdAt: at(2) },
      { id: 'o3', type: 'NEW', amount: 80, customerId: 'c2', companionId: 'A', coCompanionId: null, studioId: 's2', createdAt: at(3) },
    ];
    wireOrders(raw);

    const res = await service.getDailyKpi({}, { role: 'ADMIN', studioId: 's1' } as any);
    const row = res.rows[0];
    expect(res.scope).toBe('STORE');
    expect(row.orders).toBe(2); // 另一个店的 o3 不算
    expect(row.customers).toBe(1);
    expect(row.renew).toBe(1);
    expect(row.renewRate).toBe(100);
  });

  it('陪玩端只能看自己：传别人的陪玩 id 不生效', async () => {
    wireOrders([]);

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
    wireOrders([]);
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
    wireOrders([]);

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

  it('明细：只加了一段、这一天没有新单的客户也看得见，并标成续单客户', async () => {
    const rich = [
      {
        id: 'o1',
        orderCode: 'A1',
        type: 'NEW',
        amount: 100,
        gameName: '三角洲行动',
        createdAt: at(1),
        customerId: 'c1',
        companionId: 'A',
        coCompanionId: null,
        studioId: 's1',
        customer: { customerCode: 'KH1', wechatId: 'wx1' },
        companion: { user: { username: '周达', displayName: null } },
        coCompanion: null,
        csUser: null,
        sessions: [{ duration: 1, startedAt: at(1), endedAt: at(2) }],
      },
    ];
    wireOrders(rich);
    (prisma.orderSession.findMany as any).mockResolvedValue([
      { id: 's2', seq: 2, duration: 1.5, startedAt: at(2), parentOrder: { type: 'NEW', customerId: 'c1', companionId: 'A', coCompanionId: null } },
    ]);

    const res = await service.getDailyKpiDetail({ date: today }, { role: 'ADMIN', studioId: 's1' } as any);
    expect(res.orders.length).toBe(1);
    expect(res.customers.length).toBe(1);
    const c = res.customers[0];
    expect(c.customerId).toBe('c1');
    expect(c.orders).toBe(1);
    expect(c.hours).toBe(2.5); // 1（首单那段）+ 1.5（加打的那段）
    expect(c.counted).toBe(true);
    expect(c.renewed).toBe(true);
    expect(c.repurchased).toBe(false);
    expect(c.kinds).toContain('RENEW');
  });

  it('明细：只看续单时客户表仍是全天口径（分母里的客户不被藏掉）', async () => {
    const rich = [
      {
        id: 'o1', orderCode: 'A1', type: 'NEW', amount: 100, gameName: '三角洲行动',
        createdAt: at(1), customerId: 'c1', companionId: 'A', coCompanionId: null, studioId: 's1',
        customer: { customerCode: 'KH1', wechatId: 'wx1' },
        companion: { user: { username: '周达', displayName: null } }, coCompanion: null, csUser: null,
        sessions: [{ duration: 1, startedAt: at(1), endedAt: at(2) }],
      },
      {
        id: 'o2', orderCode: 'A2', type: 'RENEW', amount: 100, gameName: '三角洲行动',
        createdAt: at(2), customerId: 'c2', companionId: 'A', coCompanionId: null, studioId: 's1',
        customer: { customerCode: 'KH2', wechatId: 'wx2' },
        companion: { user: { username: '周达', displayName: null } }, coCompanion: null, csUser: null,
        sessions: [{ duration: 1, startedAt: at(2), endedAt: at(3) }],
      },
    ];
    wireOrders(rich);

    const res = await service.getDailyKpiDetail({ date: today, kind: 'RENEW' }, { role: 'ADMIN', studioId: 's1' } as any);
    expect(res.orders.length).toBe(1); // 单表只看续单
    expect(res.orders[0].type).toBe('RENEW');
    expect(res.customers.length).toBe(2); // 客户表还是全天
  });
});
