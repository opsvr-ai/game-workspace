// craftsman-ignore: TS001
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 老板 2026-10-09：「客服端怎么不能采纳陪玩上传的战绩图？」
 *
 * 采纳 / 驳回这一颗按钮原来只给店长 / 老板（@Roles(ADMIN, OWNER)）。上传战绩图时那条实时提醒
 * 本来就发给「本店客服 + 店长 + 全站老板」（见 review-notice.test.ts），客服点开却什么都没有 ——
 * 提醒了等于白提醒。所以：
 *   ① 客服也能采纳 / 驳回（采纳照样给陪玩综合分加分）；
 *   ② 但只动得了**本店**的图 —— 跟「下载图片包」同一把锁（别家桥接店的 id 拿到手里也没用）；
 *   ③ 老板不受工作室限制。
 */

vi.mock('../common/studio-config', () => ({
  resolveConfigsRaw: vi.fn(async () => ({ 'excellence.battle_screenshot_bonus': 2 })),
}));

import { BattleScreenshotsService } from '../battle-screenshots/battle-screenshots.service';
import { ForbiddenException } from '@nestjs/common';

const ITEM = { id: 'b1', studioId: 's1', companionId: 'c1', status: 'PENDING' };

function setup(item: any = ITEM) {
  const prisma: any = {
    battleScreenshot: {
      findUnique: vi.fn().mockResolvedValue({ ...item }),
      update: vi.fn().mockResolvedValue({}),
    },
    companion: { update: vi.fn().mockResolvedValue({}) },
  };
  const svc = new BattleScreenshotsService(prisma);
  return { svc, prisma };
}

describe('战绩图采纳 / 驳回（老板 2026-10-09 起客服也能点）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('客服采纳本店的图：状态变 APPROVED，按配置给陪玩加综合分', async () => {
    const { svc, prisma } = setup();
    const out: any = await svc.review('b1', 'u-cs', 'approve', undefined as any, {
      role: 'CS',
      studioId: 's1',
    });

    expect(out.status).toBe('APPROVED');
    expect(out.bonus).toBe(2);
    expect(prisma.battleScreenshot.update).toHaveBeenCalledTimes(1);
    expect(prisma.companion.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { bonusScore: { increment: 2 } },
    });
  });

  it('驳回：不加分', async () => {
    const { svc, prisma } = setup();
    const out: any = await svc.review('b1', 'u-cs', 'reject', '图不清晰', {
      role: 'CS',
      studioId: 's1',
    });

    expect(out.status).toBe('REJECTED');
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('客服动别家工作室的图：拦下来（跟「下载图片包」同一把锁）', async () => {
    const { svc, prisma } = setup({ ...ITEM, studioId: 's2' });
    await expect(
      svc.review('b1', 'u-cs', 'approve', undefined as any, { role: 'CS', studioId: 's1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.battleScreenshot.update).not.toHaveBeenCalled();
    expect(prisma.companion.update).not.toHaveBeenCalled();
  });

  it('店长也拦别家的图，老板不受工作室限制', async () => {
    await expect(
      setup({ ...ITEM, studioId: 's2' }).svc.review('b1', 'u-admin', 'approve', undefined as any, {
        role: 'ADMIN',
        studioId: 's1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const boss = setup({ ...ITEM, studioId: 's2' });
    const out: any = await boss.svc.review('b1', 'u-owner', 'approve', undefined as any, {
      role: 'OWNER',
      studioId: 's1',
    });
    expect(out.status).toBe('APPROVED');
  });

  it('已处理过的记录不能再动（客服连点两次 / 两个人同时点）', async () => {
    const { svc } = setup({ ...ITEM, status: 'APPROVED' });
    await expect(
      svc.review('b1', 'u-cs', 'approve', undefined as any, { role: 'CS', studioId: 's1' }),
    ).rejects.toThrow('该记录已处理');
  });
});
