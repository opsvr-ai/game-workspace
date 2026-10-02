import { describe, it, expect, vi } from 'vitest';
import {
  normalizeCompanionOverrides,
  resolveCompanionBlacklistEnabled,
  resolveCompanionOverrides,
  resolveStudioBlacklistEnabled,
} from '../common/blacklist-switch';

/**
 * 「杀进程到底动不动手」的判定（老板 2026-10-02：在本店开关之外又加了一道「按人特批」）。
 *
 * 底线：**没被特批的人一律跟随本店开关** —— 新功能上线不能让任何一个没动过的人
 * 突然开始被结束进程；本店开关关着时，只有被单独打开的那几个人才会真的动手。
 */
function prismaWith(rows: Array<{ key: string; value: any }>) {
  return {
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    studioConfig: { findMany: vi.fn().mockResolvedValue(rows) },
  };
}

const enabled = (overrides: any = {}) => [
  { key: 'blacklist.enabled', value: true },
  { key: 'blacklist.companion_overrides', value: overrides },
];
const disabled = (overrides: any = {}) => [
  { key: 'blacklist.enabled', value: false },
  { key: 'blacklist.companion_overrides', value: overrides },
];

describe('normalizeCompanionOverrides：脏数据当没特批', () => {
  it('只认干净的 true / false', () => {
    expect(normalizeCompanionOverrides({ a: true, b: false, c: 'yes', d: 1, e: null })).toEqual({
      a: true,
      b: false,
    });
  });

  it('字符串（JSON）里的合法值也认，解析不了就当空表', () => {
    expect(normalizeCompanionOverrides('{"a":true,"b":"false"}')).toEqual({ a: true, b: false });
    expect(normalizeCompanionOverrides('not-json')).toEqual({});
  });

  it('结构不对（数组 / 数字 / null）当成空表', () => {
    expect(normalizeCompanionOverrides([1, 2])).toEqual({});
    expect(normalizeCompanionOverrides(5)).toEqual({});
    expect(normalizeCompanionOverrides(null)).toEqual({});
    expect(normalizeCompanionOverrides(undefined)).toEqual({});
  });
});

describe('本店开关：没特批就完全按老行为走', () => {
  it('本店开着 + 表是空的 → 生效', async () => {
    expect(await resolveCompanionBlacklistEnabled(prismaWith(enabled()) as never, 's1', 'c1')).toBe(true);
  });

  it('本店关着 + 表是空的 → 不生效（默认关 = 只记录不杀）', async () => {
    expect(await resolveCompanionBlacklistEnabled(prismaWith(disabled()) as never, 's1', 'c1')).toBe(false);
  });

  it('没拨过（库里没有这两个键）→ 不生效', async () => {
    expect(await resolveCompanionBlacklistEnabled(prismaWith([]) as never, 's1', 'c1')).toBe(false);
  });

  it('分不出是哪家店 → 不生效（说不清就绝不动手）', async () => {
    expect(
      await resolveCompanionBlacklistEnabled(prismaWith(enabled({ c1: true })) as never, null, 'c1'),
    ).toBe(false);
  });
});

describe('按人特批：本店关着也能单独打开，本店开着也能单独关掉', () => {
  it('本店关着 + 单独开 → 只有他生效', async () => {
    const prisma = prismaWith(disabled({ c1: true }));
    expect(await resolveCompanionBlacklistEnabled(prisma as never, 's1', 'c1')).toBe(true);
    expect(await resolveCompanionBlacklistEnabled(prisma as never, 's1', 'c2')).toBe(false);
  });

  it('本店开着 + 单独关 → 只有他不生效', async () => {
    const prisma = prismaWith(enabled({ c2: false }));
    expect(await resolveCompanionBlacklistEnabled(prisma as never, 's1', 'c1')).toBe(true);
    expect(await resolveCompanionBlacklistEnabled(prisma as never, 's1', 'c2')).toBe(false);
  });

  it('特批表脏了（值是 yes）→ 当没特批，跟随本店', async () => {
    expect(await resolveCompanionBlacklistEnabled(prismaWith(enabled({ c1: 'yes' })) as never, 's1', 'c1')).toBe(
      true,
    );
  });

  it('拿不到 companionId（不知道是谁）→ 跟随本店，不按特批乱来', async () => {
    expect(
      await resolveCompanionBlacklistEnabled(prismaWith(disabled({ c1: true })) as never, 's1', undefined),
    ).toBe(false);
  });
});

describe('读特批表', () => {
  it('resolveCompanionOverrides：没店号返回空表', async () => {
    expect(await resolveCompanionOverrides(prismaWith([]) as never, 's1')).toEqual({});
    expect(await resolveCompanionOverrides(prismaWith(enabled({ c1: true })) as never, null)).toEqual({});
  });

  it('resolveStudioBlacklistEnabled 只看本店开关，不受特批影响', async () => {
    expect(await resolveStudioBlacklistEnabled(prismaWith(disabled({ c1: true })) as never, 's1')).toBe(false);
  });

  it('配置读挂了 → 一律不生效，绝不误杀', async () => {
    const prisma = {
      systemConfig: { findUnique: vi.fn(), findMany: vi.fn().mockRejectedValue(new Error('db down')) },
      studioConfig: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
    };
    expect(await resolveCompanionBlacklistEnabled(prisma as never, 's1', 'c1')).toBe(false);
  });
});
