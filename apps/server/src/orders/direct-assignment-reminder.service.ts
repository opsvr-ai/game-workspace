// craftsman-ignore: TS001,TS003
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 客服「指定」单的横幅停留时长（秒）。
 *
 * 普通新单是 15 秒一闪而过 —— 那是「广播单」，抢不到也就算了。
 * 指定单不一样：**发出去那一刻就已经是那个陪玩的单了**，不用抢，只在陪玩端「订单管理」里躺着等人点「开始首单」。
 * 陪玩在打游戏 / 人不在，15 秒一过就再也注意不到，发单客服只能干等。所以指定单给它更长的停留时间。
 */
export const DIRECT_ALERT_SECONDS = 45;

/**
 * 「客服指定给你的单，还没点开始首单」多喊几遍（老板 2026-10-06）。
 *
 * 老板原话：「指定到某个陪玩，直接进订单管理，陪玩有时候可能注意不到，能不能做一下提示」。
 *
 * 这道提醒**只针对客服「指定」单**（`dispatchType=DIRECT`）：
 *   · 发布那一刻横幅弹一次（见 `OrdersService.create`，`_direct: true`）；
 *   · 之后还没点「开始首单」，就在第 5 / 10 / 20 分钟**再各弹一遍**（同一张单最多再弹 3 遍）；
 *   · 他点了「开始首单」、报了结果、退了款 / 取消了、或者单转给别人，这里立刻停 ——
 *     判据和「抢了没结果」那道提醒同一套（`sessions` 里还没有 `startedAt`）。
 *   · 20 分钟之后不再补喊，交给 `UnstartedOrderReminderService` 的「次日 + 第 7 天」那套节奏。
 *
 * 详情：
 *   · 陪玩**没上线就不算喊过**：等他的客户端一连回来，下一轮（60 秒一次）立刻补喊一条，
 *     不会出现「人不在 → 三次全错过 → 一张单没人管」。
 *   · 一轮里几个时间点一起到（比如他离线到第 25 分钟才回来）**只喊一条**，不会一次叠三条横幅。
 *   · 「已喊过哪几个时间点」记在内存里即可：服务重启顶多多喊一条 / 少喊一条，不会漏单、不写数据库。
 */
@Injectable()
export class DirectAssignmentReminderService implements OnModuleInit {
  /** 再喊的时间点（分钟，从下单那一刻算起）。 */
  private static readonly NUDGE_MINUTES = [5, 10, 20];
  /** 只看最近 2 小时指定的单：更早的交给「次日 / 第 7 天」那套。 */
  private static readonly LOOKBACK_MS = 2 * 60 * 60 * 1000;

  /** `orderId:companionId` -> 已经喊过的时间点（毫秒换算成分钟）。 */
  private readonly sent = new Map<string, Set<number>>();

  private readonly logger = new Logger(DirectAssignmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    // 分钟级的提醒，30 秒扫一轮就够细；启动后 30 秒先扫一次（别等满一分钟）。
    const safeTick = () =>
      this.tick().catch((e) => this.logger.warn(`指定单补喊扫描失败：${(e as Error)?.message}`));
    setInterval(safeTick, 30 * 1000);
    setTimeout(safeTick, 30 * 1000);
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const since = new Date(now - DirectAssignmentReminderService.LOOKBACK_MS);
    const orders = await this.prisma.order.findMany({
      where: {
        dispatchType: 'DIRECT',
        status: 'GRABBED',
        companionId: { not: null },
        refundedAt: null,
        outcome: null,
        createdAt: { gte: since },
        // 还没点「开始首单」= 一段带 startedAt 的会话都没有；已经打了的不再喊。
        sessions: { none: { startedAt: { not: null } } },
      },
      select: {
        id: true,
        orderCode: true,
        companionId: true,
        coCompanionId: true,
        createdAt: true,
        grabbedAt: true,
        // 下面这几个是横幅正文要用的（游戏名 · 机密/绝密 · 单双陪、金额、时长）——
        // 少选一个横幅就会显示成「新订单 / ¥0」，所以跟 `create` 推的那条 payload 保持同一批字段。
        gameName: true,
        serviceType: true,
        amount: true,
        duration: true,
        customFields: true,
        csUser: { select: { username: true, role: true } },
      },
      take: 300,
    });

    const live = new Set<string>();
    for (const order of orders) {
      const companionId = order.companionId as string | null;
      if (!companionId) continue;
      const key = `${order.id}:${companionId}`;
      live.add(key);

      const elapsedMin = Math.floor(
        (now - new Date(order.grabbedAt || order.createdAt).getTime()) / 60000,
      );
      const nodes = DirectAssignmentReminderService.NUDGE_MINUTES;
      let done = this.sent.get(key);
      if (!done) {
        // 第一次见到这张单（服务刚启动时的存量单、或者刚转给别人）：只把已经过去的节点记上，不补喊，
        // 免得部署完 / 转让完一下子把前面几个时间点全弹出来。
        done = new Set(nodes.filter((m) => elapsedMin >= m));
        this.sent.set(key, done);
        continue;
      }

      const due = nodes.filter((m) => elapsedMin >= m && !done.has(m));
      if (!due.length) continue;
      // 人不在就别记账，等他上线的那一轮再喊（见类注释）。
      if (!this.wsGateway.isCompanionConnected(companionId)) continue;
      // 已经到点的节点一次全记上：多个时间点一起到也只喊一条，不叠横幅。
      due.forEach((m) => done!.add(m));

      this.logger.log(
        `指定单补喊：订单 ${order.orderCode || order.id} → 陪玩 ${companionId}（第 ${due.join(' / ')} 分钟）`,
      );
      try {
        this.wsGateway.notifyCompanion(companionId, 'order:urgent', {
          ...order,
          _createdBy: order.csUser?.username || '客服',
          _creatorRole: order.csUser?.role || 'CS',
          _popupSeconds: DIRECT_ALERT_SECONDS,
          _direct: true,
          // 标记「这是补喊的」，前端 / 客户端以后想单独渲染时用得上（现在跟第一次长得一样，只是再弹一遍）。
          _directReminder: true,
        });
      } catch {
        /* 一个人失败不影响其它人 */
      }
    }

    // 单子开始了 / 取消了 / 出窗口了 → 把记录清掉，别让 Map 无限长。
    for (const key of [...this.sent.keys()]) {
      if (!live.has(key)) this.sent.delete(key);
    }
  }
}
