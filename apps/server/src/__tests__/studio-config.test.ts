import { describe, it, expect, vi } from 'vitest';
import {
  resolveConfigs,
  resolveConfigsDetailed,
  resolveConfigsRaw,
  resolveConfigNumber,
  saveStudioConfigs,
  resetStudioConfigs,
} from '../common/studio-config';
import { assertStudioScopedKeys, isStudioScopedKey } from '../common/default-config';

/**
 * 分店配置（老板 2026-09-21：以后进来的租赁线下工作室 / 线上俱乐部，
 * 所有数据由他们自己的店长填写）。
 *
 * 生效顺序必须是：本店填的 → 老板全局默认 → 代码内置默认。
 */

const makePrisma = (opts: {
  system?: Array<{ key: string; value: any }>;
  studio?: Array<{ key: string; value: any }>;
}) => {
  const studioRows = [...(opts.studio ?? [])];
  return {
    systemConfig: {
      findMany: vi.fn(async () => opts.system ?? []),
    },
    studioConfig: {
      findMany: vi.fn(async () => studioRows),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: studioRows.length })),
    },
    __studioRows: studioRows,
  } as any;
};

describe('studio-config 分店配置解析', () => {
  it('店长填过就用店长填的（覆盖老板的全局值）', async () => {
    const prisma = makePrisma({
      system: [{ key: 'revenue.club_companion_share', value: 80 }],
      studio: [{ key: 'revenue.club_companion_share', value: 70 }],
    });
    const values = await resolveConfigs(prisma, 'studio-a', ['revenue.club_companion_share']);
    expect(values['revenue.club_companion_share']).toBe(70);
  });

  it('店长没填就用老板的全局值', async () => {
    const prisma = makePrisma({
      system: [{ key: 'revenue.club_companion_share', value: 80 }],
    });
    const values = await resolveConfigs(prisma, 'studio-a', ['revenue.club_companion_share']);
    expect(values['revenue.club_companion_share']).toBe(80);
  });

  it('都没填就落到代码内置默认', async () => {
    const prisma = makePrisma({});
    const values = await resolveConfigs(prisma, 'studio-a', ['revenue.free_threshold']);
    expect(values['revenue.free_threshold']).toBe(300);
  });

  it('没有 studioId（老板账号）时不会去读 StudioConfig', async () => {
    const prisma = makePrisma({ system: [{ key: 'revenue.free_threshold', value: 888 }] });
    const values = await resolveConfigs(prisma, null, ['revenue.free_threshold']);
    expect(values['revenue.free_threshold']).toBe(888);
    expect(prisma.studioConfig.findMany).not.toHaveBeenCalled();
  });

  it('一家店填了不影响另一家店', async () => {
    const prisma = makePrisma({
      system: [{ key: 'revenue.club_companion_share', value: 80 }],
      studio: [{ key: 'revenue.club_companion_share', value: 70 }],
    });
    expect((await resolveConfigs(prisma, 'studio-a', ['revenue.club_companion_share']))['revenue.club_companion_share']).toBe(70);
    // 换一家店，查到的还是老板的 80
    const other = makePrisma({ system: [{ key: 'revenue.club_companion_share', value: 80 }] });
    expect((await resolveConfigs(other, 'studio-b', ['revenue.club_companion_share']))['revenue.club_companion_share']).toBe(80);
  });

  it('detailed 会告诉界面哪些键是本店自定义的', async () => {
    const prisma = makePrisma({
      system: [
        { key: 'revenue.club_companion_share', value: 80 },
        { key: 'revenue.free_threshold', value: 300 },
      ],
      studio: [{ key: 'revenue.club_companion_share', value: 70 }],
    });
    const d = await resolveConfigsDetailed(prisma, 'studio-a', [
      'revenue.club_companion_share',
      'revenue.free_threshold',
    ]);
    expect(d.overridden).toEqual(['revenue.club_companion_share']);
    expect(d.inherited).toContain('revenue.free_threshold');
    expect(d.sources['revenue.club_companion_share']).toBe('studio');
    expect(d.sources['revenue.free_threshold']).toBe('system');
  });

  it('raw 读法不做内置默认兜底：没配过就是 undefined（让调用处自己的兜底继续生效）', async () => {
    const prisma = makePrisma({ system: [{ key: 'commission.cs_base_salary_yuan', value: 2100 }] });
    const raw = await resolveConfigsRaw(prisma, 'studio-a', [
      'commission.cs_base_salary_yuan',
      'commission.cs_bridge_per_order_yuan',
    ]);
    expect(raw['commission.cs_base_salary_yuan']).toBe(2100);
    expect(raw['commission.cs_bridge_per_order_yuan']).toBeUndefined();
    // 而带兜底的读法会给出内置默认
    const full = await resolveConfigs(prisma, 'studio-a', ['commission.cs_bridge_per_order_yuan']);
    expect(full['commission.cs_bridge_per_order_yuan']).toBe(1);
  });

  it('resolveConfigNumber 拿数字，配错了就用兜底', async () => {
    const prisma = makePrisma({ studio: [{ key: 'dispatch.middle_tier_daily_new_limit', value: 5 }] });
    expect(await resolveConfigNumber(prisma, 'studio-a', 'dispatch.middle_tier_daily_new_limit', 2)).toBe(5);
    const prisma2 = makePrisma({});
    expect(await resolveConfigNumber(prisma2, 'studio-a', 'dispatch.middle_tier_daily_new_limit', 2)).toBe(2);
  });

  it('保存时写的是本店覆盖，键用的是 studioId + key 唯一约束', async () => {
    const prisma = makePrisma({});
    await saveStudioConfigs(prisma, 'studio-a', { 'revenue.club_companion_share': 70 });
    expect(prisma.studioConfig.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.studioConfig.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ studioId_key: { studioId: 'studio-a', key: 'revenue.club_companion_share' } });
    expect(arg.create).toEqual({
      studioId: 'studio-a',
      key: 'revenue.club_companion_share',
      value: 70,
    });
  });

  it('保存时混进全站唯一的键 → 直接报错，不会悄悄改到全站配置', async () => {
    const prisma = makePrisma({});
    await expect(saveStudioConfigs(prisma, 'studio-a', { 'blacklist.auto_kill': true })).rejects.toThrow();
    expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
  });

  it('恢复默认：按 key 删；不传 key 就是本店全部恢复', async () => {
    const prisma = makePrisma({ studio: [{ key: 'revenue.free_threshold', value: 1 }] });
    await resetStudioConfigs(prisma, 'studio-a', ['revenue.free_threshold']);
    expect(prisma.studioConfig.deleteMany.mock.calls[0][0].where).toEqual({
      studioId: 'studio-a',
      key: { in: ['revenue.free_threshold'] },
    });
    await resetStudioConfigs(prisma, 'studio-a', []);
    expect(prisma.studioConfig.deleteMany.mock.calls[1][0].where).toEqual({ studioId: 'studio-a' });
  });
});

describe('分店可自填的键白名单', () => {
  it('钱 / 名额 / 计费类算分店的', () => {
    expect(isStudioScopedKey('revenue.share_tiers')).toBe(true);
    expect(isStudioScopedKey('revenue.club_companion_share')).toBe(true);
    expect(isStudioScopedKey('commission.admin_offline_rate_percent')).toBe(true);
    expect(isStudioScopedKey('dispatch.middle_tier_daily_new_limit')).toBe(true);
    expect(isStudioScopedKey('entertainment.hourly_rate')).toBe(true);
  });

  it('全站唯一项一律不放行（放行就等于店长能改到别人家）', () => {
    for (const key of [
      'blacklist.auto_kill',
      'jwt.secret',
      'web.frontend_version',
      'ai.api_key',
      'ws.token_grace_hours',
      'identity.app_code',
    ]) {
      expect(isStudioScopedKey(key)).toBe(false);
      expect(() => assertStudioScopedKeys([key])).toThrow();
    }
  });

  it('错误信息里点名了是哪些键，方便界面直接提示', () => {
    try {
      assertStudioScopedKeys(['revenue.free_threshold', 'blacklist.auto_kill']);
      throw new Error('不该通过');
    } catch (e: any) {
      expect(String(e.message)).toContain('blacklist.auto_kill');
    }
  });

  it('没人读的键不许放进白名单（避免「店长填了不生效」）', () => {
    // 这几个键目前全库没有读取点，线上实际走的是 pool.*，放进来只会误导店长
    for (const key of [
      'commission.attribution_window',
      'dispatch.bridge_immediate_window_sec',
      'dispatch.bridge_return_jimi_cents',
      'dispatch.bridge_return_jueju_cents',
    ]) {
      expect(isStudioScopedKey(key)).toBe(false);
    }
  });
});
