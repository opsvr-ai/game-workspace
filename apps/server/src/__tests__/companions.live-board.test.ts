import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompanionsService } from '../companions/companions.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 实时看板（老板 2026-10-03：「几十个小人按顺序排列…显示状态…谁在跟谁打什么、
 * 打了多久、目前多少业绩」）。这里锁住最容易错、也最不能错的三件事：
 *  1. 今日业绩必须走 companionOrderRevenue 统一口径（主陪扣搭档与分成、搭档拿 coAmount），
 *     看板里不许另起一套算法 —— 否则跟结算/报账对不上；
 *  2. 排序：接单中 → 娱乐中 → 空闲 → 离线（管理端一眼扫过去要稳）；
 *  3. 打单中的人要带齐「跟谁打、打什么、多久、我拿多少」。
 */
function buildService(prisma: any) {
  return new CompanionsService(
    prisma,
    { getRanking: vi.fn(), getWallet: vi.fn(), checkEntertainmentBlocked: vi.fn() } as any,
    { ensureAttendance: vi.fn(), finalizeAttendance: vi.fn(), getAttendance: vi.fn() } as any,
    { listWorkWechats: vi.fn(), addWorkWechat: vi.fn(), bindWechat: vi.fn(), unbindWechat: vi.fn() } as any,
    { computeForCompanions: vi.fn(), computeOne: vi.fn(), get: vi.fn() } as any,
    { getBridgedStudioIds: vi.fn() } as any,
    { resignEmployee: vi.fn() } as any,
  );
}

function bucketOf(r: any): string {
  // 与前端一致：有活跃会话就算「打单中」，客户端掉线也留在这组（格子上会标「已掉线」）。
  if (r.serving) return 'serving';
  if (!r.online) return 'offline';
  if (r.status === 'ENTERTAINMENT') return 'entertainment';
  if (r.status === 'AVAILABLE') return 'available';
  return 'other';
}

describe('CompanionsService.liveBoard（实时看板）', () => {
  let prisma: MockPrisma;
  let service: CompanionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = buildService(prisma);
  });

  it('今日业绩走统一口径：主陪扣搭档与分成、搭档拿 coAmount；排序与统计正确', async () => {
    const startedAt = new Date(Date.now() - 3600 * 1000);
    const pc = (mode: string, hbMsAgo = 0) => ({ lastHeartbeat: new Date(Date.now() - hbMsAgo), currentMode: mode });
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'A', status: 'BUSY', user: { id: 'uA', username: 'a', displayName: '王昊', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: pc('BUSY') },
      { id: 'B', status: 'BUSY', user: { id: 'uB', username: 'b', displayName: '王甲振', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: pc('BUSY') },
      { id: 'C', status: 'ENTERTAINMENT', user: { id: 'uC', username: 'c', displayName: '张凯', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: pc('ENTERTAINMENT') },
      { id: 'D', status: 'AVAILABLE', user: { id: 'uD', username: 'd', displayName: '李四', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: pc('AVAILABLE') },
      { id: 'E', status: 'AVAILABLE', user: { id: 'uE', username: 'e', displayName: '王五', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: pc('AVAILABLE', 3600 * 1000) },
    ]);
    (prisma.orderSession.findMany as any).mockResolvedValue([
      {
        id: 'sess1', companionId: 'A', coCompanionId: 'B', startedAt, pausedAt: null, totalPausedSec: 0,
        duration: 1, amount: 100, coAmount: 40,
        parentOrder: { id: 'o1', orderCode: '392', gameName: '三角洲行动', customFields: {}, customer: { customerCode: 'C0001' }, studio: { name: '蠢驴电竞' } },
      },
    ]);
    (prisma.order.findMany as any).mockResolvedValue([
      { companionId: 'A', coCompanionId: 'B', amount: 100, coAmount: 40, customFields: { splits: [{ companionId: 'C', amount: 10 }] } },
    ]);
    (prisma.companionTimeLog.findMany as any).mockResolvedValue([{ companionId: 'A', startedAt, endedAt: null }]);

    const board: any = await service.liveBoard({ role: 'OWNER', studioId: null });
    const byId = new Map<string, any>(board.rows.map((r: any) => [r.companionId, r] as [string, any]));

    // 今日业绩：A 主陪 = 100 - 40(搭档) - 10(分给别人) = 50；B 搭档 = coAmount 40。
    expect(byId.get('A').todayRevenue).toBe(50);
    expect(byId.get('A').todayOrders).toBe(1);
    expect(byId.get('B').todayRevenue).toBe(40);
    // C 没出现在订单的主陪/搭档里（只是被分成的那个人），看板不给他算今日业绩。
    expect(byId.get('C').todayRevenue).toBe(0);

    // 打单信息：跟谁、打什么、多久、我拿多少。
    expect(byId.get('A').serving.role).toBe('MAIN');
    expect(byId.get('A').serving.partnerName).toBe('王甲振');
    expect(byId.get('A').serving.gameName).toBe('三角洲行动');
    expect(byId.get('A').serving.orderCode).toBe('392');
    expect(byId.get('A').serving.myAmount).toBe(100);
    expect(byId.get('B').serving.role).toBe('CO');
    expect(byId.get('B').serving.myAmount).toBe(40);
    expect(byId.get('A').todayMinutes).toBeGreaterThanOrEqual(59);

    // 排序：接单中 → 娱乐中 → 空闲 → 离线。
    expect(board.rows.map(bucketOf)).toEqual(['serving', 'serving', 'entertainment', 'available', 'offline']);
    // 统计。
    expect(board.counts).toEqual({ serving: 2, entertainment: 1, available: 1, resting: 0, offline: 1 });
  });

  it('客户端掉线但订单还在跑：仍算「打单中」，不藏进离线（前端会标「已掉线」）', async () => {
    const startedAt = new Date(Date.now() - 600 * 1000);
    (prisma.companion.findMany as any).mockResolvedValue([
      { id: 'G', status: 'BUSY', user: { id: 'uG', username: 'g', displayName: '王甲振', avatar: null }, studio: { id: 's1', name: '蠢驴电竞', type: 'DIRECT' }, pc: { lastHeartbeat: new Date(Date.now() - 3600 * 1000), currentMode: 'BUSY' } },
    ]);
    (prisma.orderSession.findMany as any).mockResolvedValue([
      {
        id: 'sess9', companionId: 'G', coCompanionId: null, startedAt, pausedAt: null, totalPausedSec: 0,
        duration: 1, amount: 60, coAmount: null,
        parentOrder: { id: 'o9', orderCode: '400', gameName: '英雄联盟', customFields: {}, customer: { customerCode: 'C0009' }, studio: { name: '蠢驴电竞' } },
      },
    ]);
    (prisma.order.findMany as any).mockResolvedValue([]);
    (prisma.companionTimeLog.findMany as any).mockResolvedValue([]);

    const board: any = await service.liveBoard({ role: 'OWNER', studioId: null });
    expect(board.rows[0].online).toBe(false);
    expect(board.rows[0].serving.orderCode).toBe('400');
    expect(bucketOf(board.rows[0])).toBe('serving');
    expect(board.counts.serving).toBe(1);
    expect(board.counts.offline).toBe(0);
  });
});
