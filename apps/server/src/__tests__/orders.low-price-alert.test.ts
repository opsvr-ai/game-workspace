import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 单价低于底线提醒（老板 2026-10-04）：
 *   「机密续单/复购 40-60 是正常的，绝密续单/复购 60-80 是正常的」——
 *   首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60；陪玩没填模式就退回客服发单填的。
 * 只推提醒、不拦单；店长 / 客服走工作室广播，老板单独通知。
 */
function build(prisma: any) {
  const ws = {
    broadcastToStudio: vi.fn(),
    broadcastToBridgedStudios: vi.fn(),
    broadcastNewOrder: vi.fn().mockResolvedValue(0),
    broadcastUrgentToBridgedStudios: vi.fn().mockResolvedValue(0),
    broadcastToQualifiedIdleCompanions: vi.fn().mockResolvedValue(0),
    broadcastToBridgedIdleCompanionsByType: vi.fn().mockResolvedValue(0),
    notifyCompanion: vi.fn(),
    notifyUser: vi.fn(),
    pushOrder: vi.fn(),
    pushToCompanion: vi.fn(),
  };
  const service = new OrdersService(
    prisma,
    ws as any,
    { getBridgedStudioIds: vi.fn().mockResolvedValue([]) } as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn().mockResolvedValue(false), computeOne: vi.fn() } as any,
    { status: vi.fn(), ensure: vi.fn(), consume: vi.fn().mockResolvedValue(true), refund: vi.fn() } as any,
  );
  return { service, ws };
}

describe('OrdersService.alertBelowFloorPrice（单价低于底线）', () => {
  let prisma: MockPrisma;

  const order = (over: Record<string, any> = {}) => ({
    id: 'o1',
    studioId: 'studio-1',
    type: 'NEW',
    orderCode: '1001',
    customFields: { customerWechat: 'sj13771731714' },
    ...over,
  });
  const session = (over: Record<string, any> = {}) => ({
    id: 's1',
    seq: 1,
    companionId: 'A',
    coCompanionId: null,
    claimedMode: '机密',
    ...over,
  });
  const fire = (service: any, o: any, s: any, info: any) => service.alertBelowFloorPrice(o, s, info);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'A', user: { displayName: '徐泽宁' } },
      { id: 'B', user: { displayName: '王辰浩' } },
    ]);
    (prisma.user.findMany as any).mockResolvedValue([{ id: 'owner-1' }]);
  });

  it('首单 机密 35（等于底线）→ 不提醒', async () => {
    const { service, ws } = build(prisma);
    await fire(service, order(), session(), { claimedMode: '机密', claimedPrice: 35, duration: 1 });
    expect(ws.broadcastToStudio).not.toHaveBeenCalled();
  });

  it('续单（同一张首单的第 2 段）机密 35 → 提醒，写清是续单/复购、底线 40', async () => {
    const { service, ws } = build(prisma);
    await fire(service, order(), session({ seq: 2 }), { claimedMode: '机密', claimedPrice: 35, duration: 1 });
    expect(ws.broadcastToStudio).toHaveBeenCalledTimes(1);
    const payload = (ws.broadcastToStudio as any).mock.calls[0][2];
    expect(payload.reason).toContain('机密续单 / 复购（底线 40）');
    expect(payload.companionName).toBe('徐泽宁');
    // 老板没有工作室，单独通知
    expect(ws.notifyUser).toHaveBeenCalledWith('owner-1', 'review:alert', payload);
  });

  it('复购双陪：claimedMode 空、只有副陪 1 小时 35 → 退回客服填的机密，按 40 判也提醒', async () => {
    const { service, ws } = build(prisma);
    await fire(
      service,
      order({ type: 'REPURCHASE', customFields: { deltaMission: '机密', customerWechat: 'sj13771731714' } }),
      session({ claimedMode: null, coCompanionId: 'B', coAmount: 35 }),
      { claimedMode: null, claimedPrice: null, coAmount: 35, duration: 1 },
    );
    expect(ws.broadcastToStudio).toHaveBeenCalledTimes(1);
    const payload = (ws.broadcastToStudio as any).mock.calls[0][2];
    expect(payload.reason).toContain('机密续单 / 复购（底线 40）');
    expect(payload.reason).toContain('副陪单价 35');
    expect(payload.companionName).toBe('徐泽宁 + 王辰浩');
  });

  it('绝密续单 60（等于续单底线）→ 不提醒；59 → 提醒', async () => {
    const { service, ws } = build(prisma);
    const sess = session({ seq: 2, claimedMode: '绝密' });
    await fire(service, order(), sess, { claimedMode: '绝密', claimedPrice: 60, duration: 1 });
    expect(ws.broadcastToStudio).not.toHaveBeenCalled();
    await fire(service, order(), sess, { claimedMode: '绝密', claimedPrice: 59, duration: 1 });
    expect(ws.broadcastToStudio).toHaveBeenCalledTimes(1);
    expect((ws.broadcastToStudio as any).mock.calls[0][2].reason).toContain('绝密续单 / 复购（底线 60）');
  });

  it('首单 绝密 45（等于底线）→ 不提醒', async () => {
    const { service, ws } = build(prisma);
    await fire(service, order(), session({ claimedMode: '绝密' }), { claimedMode: '绝密', claimedPrice: 45, duration: 1 });
    expect(ws.broadcastToStudio).not.toHaveBeenCalled();
  });
});
