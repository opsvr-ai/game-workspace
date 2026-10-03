import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactReminderService } from '../orders/contact-reminder.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 客户微信「添加成功 / 添加失败」定期提醒（老板 2026-10-04）。
 * 只提醒，不收回、不动名额；管理端按工作室汇总成一条。
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
    customer: { wechatId: 'wx-client', customerCode: 'C1' },
    companion: { user: { displayName: '张三', username: 'zhangsan' } },
    _count: { sessions: 0 },
    ...over,
  });

  beforeEach(() => {
    prisma = createMockPrisma();
    ws = { pushToCompanion: vi.fn(), notifyUser: vi.fn() };
    service = new ContactReminderService(prisma as any, ws as any);
  });

  it('不到 1 小时不打扰', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(0.2) })]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('满 1 小时给陪玩本人推一次，并记下进度', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(1.2), createdAt: hoursAgo(3) })]);
    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(1);
    const [companionId, event, payload] = ws.pushToCompanion.mock.calls[0];
    expect(companionId).toBe('comp-1');
    expect(event).toBe('order:contact_reminder');
    expect(payload.stage).toBe(1);
    expect(payload.orderCode).toBe('D001');
    expect(String(payload.message)).toContain('添加成功');

    const updateArg = prisma.order.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'o1' });
    expect(updateArg.data.customFields.contactReminder.stage).toBe(1);
    // 还没到 3 天，不该叫管理端
    expect(ws.notifyUser).not.toHaveBeenCalled();
  });

  it('按节点推进：已提醒到第 1 次、满 6 小时就第 2 次', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(7),
        customFields: { contactReminder: { stage: 1, lastAt: hoursAgo(6) } },
      }),
    ]);
    await service.tick();
    const payload = ws.pushToCompanion.mock.calls[0][2];
    expect(payload.stage).toBe(2);
    expect(String(payload.message)).toContain('第 2 次提醒');
  });

  it('积压很久的老单只提醒一次，直接跳到最高节点，不会连弹 5 次', async () => {
    prisma.order.findMany.mockResolvedValue([order({ grabbedAt: hoursAgo(80) })]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }]);

    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(1);
    expect(ws.pushToCompanion.mock.calls[0][2].stage).toBe(5);
    expect(ws.notifyUser).toHaveBeenCalledTimes(1);
    const updateArg = prisma.order.update.mock.calls[0][0];
    expect(updateArg.data.customFields.contactReminder.stage).toBe(5);
    expect(updateArg.data.customFields.contactReminder.escalatedAt).toBeTruthy();
  });

  it('满 3 天：最后一次提醒 + 管理端汇总一条（带陪玩名和微信号）', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(80),
        customFields: { contactReminder: { stage: 4, lastAt: hoursAgo(30) } },
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }]);

    await service.tick();

    expect(ws.pushToCompanion.mock.calls[0][2].stage).toBe(5);
    expect(ws.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, event, payload] = ws.notifyUser.mock.calls[0];
    expect(userId).toBe('u-admin');
    expect(event).toBe('order:contact_reminder_admin');
    expect(payload.count).toBe(1);
    expect(payload.orders[0].orderId).toBe('o1');
    expect(payload.orders[0].companionName).toBe('张三');
    expect(payload.orders[0].customerWechat).toBe('wx-client');
    expect(String(payload.message)).toContain('张三');
    expect(String(payload.message)).toContain('删掉');
  });

  it('同一个工作室多单积压 → 管理端只收一条汇总', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({ id: 'o1', orderCode: 'D001', grabbedAt: hoursAgo(80) }),
      order({ id: 'o2', orderCode: 'D002', companionId: 'comp-2', grabbedAt: hoursAgo(90) }),
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-admin' }, { id: 'u-cs' }]);

    await service.tick();

    expect(ws.pushToCompanion).toHaveBeenCalledTimes(2);
    expect(ws.notifyUser).toHaveBeenCalledTimes(2); // 2 个管理端用户 × 1 条汇总
    const payload = ws.notifyUser.mock.calls[0][2];
    expect(payload.count).toBe(2);
    expect(payload.orders.map((o: any) => o.orderCode)).toEqual(['D001', 'D002']);
  });

  it('五个节点都提醒过 + 已升级过 → 完全不再打扰', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({
        grabbedAt: hoursAgo(100),
        customFields: { contactReminder: { stage: 5, lastAt: hoursAgo(20), escalatedAt: hoursAgo(20) } },
      }),
    ]);
    await service.tick();
    expect(ws.pushToCompanion).not.toHaveBeenCalled();
    expect(ws.notifyUser).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('已经有服务会话的单（早走下去了）不再催标记', async () => {
    prisma.order.findMany.mockResolvedValue([
      order({ grabbedAt: hoursAgo(80), _count: { sessions: 1 } }),
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