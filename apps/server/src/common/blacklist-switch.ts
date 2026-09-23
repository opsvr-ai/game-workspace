import { resolveConfigs } from './studio-config';

/**
 * 「杀进程到底动不动手」的**唯一判定**（两道闸，缺一不可）：
 *
 *  1. **全站总开关** `SystemConfig.blacklist.auto_kill`（内置默认 false）——
 *     老板手动拨，一份值管全站，任何脚本 / 自动化 / 测试都不许改（2026-09-20 被脚本顺手改回
 *     「开」两次，正在打游戏的陪玩被踢下线，老板反复找不到原因）；
 *  2. **本店开关** `StudioConfig.blacklist.enabled`（内置默认 true）——
 *     店长在「进程黑名单」页自己拨：关掉 = 本店名单只记录、不下发，本店陪玩一个进程都不动。
 *     默认 true 是「行为不变」：没拨过的店继续跟着老板的总开关走。
 *
 * 两道闸都开，服务端才会把名单下发给客户端；任何一道关着都下发**空名单**
 * （客户端收到空名单会当场停掉杀进程，连没升级的老客户端也一样）。
 *
 * 这里只做「读」。要改这两个键只能由老板 / 店长在管理端手动拨。
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

/** 全站总开关（老板的）。 */
export async function resolveAutoKillEnabled(prisma: PrismaLike): Promise<boolean> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'blacklist.auto_kill' } });
    return truthy(cfg?.value);
  } catch {
    // 读不到就按「关」处理：杀进程这种会踢人下线的事，读不到配置时绝不猜成开。
    return false;
  }
}

/** 本店开关（店长的）。没填过 = 生效（与加这个开关之前的行为完全一致）。 */
export async function resolveStudioBlacklistEnabled(
  prisma: PrismaLike,
  studioId: string | null | undefined,
): Promise<boolean> {
  if (!studioId) return true;
  const values = await resolveConfigs(prisma as any, studioId, ['blacklist.enabled']);
  const value = values['blacklist.enabled'];
  return !(value === false || value === 'false');
}

/** 两道闸都开才返回 true —— 服务端据此决定下发真名单还是空名单。 */
export async function isKillEffective(
  prisma: PrismaLike,
  studioId: string | null | undefined,
): Promise<boolean> {
  const [autoKill, studioEnabled] = await Promise.all([
    resolveAutoKillEnabled(prisma),
    resolveStudioBlacklistEnabled(prisma, studioId),
  ]);
  return autoKill && studioEnabled;
}
