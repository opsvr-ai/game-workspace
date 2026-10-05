// craftsman-ignore: TS001,TS003
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/** 「抢了 N 分钟」写成人话：48 小时以内说小时，超过就说几天。 */
function elapsedTextOf(minutes: number): string {
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours < 48 ? `${hours} 小时` : `${Math.round(hours / 24)} 天`;
}

/**
 * 「抢了单一直没点开始首单、也没报结果」定期提醒（老板 2026-10-06）
 *
 * 老板口径（原话）：
 *   「线下『加了没打成功』的判据……抢到单之后一直没点开始首单、也没退款 / 取消，
 *     就一直挂在待核清单里，直到有人核（不自动判废）。」
 *   「为什么没打成，选择原因 + 截图；或者你不处理就当天提醒，然后后边 7 天提醒。」
 *   「次日弹一次，后边第七天弹一次，然后进历史记录。」（2026-10-06 定稿，和「客户微信提醒」同一套节奏）
 *
 * 判据和「成交核对 → 抢了没结果」同一套：抢到手 + 没点「开始首单」+ 没退款 / 取消 + 没报结果，
 * 只看最近 14 天。这个服务**只提醒、不自动判废**，也不动名额、不改钱。
 *
 * 提醒节奏：**次日（满 24 小时）提醒一次、第 7 天再提醒一次，之后进历史记录不再提醒**（同一张单最多 2 次），
 * 直到他报了结果（原因 + 截图）、点了「开始首单」、单被退款 / 取消，或者转让给别人。
 *   · 发给陪玩本人：**按人汇总成一条**（这个人名下所有待处理的单列在一起，最多列 10 条 +
 *     「还有 N 单」），不按单一单一条 —— 老库里有人一口气压了 27 单，一单一条会直接把他弹屏。
 *   · 管理端：满 7 天还没处理 → 给本店客服 / 店长 / 老板留一条待办（按工作室汇总成一条）；
 *     同一时间这张单也进「成交核对 → 历史记录」，不再占着要在清单。
 *
 * 进度记在 `order.customFields.unstartedReminder = { companionId, count, sent: number[], firstAt, lastAt, adminNotified: [] }`，
 * 不新增数据库列（陪玩端 / 客服端主进程直连云上网页，服务端 + 网页改完即生效，不用发客户端）。
 */
@Injectable()
export class UnstartedOrderReminderService implements OnModuleInit {
  /**
   * 提醒节点（分钟）—— 老板 2026-10-06 定稿：
   * **次日（满 24 小时）提醒一次、第 7 天再提醒一次，之后进历史记录不再提醒。**
   */
  private static readonly NUDGE_MINUTES = [24 * 60, 7 * 24 * 60];
  /** 同一张单最多提醒 2 次（对应上面两个节点）。 */
  private static readonly MAX_REMINDERS = 2;
  /** 只看最近两周抢走的：够覆盖到「第 7 天」那次提醒；更早的属于历史烂账，由「成交核对 → 历史记录」接手。 */
  private static readonly LOOKBACK_DAYS = 14;
  /** 管理端待办节点（分钟）：**只留满 7 天这一档**（陪玩那边基本没戏了，该人工去核）。 */
  private static readonly ADMIN_NUDGE_MINUTES = [7 * 24 * 60];
  /** 汇总通知里最多列几条明细。 */
  private static readonly MAX_LISTED = 10;

  private readonly logger = new Logger(UnstartedOrderReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit(): void {
    // 提醒本身是「小时级」的，扫太勤没意义；10 分钟一轮足够。
    setInterval(() => this.tick().catch(() => {}), 10 * 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 90 * 1000);
  }

  async tick(): Promise<void> {
    const since = new Date(
      Date.now() - UnstartedOrderReminderService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['GRABBED', 'CONFIRMED'] },
        companionId: { not: null },
        refundedAt: null,
        outcome: null,
        OR: [{ grabbedAt: { gte: since } }, { grabbedAt: null, createdAt: { gte: since } }],
        // 还没点「开始首单」= 没有一段有 startedAt 的会话；已经打了的不再催。
        sessions: { none: { startedAt: { not: null } } },
      },
      select: {
        id: true,
        orderCode: true,
        studioId: true,
        companionId: true,
        grabbedAt: true,
        createdAt: true,
        customFields: true,
        customer: { select: { wechatId: true } },
        companion: { select: { user: { select: { displayName: true, username: true } } } },
      },
      take: 1000,
    });
    if (!orders.length) return;

    const now = Date.now();
    // 按接单方分组：一个人名下所有待处理的单，合成一条发给他。
    const byCompanion = new Map<string, any[]>();
    for (const order of orders) {
      const key = String(order.companionId);
      if (!byCompanion.has(key)) byCompanion.set(key, []);
      byCompanion.get(key)!.push(order as any);
    }
    // 管理端按工作室汇总：一轮里同一个店只发一条，别一次弹一屏。
    const adminGroups = new Map<string, { studioId: string | null; entries: any[] }>();
    for (const [companionId, list] of byCompanion) {
      try {
        await this.remindCompanion(companionId, list, now, adminGroups);
      } catch {
        /* 单个人失败不影响其它人 */
      }
    }
    for (const group of adminGroups.values()) {
      try {
        await this.flushEscalation(group);
      } catch {
        /* 汇总通知失败不影响提醒本身 */
      }
    }
  }

  private async remindCompanion(
    companionId: string,
    list: any[],
    now: number,
    adminGroups: Map<string, { studioId: string | null; entries: any[] }>,
  ): Promise<void> {
    const prepared: Array<{
      order: any;
      cf: any;
      state: any;
      elapsedMin: number;
      elapsedText: string;
      pendingNodes: number[];
      dirty: boolean;
    }> = [];

    for (const order of list) {
      const cf = (order.customFields as any) || {};
      const prev = (cf.unstartedReminder as any) || {};
      const nodes = UnstartedOrderReminderService.NUDGE_MINUTES;
      // 换人了（转让给别人）→ 进度从头算，别拿上一个人的。
      let state: any;
      if (prev.companionId === order.companionId) {
        // 兼容更早那版（按单一单一条、只记了 count / lastAt）：把已发过的次数折成「已提醒节点」，
        // 换版本时不会因为节点对不上而重复催一轮。
        const prevCount = Math.max(0, Number(prev.count ?? (prev.lastAt ? 1 : 0)));
        const sent = Array.isArray(prev.sent)
          ? prev.sent.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
          : nodes.slice(0, Math.min(prevCount, nodes.length));
        state = {
          ...prev,
          count: Math.min(prevCount, UnstartedOrderReminderService.MAX_REMINDERS),
          sent: [...new Set(sent)],
          adminNotified: Array.isArray(prev.adminNotified) ? [...prev.adminNotified] : [],
        };
      } else {
        state = {
          companionId: order.companionId,
          count: 0,
          sent: [],
          firstAt: null,
          lastAt: null,
          adminNotified: [],
        };
      }
      const grabbedAt = new Date(order.grabbedAt || order.createdAt).getTime();
      const elapsedMin = Math.max(0, Math.floor((now - grabbedAt) / 60000));

      // 管理端待办：满 7 天一次（只记录，不自动判废）
      let dirty = prev.companionId !== order.companionId;
      for (const minutes of UnstartedOrderReminderService.ADMIN_NUDGE_MINUTES) {
        if (elapsedMin >= minutes && !state.adminNotified.includes(minutes)) {
          state.adminNotified.push(minutes);
          this.collectEscalation(order, elapsedMin, adminGroups);
          dirty = true;
        }
      }

      // 该提醒的节点：时间到了、还没发过 → 本次的汇总提醒就带上这张单。
      const pendingNodes = nodes.filter((m) => elapsedMin >= m && !state.sent.includes(m));

      prepared.push({
        order,
        cf,
        state,
        elapsedMin,
        elapsedText: elapsedTextOf(elapsedMin),
        pendingNodes,
        dirty,
      });
    }

    // 提醒节奏：次日一次 + 第 7 天一次，之后就进历史记录、不再催；同一次扫一个人只发一条。
    const fresh = prepared.filter((p) => p.pendingNodes.length > 0);
    if (fresh.length > 0) {
      const stamp = new Date(now).toISOString();
      for (const p of fresh) {
        p.state.sent.push(...p.pendingNodes);
        p.state.count = Math.min(
          Number(p.state.count || 0) + p.pendingNodes.length,
          UnstartedOrderReminderService.MAX_REMINDERS,
        );
        p.state.firstAt = p.state.firstAt || stamp;
        p.state.lastAt = stamp;
        p.dirty = true;
      }
      this.pushDigest(companionId, fresh);
    }

    for (const p of prepared) {
      if (!p.dirty) continue;
      await this.prisma.order
        .update({
          where: { id: p.order.id },
          data: { customFields: { ...p.cf, unstartedReminder: p.state } },
        })
        .catch(() => {});
    }
  }

  /** 一个人的待处理清单一句话说完：打成了点「开始首单」，没打成点「报结果」选原因 + 贴截图。 */
  private pushDigest(companionId: string, items: Array<{ order: any; state: any; elapsedText: string }>): void {
    const shown = items.slice(0, UnstartedOrderReminderService.MAX_LISTED);
    const lines = shown.map((i) => {
      const code = i.order.orderCode || i.order.id;
      const wechat = i.order.customer?.wechatId || '没留';
      return `· 订单 ${code}（客户微信 ${wechat}，抢了 ${i.elapsedText}）`;
    });
    if (items.length > shown.length) lines.push(`…还有 ${items.length - shown.length} 单`);
    const total = items.length;
    const stage = Math.max(...items.map((i) => Number(i.state.count || 1)));
    // 只有两次提醒：第 1 次说「7 天后还有最后一次」，第 2 次就是最后一次（之后进历史记录）。
    const tail =
      stage >= UnstartedOrderReminderService.MAX_REMINDERS
        ? '（这是最后一次提醒；之后进历史记录，不再催你 —— 店长会直接照这张单核责）'
        : '（不处理的话，满 7 天会再提醒你最后一次）';
    const message =
      `你有 ${total} 个订单抢到手还没点「开始首单」、也没报结果：\n${lines.join('\n')}\n` +
      '打成了就去点「开始首单」；没打成（客户没同意 / 暂时不打 / 价格或单双陪谈不拢…）请点「报结果」，' +
      `选原因 + 贴截图 —— 店长要凭这个定责，谁的问题就去找谁。${tail}`;
    this.wsGateway.pushToCompanion(companionId, 'order:unstarted_reminder', {
      count: total,
      stage,
      maxReminders: UnstartedOrderReminderService.MAX_REMINDERS,
      orders: items.map((i) => ({
        orderId: i.order.id,
        orderCode: i.order.orderCode || null,
        customerWechat: i.order.customer?.wechatId || null,
        elapsedText: i.elapsedText,
      })),
      message,
    });
    this.logger.log(`未开始首单提醒：陪玩 ${companionId} 名下 ${total} 单（第 ${stage} 次）`);
  }

  /** 把「这单挂了 N 小时」记进本店那一组，等本轮扫完汇总发一条。 */
  private collectEscalation(
    order: any,
    elapsedMin: number,
    groups: Map<string, { studioId: string | null; entries: any[] }>,
  ): void {
    const key = order.studioId || '__global__';
    if (!groups.has(key)) groups.set(key, { studioId: order.studioId ?? null, entries: [] });
    groups.get(key)!.entries.push({
      orderId: order.id,
      orderCode: order.orderCode || null,
      companionName: this.companionName(order),
      customerWechat: order.customer?.wechatId || null,
      elapsedText: elapsedTextOf(elapsedMin),
    });
  }

  /** 管理端待办一条汇总：客服 / 店长 / 老板各推一份（前端只记进通知中心，不弹窗）。 */
  private async flushEscalation(group: { studioId: string | null; entries: any[] }): Promise<void> {
    const entries = group.entries;
    if (!entries.length) return;
    const shown = entries.slice(0, UnstartedOrderReminderService.MAX_LISTED);
    const lines = shown.map(
      (e) =>
        `· 订单 ${e.orderCode || e.orderId}（${e.companionName}，客户微信 ${e.customerWechat || '没留'}，抢了 ${e.elapsedText}）`,
    );
    if (entries.length > shown.length) lines.push(`…还有 ${entries.length - shown.length} 个`);
    const message =
      `有 ${entries.length} 个订单抢走满 7 天了，接单方一直没点「开始首单」、也没报结果（不自动判废，人工去核）。` +
      `去「订单管理 → 成交核对 → 抢了没结果」处理，问清楚为什么没打成、让他选原因 + 贴截图：\n${lines.join('\n')}`;

    const payload = {
      kind: 'UNSTARTED_ORDER',
      count: entries.length,
      orders: entries,
      createdAt: new Date().toISOString(),
      message,
    };
    const reviewers = await this.findReviewers(group.studioId);
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser(reviewer.id, 'order:unstarted_reminder_admin', payload);
    }
    this.logger.log(
      `未开始首单提醒：已汇总进管理端待办 ${entries.length} 单（工作室 ${group.studioId || '全局'}）`,
    );
  }

  private companionName(order: any): string {
    return order?.companion?.user?.displayName || order?.companion?.user?.username || '有陪玩';
  }

  private async findReviewers(studioId: string | null): Promise<Array<{ id: string }>> {
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN', 'CS'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    return Array.isArray(found) ? found : [];
  }
}
