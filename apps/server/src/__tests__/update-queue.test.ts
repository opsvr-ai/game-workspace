// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockPrisma } from '../__mocks__/prisma.mock';
import type { AgentService as AgentServiceType } from '../agent/agent.service';

// 模块级别的 updateSlot / updateWaiters 是全局状态，每个用例都要拿一份干净的：
// 用 vi.resetModules() + 动态 import 重新求值模块。
async function freshService(): Promise<AgentServiceType> {
  vi.resetModules();
  const mod = await import('../agent/agent.service');
  return new mod.AgentService(createMockPrisma() as any);
}

// 更新时间点统一用假时钟控制，避免 Date.now() 同毫秒导致排队顺序不确定。
const T0 = new Date('2026-09-21T15:00:00Z').getTime();

describe('更新名额叫号（发布铺开速度）', () => {
  let service: AgentServiceType;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    service = await freshService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('名额被占住时排队的人拿不到名额（保持串行下载，不抢带宽）', () => {
    expect(service.acquireUpdateSlot('holder').granted).toBe(true);
    vi.setSystemTime(T0 + 30_000);
    const second = service.acquireUpdateSlot('waiter');
    expect(second.granted).toBe(false);
    expect(second.waitingFor).toBe('holder');
  });

  it('释放名额后立刻叫下一位，而不是让它等到下一次 30 分钟轮询', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    service.setUpdateNotifier(notify);

    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('waiter');

    expect(notify).not.toHaveBeenCalled(); // 名额还占着：不能叫号
    service.releaseUpdateSlot('holder');
    expect(notify).toHaveBeenCalledTimes(1); // 一释放就叫下一台
  });

  it('释放一个不是当前持有者的名额，不会误叫下一台', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    service.setUpdateNotifier(notify);

    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('waiter');

    service.releaseUpdateSlot('someone-else');
    expect(notify).not.toHaveBeenCalled();
    // 持有者还在下载，名额没被抢走
    expect(service.acquireUpdateSlot('waiter').granted).toBe(false);
  });

  it('按排队先后叫号：先来先得', () => {
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 60_000);
    service.acquireUpdateSlot('first');
    vi.setSystemTime(T0 + 120_000);
    service.acquireUpdateSlot('second');

    expect(service.takeNextUpdateWaiter()?.companionId).toBe('first');
    expect(service.takeNextUpdateWaiter()?.companionId).toBe('second');
    expect(service.takeNextUpdateWaiter()).toBeNull();
  });

  it('匿名机器（没登录、只按 IP 记账）不叫号：它收不到推送，只能自己轮询', () => {
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('anon:203.0.113.9');

    expect(service.takeNextUpdateWaiter()).toBeNull();
    // 但它仍然记在排队表里，不影响它自己再来问
    expect(service.getUpdateSlot().waiters).toBe(1);
  });

  it('被跳过（正在接单）放回队列时保留原来的排队时间，不会排到队尾', () => {
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 60_000);
    service.acquireUpdateSlot('busy-companion');
    vi.setSystemTime(T0 + 300_000);
    service.acquireUpdateSlot('idle-companion');

    const first = service.takeNextUpdateWaiter();
    expect(first?.companionId).toBe('busy-companion');
    service.requeueUpdateWaiter(first!);

    // 放回去之后仍然是它排在最前，不会被后来的人插队
    expect(service.takeNextUpdateWaiter()?.companionId).toBe('busy-companion');
  });

  it('排队很久的机器可以直接把名额接过去（防止老版本永远轮不到）', () => {
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    expect(service.acquireUpdateSlot('waiter').granted).toBe(false);

    // 等了 6 分钟（> WAIT_PRIORITY_MS 5 分钟）且持有者已下载 6 分钟（> HOLD_MIN_MS 3 分钟）
    vi.setSystemTime(T0 + 6 * 60_000);
    expect(service.acquireUpdateSlot('waiter').granted).toBe(true);
    expect(service.getUpdateSlot().companionId).toBe('waiter');
  });

  it('叫号时预约名额：被叫到的那台一来就能拿到，别人抢不走', () => {
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('other');
    service.releaseUpdateSlot('holder');

    // 服务端叫号时先把名额留给被叫到的那台：错峰那几秒里不会被别人抢走
    service.reserveUpdateSlot('other');
    vi.setSystemTime(T0 + 40_000);
    expect(service.acquireUpdateSlot('other').granted).toBe(true);
    expect(service.getUpdateSlot().companionId).toBe('other');

    // 真正开始下载后重新计时，别人还是得排队
    vi.setSystemTime(T0 + 60_000);
    expect(service.acquireUpdateSlot('third').granted).toBe(false);
  });

  it('预约的名额没人来领（客户端离线）3 分钟后放回，不堵着队列', async () => {
    service.reserveUpdateSlot('ghost');
    service.onModuleInit();
    try {
      vi.advanceTimersByTime(2 * 60_000);
      await Promise.resolve();
      expect(service.getUpdateSlot().companionId).toBe('ghost');

      vi.advanceTimersByTime(61_000); // 超过 RESERVE_TTL_MS 3 分钟
      await Promise.resolve();
      expect(service.getUpdateSlot().companionId).toBe('');
    } finally {
      service.onModuleDestroy();
    }
  });

  it('名额超时未释放由定时器兜底腾位（客户端下到一半断网/崩了）', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('waiter');
    service.setUpdateNotifier(notify);

    service.onModuleInit();
    try {
      vi.setSystemTime(T0 + 11 * 60_000); // 超过 UPDATE_SLOT_TIMEOUT 10 分钟
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
      expect(service.getUpdateSlot().companionId).toBe('');
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('名额空着却还有人在排队时，定时器每分钟继续叫号（链条不会停）', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    service.setUpdateNotifier(notify);

    service.acquireUpdateSlot('holder');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('waiter');

    service.releaseUpdateSlot('holder'); // 释放名额：叫一次
    expect(notify).toHaveBeenCalledTimes(1);

    // 被叫的那台如果没来拿名额（没连上/没响应），下一分钟继续叫，别让队列停住
    service.onModuleInit();
    try {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
      expect(notify).toHaveBeenCalledTimes(2);
    } finally {
      service.onModuleDestroy();
    }
  });
});

// ---------------------------------------------------------------------------
// P0-6（2026-10-06）：名额按店隔离。
// 以前 updateSlot / updateWaiters 是全网一份 —— 一家店在升级，其它店全得排队等它。
// 多工作室场景（直营店 + 租赁店 + 桥接工作室同库跑）下这是硬伤。
// ---------------------------------------------------------------------------
describe('更新名额按店隔离（多工作室）', () => {
  let service: AgentServiceType;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.resetModules();
    const mod = await import('../agent/agent.service');
    prisma = createMockPrisma();
    service = new mod.AgentService(prisma as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('一家店在下载，不影响另一家店的机器拿名额（以前要一起排队）', () => {
    expect(service.acquireUpdateSlot('a-machine', 'studio-A').granted).toBe(true);
    expect(service.acquireUpdateSlot('b-machine', 'studio-B').granted).toBe(true);

    // 同一家店内部仍然串行下载（不抢办公室那条带宽）
    const second = service.acquireUpdateSlot('a-machine-2', 'studio-A');
    expect(second.granted).toBe(false);
    expect(second.waitingFor).toBe('a-machine');
  });

  it('排队队列也按店分开：一家店的队列不会把别的店挤到后面', () => {
    service.acquireUpdateSlot('a-holder', 'studio-A');
    service.acquireUpdateSlot('b-holder', 'studio-B');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('a-waiter', 'studio-A');
    vi.setSystemTime(T0 + 60_000);
    service.acquireUpdateSlot('b-waiter', 'studio-B');

    expect(service.takeNextUpdateWaiter('studio-A')?.companionId).toBe('a-waiter');
    expect(service.takeNextUpdateWaiter('studio-A')).toBeNull();
    expect(service.takeNextUpdateWaiter('studio-B')?.companionId).toBe('b-waiter');
  });

  it('不带 scope 时仍然按全网排队先后叫号（老行为不变）', () => {
    service.acquireUpdateSlot('a-holder', 'studio-A');
    service.acquireUpdateSlot('b-holder', 'studio-B');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('b-waiter', 'studio-B');
    vi.setSystemTime(T0 + 60_000);
    service.acquireUpdateSlot('a-waiter', 'studio-A');

    expect(service.takeNextUpdateWaiter()?.companionId).toBe('b-waiter');
    expect(service.takeNextUpdateWaiter()?.companionId).toBe('a-waiter');
  });

  it('释放一家店的名额不会把另一家店正在下载的名额一起放掉', () => {
    service.acquireUpdateSlot('a-machine', 'studio-A');
    service.acquireUpdateSlot('b-machine', 'studio-B');

    service.releaseUpdateSlot('a-machine', 'studio-A');
    expect(service.acquireUpdateSlot('a-machine-2', 'studio-A').granted).toBe(true);
    expect(service.acquireUpdateSlot('b-machine-2', 'studio-B').granted).toBe(false);
    expect(service.getUpdateSlot('studio-B').companionId).toBe('b-machine');
  });

  it('getUpdateScopes 能看到每家店各自的名额占用与排队人数', () => {
    service.acquireUpdateSlot('a-machine', 'studio-A');
    service.acquireUpdateSlot('a-machine-2', 'studio-A');
    service.acquireUpdateSlot('b-machine', 'studio-B');

    const byScope = service.getUpdateScopes();
    const a = byScope.find((s) => s.scope === 'studio-A');
    const b = byScope.find((s) => s.scope === 'studio-B');
    expect(a).toMatchObject({ companionId: 'a-machine', waiters: 1 });
    expect(b).toMatchObject({ companionId: 'b-machine', waiters: 0 });
  });

  it('名额空着的店可以直接叫号，不被正在下载的店挡住', () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    service.setUpdateNotifier(notify);

    service.acquireUpdateSlot('a-machine', 'studio-A');
    service.acquireUpdateSlot('b-machine', 'studio-B');
    vi.setSystemTime(T0 + 30_000);
    service.acquireUpdateSlot('b-waiter', 'studio-B');

    expect(service.isUpdateScopeBusy('studio-B')).toBe(true);
    service.releaseUpdateSlot('b-machine', 'studio-B');
    expect(notify).toHaveBeenCalledTimes(1); // B 店空出来了：立刻叫它自己的下一位
    expect(service.acquireUpdateSlot('a-machine-2', 'studio-A').granted).toBe(false);
  });

  it('查库解析机器归属的店，并缓存（客户端每 5 分钟来问一次不能每次都打库）', async () => {
    prisma.companion.findUnique.mockResolvedValue({ studioId: 'studio-A' });
    expect(await service.resolveUpdateScope('comp-1')).toBe('studio-A');
    expect(await service.resolveUpdateScope('comp-1')).toBe('studio-A');
    expect(prisma.companion.findUnique).toHaveBeenCalledTimes(1);
  });

  it('未登录的新机器（anon:IP）不查库，落到全网共享的那个名额', async () => {
    expect(await service.resolveUpdateScope('anon:203.0.113.9')).toBe('');
    expect(prisma.companion.findUnique).not.toHaveBeenCalled();
  });

  it('归属查库失败时退回共享名额，不让一次查询失败把更新链路整个卡死', async () => {
    prisma.companion.findUnique.mockRejectedValue(new Error('db down'));
    expect(await service.resolveUpdateScope('comp-2')).toBe('');
  });
});
