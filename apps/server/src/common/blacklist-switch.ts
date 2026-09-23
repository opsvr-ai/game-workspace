import { resolveConfigs } from './studio-config';

/**
 * 「杀进程到底动不动手」的**唯一判定**：只看**本店开关**（老板 2026-09-24 明确要求）。
 *
 * 老板原话：「不需要总闸，只需要店长自己定自己的俱乐部或者工作室是否生效就可以」。
 * 所以以前那道「全站总开关」SystemConfig.blacklist.auto_kill 已经**整条去掉**（不要再用它），
 * 现在只剩一个开关：
 *
 *   **本店开关** StudioConfig.blacklist.enabled —— 店长在「进程黑名单」页顶部自己拨。
 *   关着 = 本店名单只记录、不下发，本店陪玩一个进程都不会被结束；
 *   打开 = 本店名单照常下发给本店陪玩。各店互相独立，谁也不影响谁。
 *
 * 默认**关**（DEFAULT_CONFIGS 里也是 false）：跟去掉总闸之前的线上现状一致 ——
 * 名单只记录不杀，绝不会有店在没人拨过开关的情况下突然开始结束陪玩正在玩的游戏。
 * 店长想真的动手，自己在页面上拨开即可，一拨就当场重推名单。
 *
 * 关着（或读不到是哪家店）时，服务端下发**空名单**：客户端收到空名单会当场停掉杀进程，
 * 连没升级的老客户端也一样。
 *
 * 这里只做「读」。要改这个键只能由店长在管理端手动拨。
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

/** 「杀进程到底动不动手」的唯一判定 —— 就是本店开关。开着才下发真名单。 */
export async function isKillEffective(
  prisma: PrismaLike,
  studioId: string | null | undefined,
): Promise<boolean> {
  return resolveStudioBlacklistEnabled(prisma, studioId);
}
