import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactReminderService } from '../orders/contact-reminder.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 客户微信「添加成功 / 添加失败」定期提醒（老板 2026-10-04）。
 * 只提醒、绝不自动收回，也不动名额；管理端按工作室汇总一条进待办。
 *
 * 老板 2026-10-04 再次简化节奏：「别搞这么复杂，先 24h 提醒一次，
 * 后期直接 7 天提醒一次」——陪玩本人只在满 24 小时、满 7 天各提醒一次；
 * 管理端只在满 7 天进一条待办。
 */
describe('ContactReminderService', () => {
  let service: ContactReminderService;
  let prisma: MockPrisma;
  let ws: { pushToCompanion: any; notifyUser: any };

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);

  const order = (over: any = {}) => ({
    id: 'o1',
    orderCode: 'D001',
    studioId: 'studio-1',
    companionId: 'comp-1',
    grabbedAt: hoursAgo(0.5),
    createdAt: hoursAgo(1),
    customFields: {},
    customer: {
      wechatId: 'wx-client',
      customerCode: 'C1',
      platform: '小红书',
      platformAccount: '蠢驴电竞官方号',
    },
    companion: { user: { displayName: '张三', username: 'zhangsan' } },
    _count: { sessions: 0 },
    ...over,
  });

  beforeEach(() => {
    prisma = createMockPrisma();
    ws = { pushToCompanion: vi.fn(), notifyUser: vi.fn() };
    service = new ContactReminderService(prisma as any, ws as any);
  });

  it('不到 24 小时不打扰', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(0.2) })]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('满 24 小时给陪玩本人推第 1 次，并记下进度', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(25), createdAt: hoursAgo(30) })]);
    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(1);
    const [companionId, event, payload] = ws.pushToCompanion.mock.calls[0];
    expect(companionId).toBe('comp-1');
    expect(event).toBe('order:contact_reminder');
    expect(payload.stage).toBe(1);
    expect(payload.total).toBe(2);
    expect(payload.orderCode).toBe('D001');
    expect(String(payload.message)).toContain('添加成功');

    const updateArg = prisma.order.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'o1' });
    expect(updateArg.data.customFields.contactReminder.stage).toBe(1);
    // 还没满 7 天，不该进管理端待办
    expect(ws.notifyUser).not.toHaveBeenCalled();
  });

  it('已提醒到第 1 次、满 7 天就第 2 次（也是最后一次）', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(24 * 8),
        customFields: { contactReminder: { stage: 1, lastAt: hoursAgo(120) } },
      }),
    ]);
    await service.tick();
    const payload = ws.pushToCompanion.mock.calls[0][2];
    expect(payload.stage).toBe(2);
    expect(payload.total).toBe(2);
    expect(String(payload.message)).toContain('第 2 次提醒');
  });

  it('积压很久的老单只提醒一次，直接跳到最后一个节点，不会连弹多次', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(24 * 10) })]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }]);

    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(1);
    expect(ws.pushToCompanion.mock.calls[0][2].stage).toBe(2);
    const updateArg = prisma.order.update.mock.calls[0][0];
    expect(updateArg.data.customFields.contactReminder.stage).toBe(2);
    // 满 7 天 → 管理端待办记一档（10080 分钟）
    expect(updateArg.data.customFields.contactReminder.adminNotified).toEqual([10080]);
  });

  it('满 7 天：提醒陪玩第 2 次 + 管理端待办一条（带小红书来源）', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(24 * 8),
        customFields: { contactReminder: { stage: 1, lastAt: hoursAgo(120) } },
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }]);

    await service.tick();

    expect(ws.pushToCompanion.mock.calls[0][2].stage).toBe(2);
    expect(ws.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, event, payload] = ws.notifyUser.mock.calls[0];
    expect(userId).toBe('u-admin');
    expect(event).toBe('order:contact_reminder_admin');
    expect(payload.kind).toBe('LONG_PENDING');
    expect(payload.count).toBe(1);
    expect(payload.orders[0].companionName).toBe('张三');
    expect(payload.orders[0].customerWechat).toBe('wx-client');
    expect(payload.orders[0].platformAccount).toBe('蠢驴电竞官方号');
    expect(String(payload.message)).toContain('小红书 @蠢驴电竞官方号');
    expect(String(payload.message)).toContain('封存');
  });

  it('管理端满 7 天的待办只发一次，不会重复打扰', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(24 * 9),
        customFields: { contactReminder: { stage: 1, lastAt: hoursAgo(120), adminNotified: [10080] } },
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }]);

    await service.tick();

    // 陪玩那边还会补一次第 2 次提醒，但管理端不再重复发
    expect(ws.pushToCompanion).toHaveBeenCalledTimes(1);
    expect(ws.notifyUser).not.toHaveBeenCalled();
  });

  it('同一个工作室多单满 7 天积压 → 管理端只收一条汇总', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({ id: 'o1', orderCode: 'D001', grabbedAt: hoursAgo(24 * 8) }),
      order({ id: 'o2', orderCode: 'D002', companionId: 'comp-2', grabbedAt: hoursAgo(24 * 9) }),
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }, { id: 'u-cs' }]);

    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(2);
    expect(ws.notifyUser).toHaveBeenCalledTimes(2); // 2 个管理端用户 × 1 条汇总
    const payload = ws.notifyUser.mock.calls[0][2];
    expect(payload.count).toBe(2);
    expect(payload.orders.map((o: any) => o.orderCode)).toEqual(['D001', 'D002']);
  });

  it('两个节点都提醒过 + 待办发过 → 完全不再打扰', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(24 * 20),
        customFields: {
          contactReminder: { stage: 2, lastAt: hoursAgo(200), adminNotified: [10080] },
        },
      }),
    ]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
    expect(ws.notifyUser).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('已经有服务会话的单（早走下去了）不再催标记', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({ grabbedAt: hoursAgo(24 * 8), _count: { sessions: 1 } }),
    ]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('陪玩已标记（查询结果为空）时不提醒', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
  });
});
