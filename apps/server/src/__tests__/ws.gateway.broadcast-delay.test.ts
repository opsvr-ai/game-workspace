import { describe, it, expect, vi, afterEach } from 'vitest';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 老板 2026-10-18：「刚发单陪玩端就能收到弹窗？之前定的上等马/中等马/下等马延迟呢？」
 *
 * 这个测试钉住：广播新单的 `order:urgent` 必须按段位延迟发：
 * 上等马 immediate、中等马 middle、下等马 low；延迟到点还要确认订单没被抢。
 */
describe('WsGateway.broadcastNewOrder 段位延迟', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup() {
    const tiers: Record<string, string> = {
      'c-top': 'TOP',
      'c-middle': 'MIDDLE',
      'c-low': 'LOW',
    };
    const companions = Object.keys(tiers).map((id) => ({ id, status: 'AVAILABLE', user: { username: id } }));
    const emitted: Array<{ room: string; event: string; data: any }> = [];
    const prisma = {
      companion: { findMany: vi.fn().mockResolvedValue(companions) },
      systemConfig: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'pool.priority_delay_seconds', value: 0 },
          { key: 'pool.middle_delay_seconds', value: 60 },
          { key: 'pool.low_delay_seconds', value: 120 },
        ]),
      },
      studioConfig: { findMany: vi.fn().mockResolvedValue([]) },
      order: {
        findUnique: vi.fn().mockResolvedValue({ status: 'PENDING', companionId: null, claimedCsUserId: null }),
      },
    };
    const excellence = {
      computeOne: vi.fn((companionId: string) => Promise.resolve({ tier: tiers[companionId] || 'MIDDLE' })),
    };
    const gw = new WsGateway(null as never, prisma as never, null as never, null as never, excellence as never, null as never, null as never);
    (gw as unknown as { server: unknown }).server = {
      to: (room: string) => ({ emit: (event: string, data: unknown) => emitted.push({ room, event, data }) }),
    };
    return { gw, prisma, emitted };
  }

  it('上等马立即弹；中等马 60 秒、下等马 120 秒后才弹', async () => {
    vi.useFakeTimers();
    const { gw, emitted } = setup();

    await gw.broadcastNewOrder('studio-1', { id: 'order-1', orderCode: 'X-DELAY' });

    // 立刻只有上等马
    expect(emitted.map((e) => e.room)).toEqual(['companion:c-top']);
    expect(emitted.every((e) => e.event === 'order:urgent')).toBe(true);

    // 60 秒：中等马
    await vi.advanceTimersByTimeAsync(60_000);
    expect(emitted.map((e) => e.room)).toEqual(['companion:c-top', 'companion:c-middle']);

    // 再 60 秒：下等马
    await vi.advanceTimersByTimeAsync(60_000);
    expect(emitted.map((e) => e.room)).toEqual(['companion:c-top', 'companion:c-middle', 'companion:c-low']);
  });

  it('延迟到点前订单被抢走 —— 不再弹给后面的人', async () => {
    vi.useFakeTimers();
    const { gw, prisma, emitted } = setup();
    prisma.order.findUnique.mockResolvedValue({ status: 'GRABBED', companionId: 'someone', claimedCsUserId: null });

    await gw.broadcastNewOrder('studio-1', { id: 'order-2', orderCode: 'X-TAKEN' });
    expect(emitted.map((e) => e.room)).toEqual(['companion:c-top']);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(emitted.map((e) => e.room)).toEqual(['companion:c-top']);
  });
});
