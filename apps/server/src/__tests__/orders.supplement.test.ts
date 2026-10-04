// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from '../orders/orders.service';
import { createMockPrisma } from '../__mocks__/prisma.mock';

/**
 * 老板 2026-10-04 的补单口径：
 *  - 陪玩点「添加失败」→ 自动生成一条待审补单申请；
 *  - 管理端同意 → 他的抢单次数 +1（写台账），并排一次「客户后来通过没」的核查；
 *  - 核查到「其实通过了」→ 系统把这张单改成「已添加」，别把客户浪费掉。
 */
function setup() {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToStudio: vi.fn(),
    broadcastToBridgedStudios: vi.fn(),
    pushOrder: vi.fn(),
    notifyUser: vi.fn(),
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
    credit: vi.fn().mockResolvedValue(4),
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
  return { service, prisma, ws, bridgeService, quota };
}

const ADMIN = { id: 'admin-1', role: 'ADMIN', studioId: 's1' };

describe('补单申请：陪玩点「添加失败」自动建档', () => {
  beforeEach(() => vi.clearAllMocks());

  it('生成一条待审申请，带上失败原因和截图', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue({ status: 'GRABBED' });
    prisma.order.update.mockResolvedValue({
      id: 'o1',
      studioId: 's1',
      companionId: 'c1',
      customerId: 'cus1',
      customFields: { customerWechat: 'wx1' },
    });
    prisma.supplementRequest.findUnique.mockResolvedValue(null);
    prisma.supplementRequest.create.mockResolvedValue({ id: 'sr1' });

    await service.updateContact('o1', {
      contactStatus: 'not_accepted',
      failReason: 'not_added',
      screenshotUrl: 'https://img/1.png',
    });

    expect(prisma.supplementRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        companionId: 'c1',
        studioId: 's1',
        reason: 'not_added',
        evidenceUrl: 'https://img/1.png',
        status: 'PENDING',
      }),
    });
  });

  it('同一张单重复点失败只更新那一条，不会建两条', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue({ status: 'GRABBED' });
    prisma.order.update.mockResolvedValue({
      id: 'o1',
      studioId: 's1',
      companionId: 'c1',
      customerId: 'cus1',
      customFields: {},
    });
    prisma.supplementRequest.findUnique.mockResolvedValue({ id: 'sr1', status: 'PENDING' });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1' });

    await service.updateContact('o1', { contactStatus: 'not_accepted' });

    expect(prisma.supplementRequest.create).not.toHaveBeenCalled();
    expect(prisma.supplementRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1' } }),
    );
  });

  it('提交后实时通知本店客服 / 店长 + 全站老板（不再是只有 60 秒轮询的红点）', async () => {
    const { service, prisma, ws } = setup();
    prisma.order.findUnique.mockResolvedValue({ status: 'GRABBED' });
    prisma.order.update.mockResolvedValue({
      id: 'o1',
      orderCode: 'A100',
      studioId: 's1',
      companionId: 'c1',
      customerId: 'cus1',
      customFields: {},
    });
    prisma.supplementRequest.findUnique.mockResolvedValue(null);
    prisma.supplementRequest.create.mockResolvedValue({ id: 'sr1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'cs-1' }]);
    prisma.companion.findUnique.mockResolvedValue({ user: { displayName: '张三' } });

    await service.updateContact('o1', { contactStatus: 'not_accepted', failReason: 'not_added' });

    expect(ws.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'order:supplement_request',
      expect.objectContaining({ orderId: 'o1', companionName: '张三', reason: 'not_added' }),
    );
    expect(ws.notifyUser).toHaveBeenCalledWith('cs-1', 'order:supplement_request', expect.anything());
  });

  it('已经同意补过的单不再重复开（防反复要名额）', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue({ status: 'GRABBED' });
    prisma.order.update.mockResolvedValue({
      id: 'o1',
      studioId: 's1',
      companionId: 'c1',
      customerId: 'cus1',
      customFields: {},
    });
    prisma.supplementRequest.findUnique.mockResolvedValue({ id: 'sr1', status: 'APPROVED' });

    await service.updateContact('o1', { contactStatus: 'not_accepted' });

    expect(prisma.supplementRequest.create).not.toHaveBeenCalled();
    expect(prisma.supplementRequest.update).not.toHaveBeenCalled();
  });
});

describe('补单审核：同意 = 次数 +1 并排核查', () => {
  beforeEach(() => vi.clearAllMocks());

  it('同意后：名额 +1、状态 APPROVED、24 小时后要核查、通知陪玩', async () => {
    const { service, prisma, ws, quota } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'PENDING',
    });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1', status: 'APPROVED' });
    prisma.order.findUnique.mockResolvedValue({ customFields: {} });
    prisma.order.update.mockResolvedValue({ id: 'o1' });
    prisma.companion.findUnique.mockResolvedValue({ userId: 'u1' });

    await service.decideSupplement('sr1', 'APPROVE', '确实没加上', ADMIN);

    expect(quota.credit).toHaveBeenCalledWith(
      'c1',
      1,
      'SUPPLEMENT',
      expect.objectContaining({ refId: 'o1' }),
    );
    const data = prisma.supplementRequest.update.mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.reviewStatus).toBe('PENDING');
    expect(data.reviewDueAt).toBeInstanceOf(Date);
    expect(ws.notifyUser).toHaveBeenCalledWith('u1', 'order:supplement', expect.anything());
  });

  it('驳回：不返还名额，只留痕，但也要实时告诉陪玩本人', async () => {
    const { service, prisma, quota, ws } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'PENDING',
    });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1', status: 'REJECTED' });
    prisma.companion.findUnique.mockResolvedValue({ userId: 'u1' });

    await service.decideSupplement('sr1', 'REJECT', '截图看不出来', ADMIN);

    expect(quota.credit).not.toHaveBeenCalled();
    expect(prisma.supplementRequest.update.mock.calls[0][0].data.status).toBe('REJECTED');
    // 以前驳回连事件都不发，陪玩一直不知道自己被驳回了，只能对着失败状态干等
    expect(ws.notifyUser).toHaveBeenCalledWith(
      'u1',
      'order:supplement',
      expect.objectContaining({ approved: false, note: '截图看不出来' }),
    );
  });

  it('处理过的申请不能重复处理', async () => {
    const { service, prisma } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'APPROVED',
    });

    await expect(service.decideSupplement('sr1', 'APPROVE', undefined, ADMIN)).rejects.toThrow();
  });
});

describe('到期核查：客户后来通过了要改回系统', () => {
  beforeEach(() => vi.clearAllMocks());

  it('「客户其实通过了」→ 这张单改成已添加，客户归到这个陪玩名下', async () => {
    const { service, prisma } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'APPROVED',
    });
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', customerId: 'cus1', companionId: 'c1' });
    prisma.customer.findUnique.mockResolvedValue({ companionId: null });
    prisma.customer.update.mockResolvedValue({ id: 'cus1' });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1', reviewStatus: 'ACCEPTED' });

    await service.reviewSupplement('sr1', 'ACCEPTED', ADMIN);

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { contactStatus: 'added' },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cus1' },
      data: { companionId: 'c1' },
    });
    expect(prisma.supplementRequest.update.mock.calls[0][0].data.reviewStatus).toBe('ACCEPTED');
  });

  it('「仍未通过」第一次 → 记 STILL_NOT，并排 7 天后再提醒一次', async () => {
    const { service, prisma } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'APPROVED',
      reviewStatus: 'PENDING',
    });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1', reviewStatus: 'STILL_NOT' });

    const before = Date.now();
    await service.reviewSupplement('sr1', 'STILL_NOT', ADMIN);

    const data = prisma.supplementRequest.update.mock.calls[0][0].data;
    expect(data.reviewStatus).toBe('STILL_NOT');
    // 不是结案：7 天后还要再提醒一次
    const due = new Date(data.reviewDueAt).getTime() - before;
    expect(due).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60 * 1000);
    expect(due).toBeLessThan(7 * 24 * 3600 * 1000 + 60 * 1000);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('第二次「仍未通过」→ 结案 CLOSED，不再排提醒', async () => {
    const { service, prisma } = setup();
    prisma.supplementRequest.findUnique.mockResolvedValue({
      id: 'sr1',
      orderId: 'o1',
      companionId: 'c1',
      studioId: 's1',
      status: 'APPROVED',
      reviewStatus: 'STILL_NOT',
    });
    prisma.supplementRequest.update.mockResolvedValue({ id: 'sr1', reviewStatus: 'CLOSED' });

    await service.reviewSupplement('sr1', 'STILL_NOT', ADMIN);

    const data = prisma.supplementRequest.update.mock.calls[0][0].data;
    expect(data.reviewStatus).toBe('CLOSED');
    expect(data.reviewDueAt).toBeNull();
  });
});
