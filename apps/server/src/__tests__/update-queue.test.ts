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
