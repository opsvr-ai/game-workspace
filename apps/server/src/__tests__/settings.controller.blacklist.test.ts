import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsController } from '../auth/settings.controller';

/**
 * 杀进程开关「一拨就生效」的回归测试（2026-09-24 去掉全站总闸后更新）。
 *
 * 现在**只有一道闸**：店长自己拨的「本店黑名单是否生效」（`blacklist.enabled`）。
 * 老板 2026-09-24 明确要求去掉以前那道全站总开关 `blacklist.auto_kill`（「不需要总闸，
 * 只需要店长自己定自己的俱乐部或者工作室是否生效」），所以：
 *  - 店长拨本店开关 / 「恢复默认」把本店开关恢复 → 当场重推本店名单；
 *  - 老板拨这一项写的是**全站默认值**（各店没自己拨过时用它）→ 当场重推所有店。
 *
 * 客户端只在收到推送时才更新本地的杀进程名单，所以服务端**改完开关必须当场重推**：
 * 漏推的表现就是开关在界面上拨了、陪玩电脑上没反应，得等下一次状态变化才生效。
 */
function setup(companions: Array<{ id: string; studioId: string }> = [{ id: 'c1', studioId: 's1' }]) {
  const prisma = {
    systemConfig: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    studioConfig: {
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    companion: { findMany: vi.fn().mockResolvedValue(companions) },
  };
  const ws = { invalidateBlacklistSwitchCache: vi.fn(), pushCurrentBlacklist: vi.fn() };
  const controller = new SettingsController(prisma as never, null as never, ws as never);
  return { controller, prisma, ws };
}

describe('杀进程开关：改完当场重推名单', () => {
  beforeEach(() => vi.clearAllMocks());

  it('店长拨本店开关 → 清缓存 + 只推本店', async () => {
    const { controller, prisma, ws } = setup();

    const res: any = await controller.updateConfig(
      { 'blacklist.enabled': true },
      { user: { role: 'ADMIN', studioId: 's1' } },
    );

    expect(res.data.scope).toBe('studio');
    expect(res.data.saved).toContain('blacklist.enabled');
    expect(ws.invalidateBlacklistSwitchCache).toHaveBeenCalled();
    expect(prisma.companion.findMany).toHaveBeenCalledWith({
      where: { studioId: 's1' },
      select: { id: true, studioId: true },
    });
    expect(ws.pushCurrentBlacklist).toHaveBeenCalledWith('c1', 's1', false);
  });

  it('老板拨这一项写的是全站默认值 → 清缓存 + 推所有店（不加 studioId 过滤）', async () => {
    const { controller, prisma, ws } = setup();

    const res: any = await controller.updateConfig(
      { 'blacklist.enabled': true },
      { user: { role: 'OWNER', studioId: null } },
    );

    expect(res.data.saved).toContain('blacklist.enabled');
    expect(ws.invalidateBlacklistSwitchCache).toHaveBeenCalled();
    expect(prisma.companion.findMany).toHaveBeenCalledWith({
      where: undefined,
      select: { id: true, studioId: true },
    });
    expect(ws.pushCurrentBlacklist).toHaveBeenCalledWith('c1', 's1', false);
  });

  it('店长一次保存里混了老板专属键：本店开关照样保存、照样重推（不被 skipped 连坐）', async () => {
    const { controller, ws } = setup();

    const res: any = await controller.updateConfig(
      { 'blacklist.enabled': false, 'ai.deepseek_api_key': 'x' },
      { user: { role: 'ADMIN', studioId: 's1' } },
    );

    expect(res.data.saved).toEqual(['blacklist.enabled']);
    expect(res.data.skipped).toEqual(['ai.deepseek_api_key']);
    expect(ws.pushCurrentBlacklist).toHaveBeenCalled();
  });

  it('只改别的配置项 → 不动杀进程名单（否则等于每次保存都惊动所有陪玩）', async () => {
    const { controller, ws } = setup();

    await controller.updateConfig(
      { 'revenue.free_threshold': 5 },
      { user: { role: 'ADMIN', studioId: 's1' } },
    );

    expect(ws.invalidateBlacklistSwitchCache).not.toHaveBeenCalled();
    expect(ws.pushCurrentBlacklist).not.toHaveBeenCalled();
  });

  it('店长「恢复默认」把本店开关恢复 → 也要当场重推', async () => {
    const { controller, ws } = setup();

    await controller.resetStudioOverrides(
      { user: { role: 'ADMIN', studioId: 's1' } },
      'blacklist.enabled',
      undefined,
    );

    expect(ws.invalidateBlacklistSwitchCache).toHaveBeenCalled();
    expect(ws.pushCurrentBlacklist).toHaveBeenCalledWith('c1', 's1', false);
  });

  it('恢复默认但本来就没填过（一项都没删）→ 不推，避免空推', async () => {
    const { controller, prisma, ws } = setup();
    prisma.studioConfig.deleteMany.mockResolvedValue({ count: 0 });

    await controller.resetStudioOverrides(
      { user: { role: 'ADMIN', studioId: 's1' } },
      'blacklist.enabled',
      undefined,
    );

    expect(ws.pushCurrentBlacklist).not.toHaveBeenCalled();
  });

  it('恢复的是别的配置项 → 不动杀进程名单', async () => {
    const { controller, ws } = setup();

    await controller.resetStudioOverrides(
      { user: { role: 'ADMIN', studioId: 's1' } },
      'revenue.low_warning',
      undefined,
    );

    expect(ws.pushCurrentBlacklist).not.toHaveBeenCalled();
  });
});
