import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 客户画像（老板 2026-10-04）：
 * 「这同一个客户在多少个工作微信上，各自消费了多少、打机密还是绝密、打了多久、维护多久了……
 *  以后再遇到这个客户咨询小红书，客服就应该单独派给什么样的陪玩了。」
 *
 * 锁住最容易算错的几件事：
 *  - 只算已完成（DONE）的单 / 会话；
 *  - 消费 = 单价 × 实际时长（主陪 amount、副陪 coAmount 各算各的，别漏了副陪那一份）；
 *  - 模式优先取陪玩实际确认的 claimedMode，没有才退回客服发单填的 gameMode / deltaMission；
 *  - 「工作微信」认单上记的 `customFields.workWechatName`（陪玩抢单时自动绑的），
 *    单上没记才退回「这个陪玩当前绑定的工作微信」；
 *  - 派单建议按**人**算（一张双陪单的副陪也算他自己头上），优先最常打的模式。
 */
describe('CustomersService.customerProfileAnalytics（客户画像）', () => {
  let prisma: MockPrisma;
  let service: CustomersService;

  const customer = {
    id: 'cust1',
    customerCode: 'C0001',
    wechatId: 'wx_cust',
    studioId: 's1',
    status: 'ACTIVE',
    companionId: 'C1',
    createdAt: new Date('2026-09-18T00:00:00Z'),
    studio: { name: '蠢驴电竞' },
  };

  const order = (over: any) => ({
    orderCode: '1', type: 'NEW', status: 'DONE', amount: 35, coAmount: null,
    duration: 1, gameName: '三角洲行动', createdAt: new Date('2026-09-20T10:00:00Z'),
    customFields: {}, companionId: null, coCompanionId: null,
    csWorkWechatId: null, csWorkWechatName: null,
    ...over,
  });

  // 带「单上记的工作微信」的一套数据：同一个客户在 2 个工作微信上打过
  const ordersWithWx = [
    order({
      id: 'o1', type: 'NEW', amount: 35, coAmount: 35, companionId: 'C1', coCompanionId: 'C2',
      createdAt: new Date('2026-09-20T10:00:00Z'),
      customFields: { gameMode: '机密', workWechatName: 'pw_c1' },
    }),
    order({
      id: 'o2', type: 'RENEW', amount: 45, companionId: 'C1',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      customFields: { deltaMission: '绝密', workWechatName: 'pw_c2' },
    }),
    order({
      id: 'o3', status: 'PENDING', amount: 999, createdAt: new Date('2026-10-03T10:00:00Z'),
    }),
  ];

  const sessions = [
    {
      id: 's1', parentOrderId: 'o1', companionId: 'C1', coCompanionId: 'C2',
      amount: 35, coAmount: 35, duration: 2, claimedMode: '机密', claimedPrice: 35,
      startedAt: new Date('2026-09-20T10:00:00Z'),
    },
    {
      id: 's2', parentOrderId: 'o2', companionId: 'C1', coCompanionId: null,
      amount: 45, coAmount: null, duration: 1, claimedMode: '绝密', claimedPrice: 45,
      startedAt: new Date('2026-10-01T10:00:00Z'),
    },
  ];

  const companionRows = [
    {
      id: 'C1', status: 'AVAILABLE', isResigned: false,
      user: { username: 'c1', displayName: '陪玩一', avatar: null },
      studio: { id: 's1', name: '蠢驴电竞', type: 'OFFLINE' },
      pc: { lastHeartbeat: new Date() },
    },
    {
      id: 'C2', status: 'BUSY', isResigned: false,
      user: { username: 'c2', displayName: '陪玩二', avatar: null },
      studio: { id: 's1', name: '蠢驴电竞', type: 'OFFLINE' },
      pc: { lastHeartbeat: null },
    },
  ];

  const setup = (orders: any[] = ordersWithWx) => {
    (prisma.customer.findUnique as any).mockResolvedValue(customer);
    (prisma.order.findMany as any).mockResolvedValue(orders);
    (prisma.orderSession.findMany as any).mockResolvedValue(sessions);
    (prisma.companion.findMany as any).mockResolvedValue(companionRows);
    (prisma.workWechat.findMany as any).mockResolvedValue([
      { companionId: 'C1', wechatId: 'pw_c1', nickname: '陪玩一的工作微信', status: 'BOUND' },
    ]);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new CustomersService(prisma as any);
    setup();
  });

  const admin = { role: 'ADMIN', studioId: 's1', companionId: null } as any;

  it('已完成单才算：单数 / 时长 / 毛收入（单价 × 实际时长，含副陪）', async () => {
    const res: any = await service.customerProfileAnalytics('cust1', admin);

    expect(res.totals.doneOrders).toBe(2); // PENDING 那条不算
    expect(res.totals.sessions).toBe(2);
    expect(res.totals.hours).toBe(3); // 2 小时 + 1 小时
    expect(res.totals.gross).toBe(185); // (35+35)*2 + 45*1
    expect(res.customer.customerCode).toBe('C0001');
    expect(res.customer.maintainDays).toBeGreaterThanOrEqual(0);
  });

  it('模式分布优先用陪玩确认的 claimedMode，绝密 / 机密分开算', async () => {
    const res: any = await service.customerProfileAnalytics('cust1', admin);
    expect(res.totals.topMode).toBe('机密'); // 机密 2 小时 > 绝密 1 小时
    const modes = new Map<string, any>(res.totals.modes.map((m: any) => [m.mode, m]));
    expect(modes.get('机密').hours).toBe(2);
    expect(modes.get('机密').ratio).toBe(67);
    expect(modes.get('绝密').hours).toBe(1);
    expect(res.totals.price).toMatchObject({ min: 35, max: 45, avg: 38.3, samples: 3 });
  });

  it('按工作微信分组：在 2 个工作微信上，各自消费 / 模式 / 时长都算得清', async () => {
    const res: any = await service.customerProfileAnalytics('cust1', admin);

    expect(res.totals.workWechatCount).toBe(2);
    expect(res.totals.workWechatRowCount).toBe(2);
    expect(res.totals.companionCount).toBe(2); // 经手的陪玩：陪玩一、陪玩二
    expect(res.totals.onlineCompanions).toBe(1); // 只有陪玩一在线

    // pw_c1：o1 这张双陪单（机密 2 小时）挂的主陪的号
    const w1 = res.workWechats[0];
    expect(w1.workWechatId).toBe('pw_c1');
    expect(w1.recorded).toBe(true);
    expect(w1.orders).toBe(1);
    expect(w1.hours).toBe(2);
    expect(w1.money).toBe(140);
    expect(w1.topMode).toBe('机密');
    expect(w1.companionId).toBe('C1');
    expect(w1.companionName).toBe('陪玩一');
    expect(w1.companionsCount).toBe(2); // 双陪单：主陪 + 副陪都算
    expect(w1.workWechatNickname).toBe('陪玩一的工作微信');

    // pw_c2：o2 这张单上记的另一个工作微信
    const w2 = res.workWechats[1];
    expect(w2.workWechatId).toBe('pw_c2');
    expect(w2.orders).toBe(1);
    expect(w2.hours).toBe(1);
    expect(w2.money).toBe(45);
    expect(w2.topMode).toBe('绝密');
  });

  it('单上没记工作微信时，退回这个陪玩当前绑定的工作微信', async () => {
    setup([
      order({
        id: 'o1', amount: 35, coAmount: 35, companionId: 'C1', coCompanionId: 'C2',
        customFields: { gameMode: '机密' },
      }),
      order({ id: 'o2', amount: 45, companionId: 'C1', customFields: { deltaMission: '绝密' } }),
    ]);
    const res: any = await service.customerProfileAnalytics('cust1', admin);

    expect(res.totals.workWechatCount).toBe(1); // 陪玩一有绑定的号，陪玩二没有
    expect(res.totals.workWechatRowCount).toBe(2); // 按陪玩兜了两行，人不漏
    expect(res.workWechats[0].recorded).toBe(false); // 单上确实没记
    expect(res.workWechats[0].companionId).toBe('C1');
    expect(res.workWechats[0].workWechatId).toBe('pw_c1'); // 退回绑定的号
    expect(res.workWechats[0].hasWorkWechat).toBe(true);
    expect(res.workWechats[1].hasWorkWechat).toBe(false);
  });

  it('派单建议按人算：优先陪他打过、且打得就是他最常打模式的人', async () => {
    const res: any = await service.customerProfileAnalytics('cust1', admin);
    expect(res.recommendation.topMode).toBe('机密');
    expect(res.recommendation.picks.length).toBe(2);
    expect(res.recommendation.picks[0].companionId).toBe('C1');
    expect(res.recommendation.picks[0].modeHours).toBe(2);
    expect(res.recommendation.summary).toContain('机密');
    expect(res.recommendation.summary).toContain('陪玩一');
    expect(res.recommendation.summary).toContain('2 个工作微信');
  });

  it('没有成交的客户也能出画像（不炸，只是没建议）', async () => {
    setup([order({ id: 'o9', status: 'PENDING', amount: 999 })]);
    const res: any = await service.customerProfileAnalytics('cust1', admin);
    expect(res.totals.doneOrders).toBe(0);
    expect(res.workWechats).toEqual([]);
    expect(res.recommendation.picks).toEqual([]);
    expect(res.recommendation.summary).toContain('还没有成交记录');
  });

  it('可见范围：陪玩看不到别人的客户（查不到 = 404）', async () => {
    (prisma.customer.findUnique as any).mockResolvedValue(null);
    await expect(
      service.customerProfileAnalytics('cust1', { role: 'COMPANION', studioId: 's1', companionId: 'OTHER' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});