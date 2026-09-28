// craftsman-ignore: TS001,TS003
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 「同一个微信不能抢同一个客户」（老板 2026-09-29 定的口径）：
 *
 *   「每个陪玩绑定一个微信，说白了就是同一个微信不能抢同一个客户，比如陪玩之前抢过的某个订单是这个客户的，
 *    他如果还是用这个微信去抢单就要提示；如果陪玩更换了新的工作微信，那么可以继续抢。」
 *
 * 判重口径是「客户 + 工作微信」（不是「客户 + 陪玩」）：
 *   ① 订单被接下时，会把当时绑定的工作微信写进订单的 customFields.workWechatName；
 *   ② 这里拿陪玩**当前**绑定的工作微信，去这个客户的历史订单里比对：同一个微信号接过这个客户就拦；
 *   ③ 换了新的工作微信（微信号不同）就放行 —— 每个工作微信对同一个客户只接一次。
 * 微信号本身全局唯一（WorkWechat.wechatId @unique），所以比微信号就是比「这同一个微信」。
 *
 * 只管陪玩自己**抢**的两条路：抢单 grab / 一键抢单 quick-grab。
 * 客服指定派单 assign / 陪玩接受指定单 accept-assignment 是「客服点名要的人」，不算抢，
 * 特意不判重 —— 老客户回头、客服想把单派回给原来那个陪玩时要能派得出去。
 */
export const wechatTookCustomerMessage = (wechat: string) =>
  `你的工作微信「${wechat}」已经接过这个客户了，换新的工作微信后可以再接`;

export async function assertCustomerNotTakenByCurrentWechat(
  prisma: PrismaService,
  companionId: string | null | undefined,
  customerId: string | null | undefined,
) {
  if (!companionId || !customerId) return;

  const bound = await prisma.workWechat.findUnique({
    where: { companionId },
    select: { wechatId: true },
  });
  const wechat = (bound?.wechatId || '').trim();
  if (!wechat) return; // 还没绑工作微信，判不了，放行

  const history = await prisma.order.findMany({
    where: { customerId },
    select: { customFields: true },
  });
  const taken = history.some(
    (o) => String(((o.customFields as any) || {}).workWechatName || '').trim() === wechat,
  );
  if (taken) throw new ForbiddenException(wechatTookCustomerMessage(wechat));
}
