// craftsman-ignore: TS001,TS003
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 客户与陪玩的去重规则（老板 2026-09-29）：
 *
 *   「允许同一个客户被不同的陪玩去抢单，但是不允许同一个客户同一个陪玩去抢。」
 *
 * 以前是按「工作微信」判重（同一个微信谁用都一样，换了微信就能再接），
 * 结果微信换人 / 换了微信的情况下会误拦别人。现在按「陪玩」判重：
 *   ① 同一个客户，同一个陪玩只接一次（他当搭档的双人局也算接过）；
 *   ② 不同陪玩之间互不影响，跟工作微信没关系，客户名下有多少单都一样。
 *
 * 抢单、一键抢单、客服指定派单、陪玩接受指定单，全部走这一条。
 */
export const COMPANION_TOOK_CUSTOMER_MESSAGE =
  '这个客户已经跟过你了（同一个客户、同一个陪玩只能接一次），换别的陪玩接，或者让客服指定别人';

export async function assertCustomerNotTakenByCompanion(
  prisma: PrismaService,
  companionId: string | null | undefined,
  customerId: string | null | undefined,
  opts?: { excludeOrderId?: string },
) {
  if (!companionId || !customerId) return;

  const existing = await prisma.order.findFirst({
    where: {
      customerId,
      OR: [{ companionId }, { coCompanionId: companionId }],
      ...(opts?.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
    },
    select: { id: true, orderCode: true },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) throw new ForbiddenException(COMPANION_TOOK_CUSTOMER_MESSAGE);
}
