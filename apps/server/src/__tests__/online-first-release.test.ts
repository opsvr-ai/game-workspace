import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlineFirstReleaseService } from '../orders/online-first-release.service';

/**
 * 「线上→线下流转」的单到点自动放给本店线下的扫描（老板 2026-10-01）。
 *
 * 这条链路一旦断，表现就是「说好 5 分钟后线下也能抢，结果线下一点声音都没有」。
 * 这里把「到点才放、只放一次、已被抢就不放」三件事钉死。
 */
function setup(candidates: any[], opts: { minutes?: number; updated?: number } = {}) {
  const minutes = opts.minutes ?? 5;
  const prisma = {
    systemConfig: {
      findMany: vi.fn().mockResolvedValue(
        opts.minutes === undefined
          ? []
          : [{ key: 'pool.online_first_release_minutes', value: minutes }],
      ),
      upsert: vi.fn(),
    },
    studioConfig: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), deleteMany: vi.fn() },
    order: {
      findMany: vi.fn().mockResolvedValue(candidates),
      updateMany: vi.fn().mockResolvedValue({ count: opts.updated ?? 1 }),
      findUnique: vi.fn(async ({ where }: any) => candidates.find((c) => c.id === where.id) || null),
    },
  };
  const orders = { broadcastReleasedToOffline: vi.fn().mockResolvedValue(undefined) };
  const svc = new OnlineFirstReleaseService(prisma as never, orders as never);
  return { svc, prisma, orders };
}

const now = Date.now();

describe('OnlineFirstReleaseService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('到点了就放给线下，并且只弹一次弹窗', async () => {
    const created = new Date(now - 6 * 60 * 1000);
    const { svc, prisma, orders } = setup([
      { id: 'o-1', studioId: 's-1', createdAt: created, customFields: {} },
    ]);

    await expect(svc.sweep()).resolves.toBe(1);

    // 只盯「线上→线下流转 + 还没人接 + 还没放过」的单
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.poolScope).toBe('ONLINE_FIRST');
    expect(where.status).toBe('PENDING');
    expect(where.companionId).toBeNull();
    expect(where.releasedToOfflineAt).toBeNull();

    // 写的是 createdAt + 5 分钟（不是 now）：对线下可见的时机跟改动前一模一样，不会因为扫描迟几十秒而晚开
    const written = prisma.order.updateMany.mock.calls[0][0].data.releasedToOfflineAt as Date;
    expect(written.getTime()).toBe(created.getTime() + 5 * 60 * 1000);

    expect(orders.broadcastReleasedToOffline).toHaveBeenCalledTimes(1);
    expect(orders.broadcastReleasedToOffline.mock.calls[0][0].id).toBe('o-1');
  });

  it('还没到 5 分钟的单不动', async () => {
    const { svc, prisma, orders } = setup([
      { id: 'o-2', studioId: 's-1', createdAt: new Date(now - 3 * 60 * 1000), customFields: {} },
    ]);

    await expect(svc.sweep()).resolves.toBe(0);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(orders.broadcastReleasedToOffline).not.toHaveBeenCalled();
  });

  it('中间被抢走 / 被客服处理了：不弹窗也不标记', async () => {
    const { svc, orders } = setup(
      [{ id: 'o-3', studioId: 's-1', createdAt: new Date(now - 9 * 60 * 1000), customFields: {} }],
      { updated: 0 },
    );

    await expect(svc.sweep()).resolves.toBe(0);
    expect(orders.broadcastReleasedToOffline).not.toHaveBeenCalled();
  });

  it('已经失效 / 已处理的单不重复弹', async () => {
    const { svc, orders } = setup([
      {
        id: 'o-4',
        studioId: 's-1',
        createdAt: new Date(now - 30 * 60 * 1000),
        customFields: { poolExpired: true },
      },
      {
        id: 'o-5',
        studioId: 's-1',
        createdAt: new Date(now - 30 * 60 * 1000),
        customFields: { poolHandled: true },
      },
    ]);

    await expect(svc.sweep()).resolves.toBe(0);
    expect(orders.broadcastReleasedToOffline).not.toHaveBeenCalled();
  });

  it('没配置时按 5 分钟算', async () => {
    const created = new Date(now - 4.5 * 60 * 1000);
    const { svc, prisma } = setup([
      { id: 'o-6', studioId: 's-2', createdAt: created, customFields: {} },
    ]);

    await expect(svc.sweep()).resolves.toBe(0);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });
});
