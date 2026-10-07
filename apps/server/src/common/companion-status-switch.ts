import { PrismaService } from '../prisma/prisma.service';

/**
 * 改陪玩状态 + 维护计时日志 —— 服务端改状态的统一入口（老板 2026-10-07）。
 *
 * 为什么要有它：看板的「接单率 = 接单时长 ÷ 在线时长」和陪玩端「今日接单时长」，
 * 都是从 CompanionTimeLog 里按 mode 取数。以前服务端自己改状态（开始服务把陪玩置成
 * 「接单中」、结束服务放回「空闲」、掉线置离线……）全是裸 update —— 只改 Companion.status，
 * 不碰计时日志。于是日志里**根本不存在 mode=BUSY 的段**：接单时长永远是 0，
 * 运营看板的接单率永远显示 0%（老板 2026-10-07 看到「今日单量 7 单 / 接单率 0%」）。
 * 另一头，客户端主动切状态那条路（ws.gateway 的 companion:status / applyStatusChange）
 * 是会写日志的 —— 两条路各写各的，才出现「一半有日志、一半没有」。
 *
 * 这里把「关掉上一段 + 开一段新的 + 改库里的状态」收成一步，服务端谁改状态都走它。
 * 客户端主动切状态那条路走 CompanionsService.applyStatusChange（同样维护日志）。
 *
 * @returns 是否真的改了状态（状态没变 / 人不存在 / 落库失败 → false，
 *          调用方据此决定要不要广播）
 */
export async function switchCompanionStatus(
  prisma: PrismaService,
  companionId: string | null | undefined,
  nextStatus: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!companionId) return false;

  let current: string | null = null;
  try {
    const row = await prisma.companion.findUnique({
      where: { id: companionId },
      select: { status: true },
    });
    current = row?.status ?? null;
  } catch {
    return false;
  }
  if (!current) return false;
  // 状态没变就当没这回事 —— 不然每调一次就把计时/计费重开一段。
  if (current === nextStatus) return false;

  // 先关掉上一段（还没结束的那条），再接上新的这一段。
  // 日志写不进去也不能挡住状态切换 —— 状态本身才是黑名单/抢单依赖的东西。
  try {
    const openLog = await prisma.companionTimeLog.findFirst({
      where: { companionId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (openLog) {
      const elapsed = Math.max(0, Math.round((now.getTime() - new Date(openLog.startedAt).getTime()) / 1000));
      await prisma.companionTimeLog.update({
        where: { id: openLog.id },
        data: { endedAt: now, durationSeconds: elapsed },
      });
    }
    await prisma.companionTimeLog.create({
      data: { companionId, mode: nextStatus, startedAt: now, endedAt: null, durationSeconds: 0 },
    });
  } catch {
    /* 计时日志失败不影响状态切换 */
  }

  try {
    await prisma.companion.update({ where: { id: companionId }, data: { status: nextStatus } });
    return true;
  } catch {
    return false;
  }
}

/**
 * 只把「还没结束的那段日志」封口，不动状态。
 * 给「状态早就不是那个了、但日志还开着」的补漏场景用。
 */
export async function closeOpenTimeLog(
  prisma: PrismaService,
  companionId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const openLog = await prisma.companionTimeLog.findFirst({
      where: { companionId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!openLog) return;
    const elapsed = Math.max(0, Math.round((now.getTime() - new Date(openLog.startedAt).getTime()) / 1000));
    await prisma.companionTimeLog.update({
      where: { id: openLog.id },
      data: { endedAt: now, durationSeconds: elapsed },
    });
  } catch {
    /* 补漏失败不影响主流程 */
  }
}
