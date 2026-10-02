import { resolveConfigs } from './studio-config';

/**
 * 「杀进程到底动不动手」的**唯一判定**（老板 2026-09-24 / 2026-10-02 两次拍板）。
 *
 * 老板原话：「不需要总闸，只需要店长自己定自己的俱乐部或者工作室是否生效就可以」。
 * 所以以前那道「全站总开关」SystemConfig.blacklist.auto_kill 已经**整条去掉**（不要再用它）。
 *
 * 现在判定分两层，合成一道结果：
 *
 *   1. **本店开关** StudioConfig.blacklist.enabled —— 店长在「进程黑名单」页顶部自己拨。
 *      关着 = 本店名单只记录、不下发，本店陪玩一个进程都不会被结束；
 *      打开 = 本店名单照常下发给本店陪玩。各店互相独立，谁也不影响谁。
 *
 *   2. **按人特批** StudioConfig.blacklist.companion_overrides —— 老板 2026-10-02 要的
 *      「我具体给几个人打开测试一下，其他人是关闭的」：
 *      键 = 陪玩 Companion.id，值 = true（这个人单独生效）/ false（这个人单独不生效）。
 *      **没写进这张表的人一律跟随本店开关**（所以老数据、没特批过的人行为一个字节都不变）；
 *      写进表里的人按自己的值走 —— 本店开着也能把某个人单独关掉，本店关着也能把某个人单独打开。
 *
 * 默认**关**（DEFAULT_CONFIGS 里也是 false，特批表也是空的）：跟去掉总闸之前的线上现状一致，
 * 绝不会有店在没人拨过开关的情况下突然开始结束陪玩正在玩的游戏。
 *
 * 关着（或读不到是哪家店）时，服务端下发**空名单**：客户端收到空名单会当场停掉杀进程，
 * 连没升级的老客户端也一样。
 *
 * 这里只做「读」。要改这两个键只能由店长 / 老板在管理端手动改，脚本一律不许动。
 */

type PrismaLike = {
  systemConfig: {
    findUnique: (args: any) => Promise<{ value: any } | null>;
    findMany: (args: any) => Promise<Array<{ key: string; value: any }>>;
  };
  studioConfig: {
    findMany: (args: any) => Promise<Array<{ key: string; value: any }>>;
  };
};

const truthy = (value: unknown): boolean => value === true || value === 'true';

/**
 * 本店开关（店长自己的）。没拨过 = 不生效（只记录、不杀）。
 *
 * 传不进 studioId（分不出是哪家店）时也按「不生效」处理：
 * 杀进程这种会踢人下线的事，说不清是哪家店就绝不动手。
 */
export async function resolveStudioBlacklistEnabled(
  prisma: PrismaLike,
  studioId: string | null | undefined,
): Promise<boolean> {
  if (!studioId) return false;
  try {
    const values = await resolveConfigs(prisma as any, studioId, ['blacklist.enabled']);
    return truthy(values['blacklist.enabled']);
  } catch {
    return false;
  }
}

/**
 * 把「按人特批」这个键的值收拾成 `companionId -> boolean`。
 *
 * 库里是 JSON 列（也可能是手填的字符串），这里只认干净的 true / false：
 * 结构不对、值不认识的条目一律**丢掉**（丢掉 = 跟随本店），宁可少动手也绝不误杀。
 */
export function normalizeCompanionOverrides(raw: unknown): Record<string, boolean> {
  let value: any = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    if (val === true || val === 'true') out[key] = true;
    else if (val === false || val === 'false') out[key] = false;
  }
  return out;
}

/** 读本店的「按人特批」表（空的 = 所有人都跟随本店开关）。 */
export async function resolveCompanionOverrides(
  prisma: PrismaLike,
  studioId: string | null | undefined,
): Promise<Record<string, boolean>> {
  if (!studioId) return {};
  try {
    const values = await resolveConfigs(prisma as any, studioId, ['blacklist.companion_overrides']);
    return normalizeCompanionOverrides(values['blacklist.companion_overrides']);
  } catch {
    return {};
  }
}

/**
 * **这个陪玩**到底动不动手：本店开关 + 按人特批，合起来看。
 *
 *  - 没有 studioId（说不清是哪家店）→ false：杀进程这种踢人下线的事，说不清就绝不动手；
 *  - 这个人在特批表里 → 按他本人的值（本店关着也能单独打开，本店开着也能单独关掉）；
 *  - 不在特批表里 → **跟随本店开关**（老行为，一个字节都不变）。
 */
export async function resolveCompanionBlacklistEnabled(
  prisma: PrismaLike,
  studioId: string | null | undefined,
  companionId: string | null | undefined,
): Promise<boolean> {
  if (!studioId) return false;
  try {
    const values = await resolveConfigs(prisma as any, studioId, [
      'blacklist.enabled',
      'blacklist.companion_overrides',
    ]);
    if (companionId) {
      const overrides = normalizeCompanionOverrides(values['blacklist.companion_overrides']);
      if (Object.prototype.hasOwnProperty.call(overrides, companionId)) {
        return overrides[companionId] === true;
      }
    }
    return truthy(values['blacklist.enabled']);
  } catch {
    return false;
  }
}
