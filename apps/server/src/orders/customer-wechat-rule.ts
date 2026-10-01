// craftsman-ignore: TS001,TS003
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 「同一个微信不能抢同一个客户」（老板 2026-09-29 定的口径）：
 *
 *   「每个陪玩绑定一个微信，说白了就是同一个微信不能抢同一个客户，比如陪玩之前抢过的某个订单是这个客户的，
 *    他如果还是用这个微信去抢单就要提示；如果陪玩更换了新的工作微信，那么可以继续抢。」
 *
 * 老板 2026-10-02 补充（胡程硕把同一个客户的两张单都抢走了的现场）：
 *
 *   「并不是复用，是同一个客户咨询了我好几个小红书矩阵并留下微信号，发布订单的时候完全可以发 3 单，
 *    只要被不同的陪玩（工作微信不同）接走。」
 *
 *   —— 所以「同一个客户」**不能按客户档案编号算**：同一个微信号在客户管理里可能挂着好几条档案
 *   （客服每发一张单就新建一条，这是允许的、正常的），它们其实是同一个客户，必须按**微信号**串起来判重。
 *
 * 判重怎么判：
 *   ① 订单被接下时，会把当时绑定的工作微信写进订单的 `customFields.workWechatName`；
 *   ② 拿陪玩**当前**绑定的工作微信去比：同一个微信号接过这个客户就拦 → 换了新微信可以继续抢；
 *   ③ 线上到目前为止**没有任何陪玩绑过工作微信**（老板 2026-10-02 现场核查：9 个微信号里绑给陪玩的 0 个），
 *      历史单上也就没有微信可比 —— 这时退回按**陪玩**判：同一个陪玩不能在同一个客户身上接第二张单。
 *      没有这条兜底，整条规则会一直空转（胡程硕一个人把同一个客户的两张单都抢了就是这么来的）。
 *
 * 只管陪玩自己**抢**的两条路：抢单 grab / 一键抢单 quick-grab。
 * 客服指定派单 assign / 陪玩接受指定单 accept-assignment 是「客服点名要的人」，不算抢，
 * 特意不判重 —— 老客户回头、客服想把单派回给原来那个陪玩时要能派得出去。
 */
export const wechatTookCustomerMessage = (wechat: string) =>
  `你的工作微信「${wechat}」已经接过这个客户了，换新的工作微信后可以再接`;

/** 没绑工作微信时按陪玩判重的提示（没有微信号可写，口径同上）。 */
export const companionTookCustomerMessage = () =>
  '你已经接过这个客户了，同一个客户不能接两次；换新的工作微信后可以再接';

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

  // ① 这个工作微信接过这个客户 → 拦（换了新微信就放行）
  if (myWechat && history.some((o) => workWechatOf(o) === myWechat)) {
    throw new ForbiddenException(wechatTookCustomerMessage(myWechat));
  }

  // ② 历史单上没写工作微信（当时还没绑）→ 只能按人判：同一个陪玩不能再接同一个客户
  if (history.some((o) => !workWechatOf(o) && o.companionId === companionId)) {
    throw new ForbiddenException(companionTookCustomerMessage());
  }
}
