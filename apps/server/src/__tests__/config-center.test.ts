import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_CONFIGS,
  STUDIO_SCOPED_KEYS,
  isOwnerOnlyKey,
  isStudioScopedKey,
} from '../common/default-config';
import {
  CONFIG_KEYS,
  allConfigDefinitions,
  assertStudioWritableEntries,
  assertValidConfigEntries,
  configDefault,
  configDefinitionDrift,
  configScopeOf,
  configValueError,
  isKnownConfigKey,
  isStudioWritableConfigKey,
  studioScopeViolations,
} from '../common/config-keys';
import {
  resolveConfigs,
  resolveConfigsDetailed,
  resolveConfigsRaw,
  saveConfigsByRole,
  saveStudioConfigs,
} from '../common/studio-config';
import { SettingsController } from '../auth/settings.controller';

/**
 * 配置中心（`common/config-keys.ts`）回归测试。
 *
 * 锁住四件「改了就出事」的事：
 *  1. **118 个键一个都不能少、默认值一个字都不能改** —— 键名 / 默认值就是线上行为；
 *  2. **非法值不落库** —— 设置页一次 PUT 带十几个键，坏值必须整次拒掉并点名，不能静默吞掉；
 *  3. **SYSTEM / STUDIO 作用域不混写** —— 密钥 / 版本号 / 店长考勤不许被店长写进本店覆盖；
 *  4. **页面读到的值 == 服务读到的值** —— 设置页显示 80、结算却按 70 算，是老板反复踩过的坑。
 */

// ── 工具：假 Prisma（只实现配置解析用到的那几个方法）────────────────────────────
function makePrisma(opts: {
  system?: Array<{ key: string; value: any }>;
  studio?: Array<{ key: string; value: any; studioId?: string }>;
} = {}) {
  const systemRows = opts.system ?? [];
  // 默认都算 's1' 这家店（本用例只关心「同一家店的页面值 vs 服务值」）
  const studioRows = (opts.studio ?? []).map((r) => ({ ...r, studioId: r.studioId ?? 's1' }));
  return {
    systemConfig: {
      findMany: vi.fn(async ({ where }: any) =>
        systemRows.filter((r) => !where?.key?.in || where.key.in.includes(r.key)).map((r) => ({ ...r })),
      ),
      findUnique: vi.fn(async ({ where }: any) => systemRows.find((r) => r.key === where?.key) ?? null),
      upsert: vi.fn(async () => ({})),
    },
    studioConfig: {
      findMany: vi.fn(async ({ where }: any) =>
        studioRows
          .filter((r) => r.studioId === where?.studioId)
          .filter((r) => !where?.key?.in || where.key.in.includes(r.key))
          .map((r) => ({ key: r.key, value: r.value })),
      ),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    companion: { findMany: vi.fn(async () => []) },
  } as any;
}

function makeController(prisma: any = makePrisma()) {
  const ws = { invalidateBlacklistSwitchCache: vi.fn(), pushCurrentBlacklist: vi.fn() };
  return { controller: new SettingsController(prisma, null as never, ws as never), prisma, ws };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('配置中心 · 键表与定义', () => {
  it('118 个键全部有类型化定义（键表 / 定义表 / DEFAULT_CONFIGS 三方一一对应）', () => {
    expect(CONFIG_KEYS.length).toBe(118);
    expect(new Set(CONFIG_KEYS).size).toBe(CONFIG_KEYS.length);
    // 双向零漂移：DEFAULT_CONFIGS 有但没定义 = missing；定义了但 DEFAULT_CONFIGS 没有 = extra
    expect(configDefinitionDrift()).toEqual({ missingDefinitions: [], extraDefinitions: [] });
    for (const key of CONFIG_KEYS) {
      expect(isKnownConfigKey(key)).toBe(true);
      const def = allConfigDefinitions().find((d) => d.key === key);
      expect(def).toBeTruthy();
      expect(def!.key).toBe(key);
      expect(typeof def!.type).toBe('string');
      expect(['SYSTEM', 'STUDIO']).toContain(def!.scope);
    }
  });

  it('默认值与 default-config.ts 逐键一致（含大结构：阶梯 / 列定义 / 长文案）', () => {
    for (const key of Object.keys(DEFAULT_CONFIGS)) {
      expect(configDefault(key)).toEqual(DEFAULT_CONFIGS[key]);
    }
  });

  it('所有键都有非空说明（设置页 / 文档可以直接引用）', () => {
    for (const def of allConfigDefinitions()) {
      expect(typeof def.description).toBe('string');
      expect((def.description || '').length).toBeGreaterThan(0);
    }
  });

  it('未定义的动态键沿用老行为：不算已知键、默认值退回 DEFAULT_CONFIGS、校验放行', () => {
    const dynamicKey = 'counter.global_code';
    expect(isKnownConfigKey(dynamicKey)).toBe(false);
    expect(DEFAULT_CONFIGS[dynamicKey]).toBeUndefined();
    expect(configDefault(dynamicKey)).toBeUndefined();
    expect(configValueError(dynamicKey, { anything: true })).toBeNull();
    expect(() => assertValidConfigEntries({ [dynamicKey]: '42' })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('配置中心 · 非法值被拒（不落库）', () => {
  const invalidCases: Array<[string, any]> = [
    ['revenue.free_threshold', '300'], // 数字键传字符串
    ['revenue.free_threshold', Number.NaN],
    ['pool.popup_seconds', 1.5], // 整数键传小数
    ['blacklist.enabled', 'true'], // 布尔键传字符串
    ['blacklist.enabled', 1],
    ['revenue.share_tiers', 'nope'], // 结构型
    ['revenue.share_tiers', []],
    ['revenue.share_tiers', [{ min: 'a', max: null, studio: 50, companion: 50 }]],
    ['excellence.revenue_tiers', [{ min: 0 }]],
    ['traffic.account_columns', [{ key: 'type', label: '平台' }]],
    ['traffic.note_benchmarks', { clickRate: 4 }],
    ['expense.monthly_items', [{ id: 'rent', name: '房租' }]],
    ['dispatch.game_break_even_hours', [{ game: '三角洲行动' }]],
    ['games', '英雄联盟'],
    ['games', ['英雄联盟', 42]],
    ['commission.cs_online_mode', 'SOMETHING_ELSE'],
    ['blacklist.companion_overrides', { c1: 'yes' }],
    ['revenue.low_warning', null],
  ];

  it.each(invalidCases)('%s 拒绝非法值 %j', (key, value) => {
    expect(configValueError(key, value)).toBeTruthy();
    expect(() => assertValidConfigEntries({ [key]: value })).toThrow(BadRequestException);
  });

  it('错误消息里点出所有出问题的键名（一次保存里多个坏值一起报）', () => {
    try {
      assertValidConfigEntries({
        'revenue.free_threshold': '300',
        'blacklist.enabled': 'yes',
      });
      throw new Error('不该通过');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(String(e.message)).toContain('revenue.free_threshold');
      expect(String(e.message)).toContain('blacklist.enabled');
    }
  });

  it('合法的边界值照旧放行（不制造新的业务限制）', () => {
    expect(configValueError('revenue.free_threshold', 0)).toBeNull();
    expect(configValueError('pool.popup_seconds', 0)).toBeNull();
    expect(configValueError('blacklist.enabled', false)).toBeNull();
    expect(configValueError('attendance.workStart', '09:00')).toBeNull();
    expect(configValueError('commission.cs_online_mode', 'per_order')).toBeNull(); // 大小写不敏感
    expect(configValueError('commission.cs_online_mode', 'RATE')).toBeNull();
    expect(configValueError('expense.monthly_items', [])).toBeNull();
    expect(configValueError('traffic.play_guide', '')).toBeNull();
    expect(configValueError('blacklist.companion_overrides', {})).toBeNull();
    expect(configValueError('blacklist.companion_overrides', { c1: true, c2: false })).toBeNull();
    // 设置页可能刚加一行还没填 / 老数据最上档没写 max —— 这些合法输入不能被拦
    expect(configValueError('dispatch.game_break_even_hours', [{ game: '', hours: 0 }])).toBeNull();
    expect(
      configValueError('revenue.share_tiers', [
        { min: 0, studio: 50, companion: 50 },
        { min: 10000, max: null, studio: 30, companion: 70 },
      ]),
    ).toBeNull();
    // 全部键的默认值必须自己就能通过校验（否则「恢复默认」会被拦）
    for (const key of CONFIG_KEYS) {
      expect(configValueError(key, DEFAULT_CONFIGS[key])).toBeNull();
    }
  });

  it('设置页保存非法值：整次拒掉、一条都不写进库', async () => {
    const { controller, prisma } = makeController();
    await expect(
      controller.updateConfig(
        { 'revenue.free_threshold': '不是数字' },
        { user: { role: 'ADMIN', studioId: 's1' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('写入口（saveConfigsByRole）也拦：坏值不写、坏在哪个键就说哪个键', async () => {
    const prisma = makePrisma();
    await expect(
      saveConfigsByRole(prisma, { role: 'OWNER', studioId: null }, { 'pool.popup_seconds': 'soon' }),
    ).rejects.toThrow(/pool\.popup_seconds/);
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('合法值正常保存（校验不会误伤设置页）', async () => {
    const { controller, prisma } = makeController();
    const res: any = await controller.updateConfig(
      {
        'revenue.free_threshold': 320,
        'blacklist.enabled': true,
        'commission.cs_online_mode': 'PER_ORDER',
        games: ['英雄联盟'],
      },
      { user: { role: 'ADMIN', studioId: 's1' } },
    );
    expect(res.code).toBe(200);
    expect(res.data.saved).toEqual([
      'revenue.free_threshold',
      'blacklist.enabled',
      'commission.cs_online_mode',
      'games',
    ]);
    expect(prisma.studioConfig.upsert).toHaveBeenCalledTimes(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('配置中心 · SYSTEM / STUDIO 作用域不混写', () => {
  it('每个键的作用域与 default-config 的老板专属名单完全一致', () => {
    for (const key of CONFIG_KEYS) {
      const expected = isOwnerOnlyKey(key) ? 'SYSTEM' : 'STUDIO';
      expect(configScopeOf(key)).toBe(expected);
      expect(isStudioWritableConfigKey(key)).toBe(isStudioScopedKey(key));
      // 与界面用的 STUDIO_SCOPED_KEYS 同口径
      expect(STUDIO_SCOPED_KEYS.includes(key)).toBe(expected === 'STUDIO');
    }
  });

  it('SYSTEM 键：店长写本店被拒（直接写 StudioConfig 也不行）', async () => {
    const systemKeys = CONFIG_KEYS.filter((k) => configScopeOf(k) === 'SYSTEM');
    expect(systemKeys.length).toBeGreaterThan(0);
    for (const key of systemKeys) {
      expect(studioScopeViolations({ [key]: DEFAULT_CONFIGS[key] })).toEqual([key]);
      expect(() => assertStudioWritableEntries({ [key]: DEFAULT_CONFIGS[key] })).toThrow(BadRequestException);
      const prisma = makePrisma();
      await expect(saveStudioConfigs(prisma, 's1', { [key]: DEFAULT_CONFIGS[key] })).rejects.toThrow();
      expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
    }
  });

  it('SYSTEM 键：店长一次保存里混进来 → 跳过并点名，不写本店、不写全站', async () => {
    const systemKeys = CONFIG_KEYS.filter((k) => configScopeOf(k) === 'SYSTEM');
    for (const key of systemKeys) {
      const prisma = makePrisma();
      const res = await saveConfigsByRole(prisma, { role: 'ADMIN', studioId: 's1' }, {
        [key]: DEFAULT_CONFIGS[key],
      });
      expect(res.saved).toEqual([]);
      expect(res.skipped).toEqual([key]);
      expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
      expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });

  it('STUDIO 键：店长都能写本店覆盖（不会被作用域校验误伤）', async () => {
    const studioKeys = CONFIG_KEYS.filter((k) => configScopeOf(k) === 'STUDIO');
    expect(studioKeys.length).toBe(CONFIG_KEYS.length - CONFIG_KEYS.filter((k) => configScopeOf(k) === 'SYSTEM').length);
    const prisma = makePrisma();
    for (const key of studioKeys) {
      await saveStudioConfigs(prisma, 's1', { [key]: DEFAULT_CONFIGS[key] });
    }
    expect(prisma.studioConfig.upsert).toHaveBeenCalledTimes(studioKeys.length);
  });

  it('老板写的是全站默认值：两种作用域都能写（写进 SystemConfig，不写 StudioConfig）', async () => {
    const prisma = makePrisma();
    const res = await saveConfigsByRole(prisma, { role: 'OWNER', studioId: null }, {
      'revenue.free_threshold': 300,
      'ai.doubao_model': 'doubao-pro-32k',
    });
    expect(res).toEqual({
      scope: 'global',
      saved: ['revenue.free_threshold', 'ai.doubao_model'],
      skipped: [],
    });
    expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.studioConfig.upsert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('配置中心 · 页面读到的值 == 服务读到的值（遍历 118 个键）', () => {
  const systemOverrides = [
    { key: 'revenue.free_threshold', value: 333 },
    { key: 'commission.cs_online_mode', value: 'PER_ORDER' },
    { key: 'blacklist.enabled', value: true },
    { key: 'attendance.manager.workStart', value: '08:30' },
  ];
  const studioOverrides = [
    { key: 'revenue.free_threshold', value: 555 },
    { key: 'blacklist.companion_overrides', value: { c1: true } },
  ];

  beforeEach(() => vi.clearAllMocks());

  it('老板视角（全站）：GET /config 的每个键 == 服务端 resolveConfigsRaw ?? 内置默认', async () => {
    const prisma = makePrisma({ system: systemOverrides });
    const { controller } = makeController(prisma);
    const page: any = await controller.getConfig(undefined, { user: { role: 'OWNER', studioId: null } });
    const keys = Object.keys(DEFAULT_CONFIGS);
    expect(page.code).toBe(200);

    for (const key of keys) {
      const raw = await resolveConfigsRaw(prisma, null, [key]);
      const serviceValue = raw[key] === undefined ? DEFAULT_CONFIGS[key] : raw[key];
      // 页面值：有覆盖用覆盖值，没覆盖就是内置默认（不能是 null / undefined）
      expect({ key, value: page.data[key] }).toEqual({ key, value: serviceValue });
    }
  });

  it('店长视角（本店）：本店覆盖 / 全局默认 / 内置默认 三层，页面与解析器逐键一致', async () => {
    const prisma = makePrisma({ system: systemOverrides, studio: studioOverrides });
    const { controller } = makeController(prisma);
    const page: any = await controller.getConfig(undefined, { user: { role: 'ADMIN', studioId: 's1' } });
    const keys = Object.keys(DEFAULT_CONFIGS);

    for (const key of keys) {
      const resolved = await resolveConfigs(prisma, 's1', [key]);
      // 敏感键（identity./jwt./secret/ai./turn.）店长读不到真值，页面故意给内置默认 —— 属于安全口径；
      // 其余键页面值必须与「服务端按店解析」完全一致。
      const hidden = ['identity.', 'jwt.', 'secret', 'ai.', 'turn.'].some((p) => key.startsWith(p));
      const expected = hidden ? DEFAULT_CONFIGS[key] : resolved[key];
      expect({ key, value: page.data[key] }).toEqual({ key, value: expected });
    }
    // 三层来源断言：本店 555、全局 333、其余内置默认
    expect(page.data['revenue.free_threshold']).toBe(555);
    expect(page.data['commission.cs_online_mode']).toBe('PER_ORDER');
  });

  it('resolveConfigsDetailed / resolveConfigs / resolveConfigsRaw 三套读法对同一家店不打架', async () => {
    const prisma = makePrisma({ system: systemOverrides, studio: studioOverrides });
    for (const key of CONFIG_KEYS) {
      const detailed = await resolveConfigsDetailed(prisma, 's1', [key]);
      const plain = await resolveConfigs(prisma, 's1', [key]);
      const raw = await resolveConfigsRaw(prisma, 's1', [key]);
      expect(plain[key]).toEqual(detailed.values[key]);
      // raw 不做内置默认兜底：只有真的没配过才是 undefined，否则与 UI 值一致
      if (detailed.sources[key] !== 'default') {
        expect(raw[key]).toEqual(detailed.values[key]);
      } else {
        expect(raw[key]).toBeUndefined();
        expect(detailed.values[key]).toEqual(DEFAULT_CONFIGS[key]);
      }
    }
  });

  it('未定义的动态键：页面读法与老逻辑完全一致（没有默认值就是 null）', async () => {
    const prisma = makePrisma({ system: [{ key: 'counter.global_code', value: '120' }] });
    const { controller } = makeController(prisma);
    const page: any = await controller.getConfig('counter.global_code', {
      user: { role: 'OWNER', studioId: null },
    });
    expect(page.data['counter.global_code']).toBe('120');
    const page2: any = await controller.getConfig('some.unknown.key', {
      user: { role: 'OWNER', studioId: null },
    });
    expect(page2.data['some.unknown.key']).toBeNull();
  });
});
