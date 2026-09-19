import { PrismaService } from '../prisma/prisma.service';

/**
 * 服务结束后把陪玩放回「空闲」。
 *
 * 为什么要专门做这一步：结束会话只是把 orderSession 标成 DONE，陪玩本身的 status
 * 不会自己变回来。以前靠两个兜底任务（60 秒扫一次「BUSY 但没有进行中会话」）慢慢纠，
 * 结果陪玩点完「结束」之后还会挂着一分钟的「接单中」，而急单/广播只推给空闲的人，
 * 等于结束服务后还要白等一分钟才收得到新单。
 *
 * 这里在结束的那一刻直接放回空闲；只有确实没有别的进行中会话时才放，
 * 避免副陪还在服务、或者一个人同时挂两单时被误标成空闲。
 *
 * @returns 是否真的改了状态（调用方可以据此决定要不要广播）
 */
export async function releaseCompanionIfIdle(
  prisma: PrismaService,
  companionId?: string | null,
  excludeSessionId?: string,
): Promise<boolean> {
  if (!companionId) return false;

  const stillActive = await prisma.orderSession
    .findFirst({
      where: {
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
        status: 'ACTIVE',
        startedAt: { not: null },
        OR: [{ companionId }, { coCompanionId: companionId }],
      },
      select: { id: true },
    })
    .catch(() => null);
  if (stillActive) return false;

  const companion = await prisma.companion
    .findUnique({ where: { id: companionId }, select: { status: true } })
    .catch(() => null);
  // 只处理「接单中」：娱乐中/休息中的人不该被这里改掉。
  if (companion?.status !== 'BUSY') return false;

  await prisma.companion
    .update({ where: { id: companionId }, data: { status: 'AVAILABLE' } })
    .catch(() => {});
  return true;
}
