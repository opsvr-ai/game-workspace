// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi } from 'vitest';
import { OrderWorkflowService, VALID_TRANSITIONS } from '../orders/order-workflow.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';
import { OrderStatus } from '@chunlv/shared';

/**
 * 老板 2026-10-08 全链路复查：「存单」不该把单子弄成死状态。
 *
 * 客户先把钱存进来、这次还没打 → 客户详情页点「存单」→ 订单被写成 status = DEPOSITED。
 * 但这个状态**既不在共享枚举里、也不在状态机里**，于是后来想「完成订单」/「取消」时
 * validateTransition 一律抛「不允许从 DEPOSITED 转换到 DONE」—— 单子卡死，也看不出是什么状态。
 */
function setup() {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToBridgedStudios: vi.fn(),
    refreshCompanionBlacklist: vi.fn().mockResolvedValue(undefined),
    pushOrder: vi.fn(),
  };
  const bridge = { getBridgedStudioIds: vi.fn().mockResolvedValue([]), getVisibleStudioIds: vi.fn().mockResolvedValue(['s1']) };
  const service = new OrderWorkflowService(prisma as any, ws as any, bridge as any, {} as any);
  return { service, prisma };
}

describe('存单（DEPOSITED）不是死状态', () => {
  it('DEPOSITED 进了共享枚举，也进了状态机（能接着打 / 完成 / 取消）', () => {
    expect(OrderStatus.DEPOSITED).toBe('DEPOSITED');
    expect(VALID_TRANSITIONS.DEPOSITED).toEqual(expect.arrayContaining(['CONFIRMED', 'DONE', 'CANCELLED']));
    expect(VALID_TRANSITIONS.DEPOSITED).not.toContain('PENDING');
  });

  it('存单过的单能正常「完成订单」（以前会抛「不允许从 DEPOSITED 转换到 DONE」）', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'DEPOSITED',
      studioId: 's1',
      companionId: null,
      amount: 100,
      customFields: {},
    });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    const updated = await service.complete('o1', undefined, 's1', undefined, 'ADMIN');
    expect(updated).toBeTruthy();
    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DONE' }),
    }));
  });

  it('但存单不能退回「待派单」—— 别把状态机放开得太随意', () => {
    const { service } = setup();
    expect(() => service.validateTransition({ id: 'o1', status: 'DEPOSITED' }, 'PENDING')).toThrow(
      /不允许从 DEPOSITED/
    );
  });
});
