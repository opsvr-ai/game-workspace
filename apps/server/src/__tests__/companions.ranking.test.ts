import { describe, it, expect, vi } from 'vitest';
import { CompanionRevenueService } from '../companions/companion-revenue.service';

/**
 * 陪玩端「排行榜」的取值范围回归（老板 2026-10-04）。
 *
 * 老板原话：「『全站老板』（没挂具体工作室的 OWNER，比如 hanlei）去调陪玩端那个『排行榜』接口会报 500
 * —— 陪玩自己用是正常的，所以一直没被发现。」
 * 根因：老代码无条件拼 `studioId: { in: [studioId, ...bridged] }`，studioId 为 null 时变成 `in: [null]`，
 * Prisma 判非法参数直接抛错。这里把三种身份的取值都锁住：
 *   · 全站老板 → 看全站（不加工作室过滤）；
 *   · 非 OWNER 又没挂店 → 给空，绝不放全站出去；
 *   · 挂了店 → 只看「本店 + 桥接店」（口径不变）。
 */
function setup(companions: any[], bridged: string[] = []) {
  const prisma = {
    companion: { findMany: vi.fn(() => Promise.resolve(companions)) },
    order: { groupBy: vi.fn(() => Promise.resolve([])) },
  };
  const bridge = { getBridgedStudioIds: vi.fn(() => Promise.resolve(bridged)) };
  const svc = new CompanionRevenueService(prisma as never, bridge as never);
  return { svc, prisma, bridge };
}

describe('陪玩端排行榜：全站老板不再 500', () => {
  it('全站老板（studioId=null）：不按工作室过滤，看全站', async () => {
    const { svc, prisma, bridge } = setup([
      { id: 'c1', user: { username: 'a', displayName: '甲' } },
      { id: 'c2', user: { username: 'b', displayName: '乙' } },
    ]);

    const rows = await svc.getRanking(null, 'revenue', true);

    expect(prisma.companion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(bridge.getBridgedStudioIds).not.toHaveBeenCalled();
    expect(rows.map((r: any) => r.companionId)).toEqual(['c1', 'c2']);
  });

  it('非 OWNER 又没挂工作室：返回空，且根本不查库（不能把全站漏出去）', async () => {
    const { svc, prisma } = setup([{ id: 'c1', user: { username: 'a' } }]);

    const rows = await svc.getRanking(null, 'revenue', false);

    expect(rows).toEqual([]);
    expect(prisma.companion.findMany).not.toHaveBeenCalled();
  });

  it('挂了店的账号：只看「本店 + 桥接店」（口径不变）', async () => {
    const { svc, prisma } = setup([{ id: 'c1', user: { username: 'a' } }], ['studio-2']);

    await svc.getRanking('studio-1', 'revenue', false);

    expect(prisma.companion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studioId: { in: ['studio-1', 'studio-2'] } } }),
    );
  });
});
