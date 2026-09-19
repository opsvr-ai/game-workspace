import { describe, it, expect, beforeEach } from 'vitest';
import { releaseCompanionIfIdle } from '../common/companion-presence';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

/**
 * 「结束服务后陪玩立刻变回空闲」这条规则的单测。
 *
 * 背景：结束服务只把 orderSession 标成 DONE，陪玩状态以前要等 60 秒的兜底扫描才变回空闲，
 * 这 1 分钟里急单/广播不会推给他。这里锁住新逻辑的四个分支。
 */
describe('releaseCompanionIfIdle', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('没有别的进行中会话，且当前是接单中 → 放回空闲', async () => {
    prisma.orderSession.findFirst.mockResolvedValue(null);
    prisma.companion.findUnique.mockResolvedValue({ status: 'BUSY' });
    prisma.companion.update.mockResolvedValue({ id: 'c1', status: 'AVAILABLE' });

    const released = await releaseCompanionIfIdle(prisma as any, 'c1', 's1');

    expect(released).toBe(true);
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'AVAILABLE' },
    });
  });

  it('还有别的进行中会话（副陪同时在服务）→ 保持接单中', async () => {
    prisma.orderSession.findFirst.mockResolvedValue({ id: 's2' });

    const released = await releaseCompanionIfIdle(prisma as any, 'c1', 's1');

    expect(released).toBe(false);
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('当前不是接单中（娱乐中/休息中）→ 不覆盖他的状态', async () => {
    prisma.orderSession.findFirst.mockResolvedValue(null);
    prisma.companion.findUnique.mockResolvedValue({ status: 'ENTERTAINMENT' });

    const released = await releaseCompanionIfIdle(prisma as any, 'c1', 's1');

    expect(released).toBe(false);
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('没有陪玩 ID → 什么都不做', async () => {
    const released = await releaseCompanionIfIdle(prisma as any, null, 's1');

    expect(released).toBe(false);
    expect(prisma.orderSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('排除自己这条会话，且查询条件覆盖主陪与副陪两种身份', async () => {
    prisma.orderSession.findFirst.mockResolvedValue(null);
    prisma.companion.findUnique.mockResolvedValue({ status: 'BUSY' });
    prisma.companion.update.mockResolvedValue({});

    await releaseCompanionIfIdle(prisma as any, 'c1', 's1');

    const where = prisma.orderSession.findFirst.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 's1' });
    expect(where.status).toBe('ACTIVE');
    expect(where.startedAt).toEqual({ not: null });
    expect(where.OR).toEqual([{ companionId: 'c1' }, { coCompanionId: 'c1' }]);
  });
});