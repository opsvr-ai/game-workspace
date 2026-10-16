// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「进游戏对接」的口径（老板 2026-10-17）：
 *
 *   老板：「进去之后客户不喜欢怎么办？也添加成功？」
 *
 * 所以这一步**只办一件事**：把陪玩切成「接单中」—— 空闲黑名单里挂着三角洲
 * （AVAILABLE → DeltaForceClient-Win64-Shipping），不切他开游戏就被看门狗杀掉、进不去房间。
 * **绝不写 contactStatus='added'**：客户同意加微信了由他点「添加成功」（那时候客户才进他的
 * 「客户管理」、才归他名下），客户不喜欢由他点「添加失败」，跟别的单一个流程。
 */
function setup() {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToStudio: vi.fn(),
    broadcastToBridgedStudios: vi.fn(),
    pushOrder: vi.fn(),
    notifyUser: vi.fn(),
    refreshCompanionBlacklist: vi.fn().mockResolvedValue(undefined),
  };
  const bridgeService = {
    getBridgedStudioIds: vi.fn().mockResolvedValue([]),
    getVisibleStudioIds: vi.fn().mockResolvedValue(['s1']),
  };
  const quota = {
    status: vi.fn(),
    ensure: vi.fn(),
    consume: vi.fn(),
    reserve: vi.fn(),
    refund: vi.fn(),
    credit: vi.fn(),
  };
  const service = new OrdersService(
    prisma as any,
    ws as any,
    bridgeService as any,
    { grab: vi.fn(), confirm: vi.fn(), complete: vi.fn(), cancel: vi.fn() } as any,
    { assign: vi.fn(), acceptAssignment: vi.fn(), declineAssignment: vi.fn(), quickGrab: vi.fn() } as any,
    { isExcellent: vi.fn(), computeOne: vi.fn() } as any,
    quota as any,
  );
  return { service, prisma, ws };
}

const COMPANION = { id: 'u-c1', role: 'COMPANION', companionId: 'c1', studioId: 's1' };

const ROOM_ORDER = {
  id: 'o1',
  status: 'GRABBED',
  studioId: 's1',
  companionId: 'c1',
  customerId: 'cus1',
  customFields: { customerRoomCode: 'ABC123' },
  customer: { id: 'cus1', companionId: null },
};

function prime(prisma: any, order: any = ROOM_ORDER) {
  prisma.order.findUnique.mockResolvedValue(order);
  prisma.order.update.mockResolvedValue({
    ...order,
    customFields: { ...order.customFields, roomJoinedAt: '2026-10-17T00:00:00.000Z' },
  });
  // switchCompanionStatus：先读当前状态（空闲 → 接单中）
  prisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
  prisma.companionTimeLog.findFirst.mockResolvedValue(null);
  prisma.companionTimeLog.create.mockResolvedValue({ id: 'tl1' });
  prisma.companion.update.mockResolvedValue({ id: 'c1', status: 'BUSY' });
}

describe('进游戏对接：只切「接单中」，不算「添加成功」', () => {
  beforeEach(() => vi.clearAllMocks());

  it('不写 contactStatus —— 客户不会在还没见着面时就算「添加成功」', async () => {
    const { service, prisma } = setup();
    prime(prisma);

    await service.joinRoom('o1', COMPANION);

    const data = prisma.order.update.mock.calls[0][0].data;
    expect(data.contactStatus).toBeUndefined();
    expect(data.customFields.roomJoinedAt).toBeTruthy();
    // 房间码等原有字段不能被这次写入抹掉
    expect(data.customFields.customerRoomCode).toBe('ABC123');
  });

  it('把陪玩切成「接单中」—— 不切他开游戏会被看门狗杀掉，进不去房间', async () => {
    const { service, prisma, ws } = setup();
    prime(prisma);

    await service.joinRoom('o1', COMPANION);

    expect(prisma.companion.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'BUSY' } });
    expect(ws.refreshCompanionBlacklist).toHaveBeenCalledWith('c1');
  });

  it('客户归属也不在这一步做 —— 客户不喜欢的话不该挂到他名下', async () => {
    const { service, prisma } = setup();
    prime(prisma);

    await service.joinRoom('o1', COMPANION);

    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('重复点也安全：再点一次只刷新 roomJoinedAt，还是不动 contactStatus', async () => {
    const { service, prisma } = setup();
    prime(prisma, { ...ROOM_ORDER, customFields: { customerRoomCode: 'ABC123', roomJoinedAt: '2026-10-16T00:00:00.000Z' } });

    await service.joinRoom('o1', COMPANION);

    const data = prisma.order.update.mock.calls[0][0].data;
    expect(data.contactStatus).toBeUndefined();
    expect(data.customFields.roomJoinedAt).toBeTruthy();
  });

  it('没填房间码的单：让他直接用「添加成功」，别走这条路', async () => {
    const { service, prisma } = setup();
    prime(prisma, { ...ROOM_ORDER, customFields: {} });

    await expect(service.joinRoom('o1', COMPANION)).rejects.toThrow(/房间码/);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('不是自己的单：拦掉', async () => {
    const { service, prisma } = setup();
    prime(prisma);

    await expect(service.joinRoom('o1', { ...COMPANION, companionId: 'other' })).rejects.toThrow(/不是你的订单/);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
