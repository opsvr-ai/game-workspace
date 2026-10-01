// craftsman-ignore: TS001,TS003
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 「同一个微信不能抢同一个客户」（老板 2026-09-29 定的口径）：
 *
 *   「每个陪玩绑定一个微信，说白了就是同一个微信不能抢同一个客户，比如陪玩之前抢过的某个订单是这个客户的，
 *    他如果还是用这个微信去抢单就要提示；如果陪玩更换了新的工作微信，那么可以继续抢。」
 *
 * 老板 2026-10-02 补：「并不是复用，是同一个客户咨询了我好几个小红书矩阵并留下微信号，发布订单的时候完全可以发 3 单，
 *   只要被不同的陪玩（工作微信不同）接走。」
 *
 *   —— 所以「同一个客户」**不能按客户档案编号算**：同一个微信号在客户管理里可能挂着好几条档案
 *   （客服每发一张单就新建一条，这是允许的、正常的），它们其实是同一个客户，必须按**微信号**串起来判重。
 *
 * 老板 2026-10-02 定方案 B（保持只按微信，不再按人兜底）：
 *
 *   「保持只按微信 —— 那就得去「工作微信 → 陪玩工作微信」把每个人的号绑上，绑一个生效一个」
 *   「抢单时如果不绑定工作微信，提示抢不了，提示去绑定工作微信」
 *
 *   —— 所以：**没绑工作微信 = 抢不了单**，直接拦下并提示去绑定（`noWorkWechatMessage`，绑定在管理端「工作微信 → 陪玩工作微信」，教陪玩找店长 / 客服）。
 *      老单上没写工作微信、或以前没绑微信时留下的记录，一律不参与判重（判重只认微信号，不认人）。
 *
 * 只管陪玩自己**抢**的两条路：抢单 grab / 一键抢单 quick-grab。
 * 客服指定派单 assign / 陪玩接受指定单 accept-assignment 是「客服点名要的人」，不算抢，
 * 特意不判重 —— 老客户回头、客服想把单派回给原来那个陪玩时要能派得出去。
 */
export const noWorkWechatMessage = () =>
  '还没绑定工作微信，现在抢不了单；请让店长 / 客服到「工作微信 → 陪玩工作微信」帮你绑定后再抢';

export const wechatTookCustomerMessage = (wechat: string) =>
  `你的工作微信「${wechat}」已经接过这个客户了，换新的工作微信后可以再接`;

export async function assertCustomerNotTakenByCurrentWechat(
  prisma: PrismaService,
  companionId: string | null | undefined,
  customerId: string | null | undefined,
  orderWechat?: string | null,
) {
  if (!companionId || !customerId) return;

  const [bound, customer] = await Promise.all([
    prisma.workWechat
      .findUnique({ where: { companionId }, select: { wechatId: true } })
      .catch(() => null),
    prisma.customer
      .findUnique({ where: { id: customerId }, select: { wechatId: true } })
      .catch(() => null),
  ]);
  const myWechat = String(bound?.wechatId || '').trim();

  // 没绑工作微信 → 抢不了单，提示去「工作微信 → 陪玩工作微信」绑定（老板 2026-10-02 方案 B）
  if (!myWechat) throw new ForbiddenException(noWorkWechatMessage());

  const wechat = String(customer?.wechatId || orderWechat || '').trim();

  // 同一个微信号 = 同一个客户：把这个微信号名下的客户档案全串起来（客服每发一张单会新建一条档案）
  const customerIds: string[] = [customerId];
  if (wechat) {
    const rows = await prisma.customer
      .findMany({ where: { wechatId: wechat }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    for (const row of rows || []) {
      if (row?.id && !customerIds.includes(row.id)) customerIds.push(row.id);
    }
  }

  const history =
    (await prisma.order.findMany({
      where: {
        // 只看「已经被人接走」的单：还没人接的单上不会有工作微信
        companionId: { not: null },
        OR: [
          { customerId: { in: customerIds } },
          // 老单 / 客户档案上没写微信号的，退回按订单上客服填的客户微信比
          ...(wechat ? [{ customFields: { path: ['customerWechat'], equals: wechat } }] : []),
        ],
      },
      select: { companionId: true, customFields: true },
    })) || [];

  const workWechatOf = (o: any) => String(((o?.customFields as any) || {}).workWechatName || '').trim();

  // 这个工作微信接过这个客户 → 拦（换了新微信就放行）
  if (history.some((o) => workWechatOf(o) === myWechat)) {
    throw new ForbiddenException(wechatTookCustomerMessage(myWechat));
  }
}
