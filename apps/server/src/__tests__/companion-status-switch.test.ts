import { describe, it, expect, beforeEach } from 'vitest';
import { switchCompanionStatus } from '../common/companion-status-switch';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「服务端改陪玩状态」这条统一入口的单测。
 *
 * 背景（老板 2026-10-07）：运营看板的「接单率 = 接单时长 ÷ 在线时长」和陪玩端
 * 「今日接单时长」都从 CompanionTimeLog 取数，可服务端改状态以前全是裸 update
 * ——只改 Companion.status、不写日志，于是日志里根本没有 mode=BUSY 的段，
 * 接单率恒显示 0%。这里锁住「改状态一定连带写日志」这条规则。
 */
describe('switchCompanionStatus', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.companion.update.mockResolvedValue({});
    prisma.companionTimeLog.update.mockResolvedValue({});
    prisma.companionTimeLog.create.mockResolvedValue({});
    prisma.companionTimeLog.findFirst.mockResolvedValue(null);
  });

  it('空闲 → 接单中：关掉上一段日志、开一段 BUSY、状态落库', async () => {
    const started = new Date(Date.now() - 120_000);
    prisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });
    prisma.companionTimeLog.findFirst.mockResolvedValue({ id: 'log-old', startedAt: started });

    const changed = await switchCompanionStatus(prisma as any, 'c1', 'BUSY');

    expect(changed).toBe(true);
    // 上一段（空闲）被关掉，且带上时长
    const closed = prisma.companionTimeLog.update.mock.calls[0][0];
    expect(closed.where).toEqual({ id: 'log-old' });
    expect(closed.data.durationSeconds).toBeGreaterThanOrEqual(119);
    // 新的一段是 BUSY —— 接单时长就是靠这条记的
    expect(prisma.companionTimeLog.create).toHaveBeenCalledWith({
      data: { companionId: 'c1', mode: 'BUSY', startedAt: expect.any(Date), endedAt: null, durationSeconds: 0 },
    });
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'BUSY' },
    });
  });

  it('状态没变 → 什么都不写（避免把计时/计费重置）', async () => {
    prisma.companion.findUnique.mockResolvedValue({ status: 'BUSY' });

    const changed = await switchCompanionStatus(prisma as any, 'c1', 'BUSY');

    expect(changed).toBe(false);
    expect(prisma.companionTimeLog.create).not.toHaveBeenCalled();
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('陪玩不存在 / 没传 ID → false，不炸', async () => {
    prisma.companion.findUnique.mockResolvedValue(null);
    expect(await switchCompanionStatus(prisma as any, 'nope', 'OFFLINE')).toBe(false);
    expect(await switchCompanionStatus(prisma as any, null, 'OFFLINE')).toBe(false);
  });

  it('接单中 → 空闲（结束服务那条路）：BUSY 段被封口，接上空闲段', async () => {
    const started = new Date(Date.now() - 300_000);
    prisma.companion.findUnique.mockResolvedValue({ status: 'BUSY' });
    prisma.companionTimeLog.findFirst.mockResolvedValue({ id: 'log-busy', startedAt: started });

    const changed = await switchCompanionStatus(prisma as any, 'c1', 'AVAILABLE');

    expect(changed).toBe(true);
    expect(prisma.companionTimeLog.update.mock.calls[0][0].where).toEqual({ id: 'log-busy' });
    expect(prisma.companionTimeLog.update.mock.calls[0][0].data.durationSeconds).toBeGreaterThanOrEqual(299);
    expect(prisma.companionTimeLog.create.mock.calls[0][0].data.mode).toBe('AVAILABLE');
  });
});
