import { describe, it, expect, vi } from 'vitest';
import {
  resolveConfigs,
  resolveConfigsDetailed,
  resolveConfigsRaw,
  resolveConfigNumber,
  saveStudioConfigs,
  resetStudioConfigs,
  saveConfigsByRole,
} from '../common/studio-config';
import {
  assertStudioScopedKeys,
  isOwnerOnlyKey,
  isStudioScopedKey,
} from '../common/default-config';

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

describe('配置归谁改：默认归分店，只有「安全与稳定」归老板', () => {
  it('店长能改自己店里的任何业务配置（钱 / 名额 / 计费 / 考勤 / 截图 / 派单）', () => {
    for (const key of [
      'revenue.share_tiers',
      'revenue.club_companion_share',
      'commission.admin_offline_rate_percent',
      'commission.admin_online_rate_percent',
      'dispatch.middle_tier_daily_new_limit',
      'entertainment.hourly_rate',
      'attendance.workStart',
      'attendance.workEnd',
      'capture.expected_per_hour',
      'pool.middle_delay_seconds',
      'pool.bridge_return_jueju_cents',
      'withdraw.monthly_limit',
      'expense.monthly_items',
      'excellence.excellent_threshold',
      'traffic.play_guide',
      'options.contact_results',
      'billing.report_diff_warning_yuan',
      'anomaly.spend_drop_percent',
    ]) {
      expect(isStudioScopedKey(key)).toBe(true);
      expect(isOwnerOnlyKey(key)).toBe(false);
    }
  });

  it('密钥 / 凭据类只有老板能改（泄露或被改会让全站不可用）', () => {
    for (const key of [
      'identity.app_code',
      'identity.app_key',
      'identity.app_secret',
      'jwt.secret',
      'ai.provider',
      'ai.deepseek_api_key',
      'ai.doubao_api_key',
      'turn.url',
      'turn.username',
      'turn.credential',
    ]) {
      expect(isOwnerOnlyKey(key)).toBe(true);
      expect(isStudioScopedKey(key)).toBe(false);
      expect(() => assertStudioScopedKeys([key])).toThrow();
    }
  });

  it('一份值绑住全站的开关与版本号也只有老板能改', () => {
    for (const key of [
      'blacklist.auto_kill',
      'agent.latest_version',
      'agent.latest_download_url',
      'cs.latest_version',
      'web.frontend_version',
      'ws.token_grace_hours',
      'ws.offline_grace_seconds',
      'service.stale_session_hours',
      'counter.global_code',
      'invite.abc123',
      'cs.client.version.some-user',
      'excellence.low_tier_streak',
    ]) {
      expect(isOwnerOnlyKey(key)).toBe(true);
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
});

describe('saveConfigsByRole：按身份写对地方（店跟店独立的关键）', () => {
  const makeRolePrisma = () => ({
    systemConfig: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
    },
    studioConfig: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }) as any;

  it('店长保存 → 写本店覆盖，绝不写全站默认', async () => {
    const prisma = makeRolePrisma();
    const res = await saveConfigsByRole(
      prisma,
      { role: 'ADMIN', studioId: 'studio-a' },
      { 'attendance.workStart': '10:00' },
    );
    expect(res).toEqual({ scope: 'studio', saved: ['attendance.workStart'], skipped: [] });
    expect(prisma.studioConfig.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.studioConfig.upsert.mock.calls[0][0].where).toEqual({
      studioId_key: { studioId: 'studio-a', key: 'attendance.workStart' },
    });
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('老板保存 → 写全站默认，所有店跟着变', async () => {
    const prisma = makeRolePrisma();
    const res = await saveConfigsByRole(
      prisma,
      { role: 'OWNER', studioId: null },
      { 'attendance.workStart': '09:30' },
    );
    expect(res).toEqual({ scope: 'global', saved: ['attendance.workStart'], skipped: [] });
    expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
  });

  it('店长保存时混进老板专属键：跳过并在 skipped 里点名，不报错、也不悄悄丢掉', async () => {
    const prisma = makeRolePrisma();
    const res = await saveConfigsByRole(
      prisma,
      { role: 'ADMIN', studioId: 'studio-a' },
      { 'revenue.free_threshold': 400, 'ai.deepseek_api_key': 'sk-leak' },
    );
    expect(res.scope).toBe('studio');
    expect(res.saved).toEqual(['revenue.free_threshold']);
    expect(res.skipped).toEqual(['ai.deepseek_api_key']);
    // 密钥一个字节都没写进本店覆盖，更没写进全站
    expect(prisma.studioConfig.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.studioConfig.upsert.mock.calls[0][0].create.key).toBe('revenue.free_threshold');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('没绑定工作室的店长账号：直接报错，绝不悄悄改到全站默认', async () => {
    const prisma = makeRolePrisma();
    await expect(
      saveConfigsByRole(prisma, { role: 'ADMIN', studioId: null }, { 'pool.popup_seconds': 30 }),
    ).rejects.toThrow();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
  });
});
