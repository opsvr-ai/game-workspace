// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderWorkflowService, VALID_TRANSITIONS } from '../orders/order-workflow.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 抢单主链路（P0-1 安全网里最要紧的一段）。
 *
 * 为什么单独写这一份：`orders.service.test.ts` 里那几个「grab」用例**证明不了抢单逻辑** ——
 * 它们把 workflowService 整个 mock 掉，然后断言「mock 抛错 → 我也抛错」，
 * 等于测了「grab 会不会转发」。而真正值钱的三条不变量，之前**一条都没测**：
 *
 *   1. **抢单是原子的**：一次 `updateMany` 里同时带上 `companionId: null` 与 `status: PENDING`，
 *      谁先把状态改掉谁赢，输的那个拿到 `count === 0` —— 绝不能改成「先读再写」。
 *   2. **扣了名额，抢不到必须退回**：老板 2026-10-04 定的口径是「抢单那一刻就扣名额」，
 *      于是「扣了但没抢到」这条路必须退回去，否则陪玩白掉一个名额、第二天要跟客服扯皮。
 *   3. **不该抢的单要拦在前头**：不是池子里的单 / 已被人抢 / 已超时 / 跨店没桥接 /
 *      自己发的单 / 名额用完 —— 每一条都要在**动数据之前**拦下。
 *
 * 这几条一旦被后续重构改坏，是直接掉单、掉名额、掉钱的，所以先把它们钉死。
 */

type Any = any;

function setup(opts: { bridged?: string[]; quota?: Any } = {}) {
  const prisma = createMockPrisma();
  const ws = {
    broadcastToBridgedStudios: vi.fn(),
    notifyUser: vi.fn(),
    refreshCompanionBlacklist: vi.fn(),
    pushOrder: vi.fn(),
  } as Any;
  const bridge = { getBridgedStudioIds: vi.fn().mockResolvedValue(opts.bridged ?? []) } as Any;
  const quota = {
    studioTypeOf: vi.fn().mockResolvedValue('DIRECT'),
    countsOrder: vi.fn().mockReturnValue(true),
    reserve: vi.fn().mockResolvedValue({ ok: true, tier: 'MIDDLE', dailyLimit: 10 }),
    refund: vi.fn().mockResolvedValue(undefined),
    ...(opts.quota || {}),
  } as Any;
  const service = new OrderWorkflowService(prisma as Any, ws, bridge, quota);
  return { service, prisma: prisma as MockPrisma & Any, ws, bridge, quota };
}

/** 一个「正常躺在池子里等人抢」的单。 */
function poolOrder(over: Any = {}) {
  return {
    id: 'o1',
    orderCode: 'A001',
    status: 'PENDING',
    dispatchType: 'POOL',
    companionId: null,
    studioId: 's1',
    customerId: 'cust1',
    csUserId: 'cs1',
    amount: 100,
    customFields: {},
    ...over,
  };
}

/** 把 happy path 需要的那几处库调用接上（绑了工作微信、没有历史撞单、抢到了）。 */
function wireHappyPath(prisma: Any, order: Any, opts: { companionStudioId?: string; companionUserId?: string } = {}) {
  const grabbed = { ...order, status: 'GRABBED', companionId: 'c1', companion: { user: { username: '小明' } } };
  prisma.order.findUnique.mockImplementation(async (args: Any) =>
    args?.where?.id === order.id ? (prisma.order.updateMany.mock.results.length ? grabbed : order) : null,
  );
  prisma.order.updateMany.mockResolvedValue({ count: 1 });
  prisma.companion.findUnique.mockImplementation(async (args: Any) =>
    args?.select?.userId ? { userId: opts.companionUserId ?? 'u-comp' } : { studioId: opts.companionStudioId ?? 's1' },
  );
  prisma.user.findUnique.mockResolvedValue({ role: 'CS' });
  prisma.workWechat.findUnique.mockResolvedValue({ wechatId: 'wx-1' });
  prisma.customer.findUnique.mockResolvedValue({ wechatId: 'cust-wx' });
  prisma.customer.findMany.mockResolvedValue([]);
  prisma.order.findMany.mockResolvedValue([]);
  prisma.order.update.mockResolvedValue(grabbed);
  return grabbed;
}

describe('抢单：原子性（谁先改掉状态谁赢）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('抢单必须是一次带条件的写：where 里同时夹住「还没人抢」和「还是待抢」，不能先读再写', async () => {
    const { service, prisma } = setup();
    const order = poolOrder();
    wireHappyPath(prisma, order);

    await service.grab('o1', 'c1');

    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    const args = prisma.order.updateMany.mock.calls[0][0];
    // 这两条就是防并发重复抢的全部依据，少一条就会出现「两个人同时抢到同一张单」
    expect(args.where).toMatchObject({ id: 'o1', companionId: null, status: 'PENDING' });
    expect(args.data).toMatchObject({ status: 'GRABBED', companionId: 'c1' });
    expect(args.data.grabbedAt).toBeInstanceOf(Date);
  });

  it('慢一步的人：updateMany 返回 0 → 明确告知「已被别人抢走」，且不再往下跑', async () => {
    const { service, prisma, ws } = setup();
    wireHappyPath(prisma, poolOrder());
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/已被其他陪玩抢先抢走/);
    expect(ws.broadcastToBridgedStudios).not.toHaveBeenCalled();
    expect(ws.notifyUser).not.toHaveBeenCalled();
  });

  it('成功抢到后：广播订单池变化 + 通知发单客服（老板要知道单被谁抢了）', async () => {
    const { service, prisma, ws } = setup();
    wireHappyPath(prisma, poolOrder());

    const out = await service.grab('o1', 'c1');

    expect(out.status).toBe('GRABBED');
    expect(ws.broadcastToBridgedStudios).toHaveBeenCalledWith('s1', 'order:pool_updated', expect.anything());
    expect(ws.notifyUser).toHaveBeenCalledWith('cs1', 'order:grabbed', expect.objectContaining({ orderId: 'o1' }));
  });

  it('陪玩绑了工作微信 → 抢单时自动挂到这张单上', async () => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, poolOrder());
    prisma.workWechat.findUnique.mockResolvedValue({ id: 'wx-row-1', wechatId: 'wx-1' });

    await service.grab('o1', 'c1');

    const bind = prisma.order.update.mock.calls.find((c: Any) => c[0]?.data?.customFields);
    expect(bind?.[0].data.customFields).toMatchObject({ workWechatId: 'wx-row-1', workWechatName: 'wx-1' });
  });

  it('自动挂微信失败不影响抢单结果（这条路径本来就是尽力而为）', async () => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, poolOrder());
    // 判重那一步（带 select）正常放行；真正「自动挂微信」那一步（不带 select）让它炸一下。
    prisma.workWechat.findUnique.mockImplementation(async (args: Any) =>
      args?.select ? { wechatId: 'wx-1' } : Promise.reject(new Error('库抖了一下')),
    );

    await expect(service.grab('o1', 'c1')).resolves.toMatchObject({ status: 'GRABBED' });
  });
});

describe('抢单：名额扣减与退回（老板 2026-10-04 口径）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('该占名额的单：先扣一个，再抢', async () => {
    const { service, prisma, quota } = setup();
    wireHappyPath(prisma, poolOrder());

    await service.grab('o1', 'c1');

    expect(quota.reserve).toHaveBeenCalledWith('c1', 1, expect.objectContaining({ refId: 'o1' }));
  });

  it('名额用完 → 拦在动数据之前（不能「先抢下来再发现没名额」）', async () => {
    const { service, prisma, quota } = setup({
      quota: { reserve: vi.fn().mockResolvedValue({ ok: false, tier: 'LOW', dailyLimit: 3 }) },
    });
    wireHappyPath(prisma, poolOrder());

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/名额用完了/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('扣了名额但没抢到（慢一步）→ 名额退回，不能让陪玩白掉一个', async () => {
    const { service, prisma, quota } = setup();
    wireHappyPath(prisma, poolOrder());
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.grab('o1', 'c1')).rejects.toThrow(ForbiddenException);

    expect(quota.reserve).toHaveBeenCalled();
    expect(quota.refund).toHaveBeenCalledWith('c1', 1, expect.objectContaining({ refId: 'o1' }));
  });

  it('不占名额的单（陪玩自己发的 / 线上俱乐部预约单）→ 从头到尾不碰名额台账', async () => {
    const { service, prisma, quota } = setup({ quota: { countsOrder: vi.fn().mockReturnValue(false) } });
    wireHappyPath(prisma, poolOrder());

    await service.grab('o1', 'c1');

    expect(quota.reserve).not.toHaveBeenCalled();
    expect(quota.refund).not.toHaveBeenCalled();
  });
});

describe('抢单：不该抢的单一律提前拦下', () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<{ name: string; order: Any; error: RegExp }> = [
    { name: '不是派单池的单（客服指定 / 广播之外的类型）', order: poolOrder({ dispatchType: 'ASSIGNED' }), error: /不可抢/ },
    { name: '已经被人抢走的单', order: poolOrder({ companionId: 'c-other' }), error: /不可抢/ },
    { name: '已超时的池子单（只有客服能处理）', order: poolOrder({ customFields: { poolExpired: true } }), error: /已超时/ },
    { name: '已完成 / 已取消的单（状态机不允许）', order: poolOrder({ status: 'DONE' }), error: /不允许从 DONE 转换/ },
  ];

  it.each(cases)('$name', async ({ order, error }) => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, order);
    prisma.order.findUnique.mockResolvedValue(order);

    await expect(service.grab('o1', 'c1')).rejects.toThrow(error);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('订单不存在 → NotFound（不是 403，别把「没这张单」说成「你没权限」）', async () => {
    const { service, prisma } = setup();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.grab('nope', 'c1')).rejects.toThrow(NotFoundException);
  });

  it('自己发布的单自己抢不了（发单人和抢单人同一个账号）', async () => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, poolOrder(), { companionUserId: 'cs1' });
    prisma.order.findUnique.mockResolvedValue(poolOrder());

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/不能抢自己发布的订单/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('别家店的单：没有桥接关系 → 抢不了', async () => {
    const { service, prisma } = setup({ bridged: [] });
    wireHappyPath(prisma, poolOrder(), { companionStudioId: 's2' });
    prisma.order.findUnique.mockResolvedValue(poolOrder());

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/无权抢其他工作室的订单/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('别家店的单：有桥接关系 → 放行（桥接工作室本来就要能跨店抢）', async () => {
    const { service, prisma } = setup({ bridged: ['s1'] });
    wireHappyPath(prisma, poolOrder(), { companionStudioId: 's2' });

    await expect(service.grab('o1', 'c1')).resolves.toMatchObject({ status: 'GRABBED' });
  });

  it('没绑工作微信 → 抢不了，并让他去「工作微信 → 陪玩工作微信」绑定', async () => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, poolOrder());
    prisma.workWechat.findUnique.mockResolvedValue(null);

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/还没绑定工作微信/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('同一个工作微信接过这个客户 → 拦下（换个新微信可以再接）', async () => {
    const { service, prisma } = setup();
    wireHappyPath(prisma, poolOrder());
    prisma.order.findMany.mockResolvedValue([{ companionId: 'c1', customFields: { workWechatName: 'wx-1' } }]);

    await expect(service.grab('o1', 'c1')).rejects.toThrow(/已经接过这个客户/);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('订单状态机：合法的下一步只有这些', () => {
  it('待抢 → 已抢 / 已认领 / 取消；已认领 → 回池 / 取消', () => {
    expect(VALID_TRANSITIONS.PENDING).toEqual(expect.arrayContaining(['GRABBED', 'CLAIMED', 'CANCELLED']));
    expect(VALID_TRANSITIONS.CLAIMED).toEqual(expect.arrayContaining(['PENDING', 'CANCELLED']));
  });

  it('已抢 → 进行中 / 直接完成 / 取消 / 回池（H2 允许重新放回池子）', () => {
    expect(VALID_TRANSITIONS.GRABBED).toEqual(expect.arrayContaining(['CONFIRMED', 'DONE', 'CANCELLED', 'PENDING']));
  });

  it('终态（完成 / 取消）没有任何下一步 —— 谁也别想再改回去', () => {
    expect(VALID_TRANSITIONS.DONE).toBeUndefined();
    expect(VALID_TRANSITIONS.CANCELLED).toBeUndefined();
  });
});
