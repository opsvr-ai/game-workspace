import { DEFAULT_CONFIGS, assertStudioScopedKeys } from './default-config';

/**
 * 分店配置的**唯一读取入口**（老板 2026-09-21 拍板：以后进来的租赁线下工作室 / 线上俱乐部，
 * 所有数据由他们自己的店长填写）。
 *
 * 生效顺序（谁近听谁的）：
 *   1. **StudioConfig** —— 这家店自己填的（店长在设置页填的就是这里）；
 *   2. **SystemConfig** —— 老板给的默认值（老板在设置页填的）；
 *   3. **DEFAULT_CONFIGS** —— 代码里的内置默认。
 *
 * 所以：店长不动 = 用老板的默认；店长一填 = 只影响自己这家店，别家不受影响。
 * 全站唯一的键（JWT、AI key、前端版本、黑名单开关等）不走这里，见 `default-config.ts` 的白名单。
 */
export interface ResolvedConfigs {
  /** 生效值 */
  values: Record<string, any>;
  /** 这家店自己填过的键（界面上标「本店自定义」） */
  overridden: string[];
  /** 用老板默认值的键 */
  inherited: string[];
  /** 每个键的值到底从哪里来（调试 / 界面提示用） */
  sources: Record<string, 'studio' | 'system' | 'default'>;
}

type PrismaLike = {
  systemConfig: { findMany: (args: any) => Promise<Array<{ key: string; value: any }>> };
  studioConfig: {
    findMany: (args: any) => Promise<Array<{ key: string; value: any }>>;
    upsert: (args: any) => Promise<unknown>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
};

/** 解析一组配置在这家店里的生效值。 */
export async function resolveConfigs(
  prisma: PrismaLike,
  studioId: string | null | undefined,
  keys: string[],
): Promise<Record<string, any>> {
  const detailed = await resolveConfigsDetailed(prisma, studioId, keys);
  return detailed.values;
}

/** 同 `resolveConfigs`，另外告诉你哪些键是「本店自己填的」。 */
export async function resolveConfigsDetailed(
  prisma: PrismaLike,
  studioId: string | null | undefined,
  keys: string[],
): Promise<ResolvedConfigs> {
  if (!keys.length) return { values: {}, overridden: [], inherited: [], sources: {} };

  const [globalRecords, studioRecords] = await Promise.all([
    prisma.systemConfig.findMany({ where: { key: { in: keys } } }),
    studioId
      ? prisma.studioConfig.findMany({ where: { studioId, key: { in: keys } } })
      : Promise.resolve([]),
  ]);
  const globalMap = new Map(globalRecords.map((r) => [r.key, r.value]));
  const studioMap = new Map(studioRecords.map((r) => [r.key, r.value]));

  const values: Record<string, any> = {};
  const overridden: string[] = [];
  const inherited: string[] = [];
  const sources: Record<string, 'studio' | 'system' | 'default'> = {};
  for (const key of keys) {
    if (studioMap.has(key)) {
      values[key] = studioMap.get(key);
      overridden.push(key);
      sources[key] = 'studio';
    } else if (globalMap.has(key)) {
      values[key] = globalMap.get(key);
      inherited.push(key);
      sources[key] = 'system';
    } else {
      values[key] = DEFAULT_CONFIGS[key] ?? null;
      inherited.push(key);
      sources[key] = 'default';
    }
  }
  return { values, overridden, inherited, sources };
}

/**
 * 同 `resolveConfigs`，但**不做内置默认值兜底**：
 *
 * 分店没填、老板也没填时返回 `undefined`，
 * 让调用处自己的 `?? 兜底值` 继续生效。
 *
 * 专用于把老的 `systemConfig.findUnique({ key })` + `?? 兜底` 改成按店解析的地方：
 * 这样「分店没填」时结果与改之前**一模一样**，只是多了一层分店覆盖。
 * （不能直接用 `resolveConfigs`：它会把「没配过」变成「内置默认值」，
 * 而内置默认值和各处代码里的 `?? 兜底` 不一定相等，会偷偷改变原来的算法。）
 */
export async function resolveConfigsRaw(
  prisma: PrismaLike,
  studioId: string | null | undefined,
  keys: string[],
): Promise<Record<string, any>> {
  const detailed = await resolveConfigsDetailed(prisma, studioId, keys);
  const out: Record<string, any> = {};
  for (const key of keys) {
    out[key] = detailed.sources[key] === 'default' ? undefined : detailed.values[key];
  }
  return out;
}

/** 数字配置的便捷读法。 */
export async function resolveConfigNumber(
  prisma: PrismaLike,
  studioId: string | null | undefined,
  key: string,
  fallback: number,
): Promise<number> {
  const values = await resolveConfigs(prisma, studioId, [key]);
  const raw = values[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 写这家店自己的值（店长在设置页保存时调用）。只允许分店白名单里的键。 */
export async function saveStudioConfigs(
  prisma: PrismaLike,
  studioId: string,
  entries: Record<string, any>,
): Promise<void> {
  const keys = Object.keys(entries);
  assertStudioScopedKeys(keys);
  await Promise.all(
    keys.map((key) =>
      prisma.studioConfig.upsert({
        where: { studioId_key: { studioId, key } },
        create: { studioId, key, value: entries[key] },
        update: { value: entries[key] },
      }),
    ),
  );
}

/**
 * 删掉这家店自己的值 —— 等于「恢复用老板的默认」。返回删了几条。
 *
 * `keys` 空数组 = 这家店全部恢复默认
 * （`StudioConfig` 里只会存白名单内的键，所以按 studioId 直接清就是安全的）。
 */
export async function resetStudioConfigs(
  prisma: PrismaLike,
  studioId: string,
  keys: string[],
): Promise<number> {
  const res = await prisma.studioConfig.deleteMany({
    where: keys.length ? { studioId, key: { in: keys } } : { studioId },
  });
  return res.count;
}
