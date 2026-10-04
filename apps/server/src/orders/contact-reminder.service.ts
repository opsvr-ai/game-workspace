import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';

/**
 * 客户微信「添加成功 / 添加失败」定期提醒（老板 2026-10-04）
 *
 * 老板口径（原话）：
 *   「客户真通过了、要打单，陪玩必须点添加成功才能在客户管理里找到这个客户、点开始首单；
 *     他要是真忘记，系统会定期提醒他。除非真的好几天客户都没通过，那就是客户真的不通过了，
 *     这时候管理端给对应删除这个客户即可。」
 *   再往后（老板补充）：「你收回来也没用，顶多让管理端去对应的小红书找到该客户、
 *     通过小红书去问问客户、看看客户回不回，才能定；客户小红书也不回，
 *     那只能把这个客户信息封存起来了，找合适的时候再找别的陪玩加加试试。」
 *
 * 所以这个服务**只提醒、绝不自动收回**，也不动名额。
 *
 * 提醒节奏（老板 2026-10-04 简化）：「别搞这么复杂，先 24h 提醒一次，后期直接 7 天提醒一次」——
 *   ① 陪玩本人：抢到单后 contactStatus 还是空（既没点「添加成功」也没点「添加失败」），
 *      **满 24 小时提醒一次、满 7 天再提醒一次**（就两次）；积压的老单直接跳到当前该到的节点、
 *      只弹一次；已经有服务会话的单不再催。
 *   ② 管理端待办：**只在满 7 天时**留一条（按工作室汇总成一条），
 *      带上「订单号 + 陪玩 + 客户微信 + 来源平台/小红书账号」，让人能去小红书私信客户问一问；
 *      客户也不回就在「客户管理」把这客户封存，以后再换陪玩加。
 *
 * 进度记在 order.customFields.contactReminder = { stage, lastAt, adminNotified: [4320, 10080] }，
 * 不新增数据库列（部署脚本只做 prisma generate，不跑迁移）。
 */
@Injectable()
export class ContactReminderService implements OnModuleInit {
  /**
   * 陪玩本人提醒节点（分钟）：**24 小时一次、满 7 天再一次**，就两次。
   *
   * 老板 2026-10-04：「别搞这么复杂，先 24h 提醒一次，后期直接 7 天提醒一次」——
   * 以前是 1h / 6h / 24h / 48h / 72h 五个节点，太吵。
   */
  private static readonly PLAYER_LADDER_MINUTES = [24 * 60, 7 * 24 * 60];
  /**
   * 管理端待办节点（分钟）：**只留满 7 天这一档**。
   *
   * 满 7 天还没标记 → 陪玩这边基本没戏了，管理端去小红书问一下客户、
   * 问不到就把客户封存，别让单一直挂着。24 小时那一档不打扰管理端。
   */
  private static readonly ADMIN_NUDGE_MINUTES = [7 * 24 * 60];
  /** 管理端汇总通知里最多列几条明细。 */
  private static readonly MAX_LISTED = 10;

  private readonly logger = new Logger(ContactReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: WsGateway,
  ) {}

  onModuleInit() {
    // 提醒本身就是「小时级」的，扫太勤没意义；10 分钟一轮足够。
    setInterval(() => this.tick().catch(() => {}), 10 * 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 45 * 1000);
  }

  async tick() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['GRABBED', 'CONFIRMED'] },
        contactStatus: null,
        companionId: { not: null },
      },
      select: {
        id: true,
        orderCode: true,
        studioId: true,
        companionId: true,
        grabbedAt: true,
        createdAt: true,
        customFields: true,
        customer: { select: { wechatId: true, customerCode: true, platform: true, platformAccount: true } },
        companion: { select: { user: { select: { displayName: true, username: true } } } },
        _count: { select: { sessions: true } },
      },
    });
    if (!orders.length) return;

    const now = Date.now();
    // 管理端按「工作室 + 哪一档」汇总：一轮里同一个店的同一档只发一条，别一次弹一屏。
    const groups = new Map<string, { studioId: string | null; minutes: number; entries: any[] }>();
    for (const order of orders) {
      try {
        await this.remindIfDue(order as any, now, groups);
      } catch {
        /* 单条失败不影响其它单 */
      }
    }
    for (const group of groups.values()) {
      try {
        await this.flushEscalation(group);
      } catch {
        /* 汇总通知失败不影响提醒本身 */
      }
    }
  }

  private async remindIfDue(
    order: any,
    now: number,
    groups: Map<string, { studioId: string | null; minutes: number; entries: any[] }>,
  ) {
    // 已经有服务会话的（说明单子早走下去了）就别再催他标记，免得变成噪音。
    if (order?._count?.sessions) return;

    const cf = (order.customFields as any) || {};
    const state = (cf.contactReminder as any) || {};
    const base = (order.grabbedAt ? new Date(order.grabbedAt) : new Date(order.createdAt)).getTime();
    const elapsedMin = (now - base) / 60000;
    const hours = Math.floor(elapsedMin / 60);
    const code = order.orderCode || order.id;

    const nextState: any = { ...state };
    let changed = false;

    // ① 陪玩本人
    const ladder = ContactReminderService.PLAYER_LADDER_MINUTES;
    const stage = Number(state.stage) || 0;
    if (stage < ladder.length) {
      // 直接跳到「当前时间已经跨过」的最高节点：积压的老单只提醒一次，
      // 不会因为一轮只前进一格、被连弹 5 遍。
      let next = stage;
      while (next < ladder.length && elapsedMin >= ladder[next]) next += 1;
      if (next > stage) {
        const total = ladder.length;
        const head = next === 1 ? '' : `（第 ${next} 次提醒）`;
        const message =
          `${head}订单 ${code}：你还没标记「添加成功 / 添加失败」。加完客户微信请点「添加成功」，` +
          `客户一直不通过就点「添加失败」；不标记的话这个客户不会进你的客户管理，也没法开始首单。`;
        if (order.companionId) {
          this.wsGateway.pushToCompanion(order.companionId, 'order:contact_reminder', {
            orderId: order.id,
            orderCode: order.orderCode || null,
            customerWechat: order.customer?.wechatId || null,
            stage: next,
            total,
            elapsedHours: hours,
            message,
          });
        }
        nextState.stage = next;
        nextState.lastAt = new Date(now).toISOString();
        changed = true;
        this.logger.log(`客户微信提醒：订单 ${code} 第 ${next}/${total} 次（已过 ${hours} 小时）`);
      }
    }

    // ② 管理端待办：满 7 天一次（只记录，不自动收单）
    const notified: number[] = Array.isArray(state.adminNotified) ? [...state.adminNotified] : [];
    for (const minutes of ContactReminderService.ADMIN_NUDGE_MINUTES) {
      if (elapsedMin >= minutes && !notified.includes(minutes)) {
        notified.push(minutes);
        this.collectEscalation(order, minutes, hours, groups);
      }
    }
    if (notified.length > (Array.isArray(state.adminNotified) ? state.adminNotified.length : 0)) {
      nextState.adminNotified = notified;
      changed = true;
    }

    if (!changed) return;
    await this.prisma.order
      .update({ where: { id: order.id }, data: { customFields: { ...cf, contactReminder: nextState } } })
      .catch(() => {});
  }

  /** 把「这单挂了 N 分钟」记进本店 + 本档那一组，等本轮扫完汇总发一条。 */
  private collectEscalation(
    order: any,
    minutes: number,
    hours: number,
    groups: Map<string, { studioId: string | null; minutes: number; entries: any[] }>,
  ) {
    const key = `${order.studioId || '__global__'}|${minutes}`;
    if (!groups.has(key)) groups.set(key, { studioId: order.studioId ?? null, minutes, entries: [] });
    groups.get(key)!.entries.push({
      orderId: order.id,
      orderCode: order.orderCode || null,
      companionName: this.companionName(order),
      customerWechat: order.customer?.wechatId || null,
      platform: order.customer?.platform || null,
      platformAccount: order.customer?.platformAccount || null,
      hours,
    });
  }

  /** 管理端待办一条汇总：客服 / 店长 / 老板各推一份（前端只记进通知中心，不弹窗）。 */
  private async flushEscalation(group: { studioId: string | null; minutes: number; entries: any[] }) {
    const entries = group.entries;
    if (!entries.length) return;
    const shown = entries.slice(0, ContactReminderService.MAX_LISTED);
    const lines = shown.map((e) => {
      const source = e.platformAccount
        ? `${e.platform || '平台'} @${e.platformAccount}`
        : e.platform || '来源没记';
      return `· 订单 ${e.orderCode || e.orderId}（${e.companionName}，客户微信 ${e.customerWechat || '没留'}，来自 ${source}）`;
    });
    if (entries.length > shown.length) lines.push(`…还有 ${entries.length - shown.length} 个`);

    const longPending = group.minutes >= 7 * 24 * 60;
    const kind = longPending ? 'LONG_PENDING' : 'NOT_PASSED';
    const what = '满 7 天还是没标记「添加成功 / 添加失败」';
    const how =
      '去对应的小红书账号私信问问客户还加不加；客户也不回，就在「客户管理」把客户封存起来，以后再换陪玩加';
    const message = `有 ${entries.length} 个客户${what}（不自动收单，人工决定）。${how}：\n${lines.join('\n')}`;

    const payload = {
      kind,
      count: entries.length,
      minutes: group.minutes,
      orders: entries,
      createdAt: new Date().toISOString(),
      message,
    };
    const reviewers = await this.findReviewers(group.studioId);
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser(reviewer.id, 'order:contact_reminder_admin', payload);
    }
    this.logger.log(
      `客户微信提醒：已汇总进管理端待办 ${entries.length} 单（${kind}，工作室 ${group.studioId || '全局'}）`,
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