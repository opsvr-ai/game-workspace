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
 *
 * 所以这里**不做**超时收回、也不动名额：
 *   1) 陪玩抢到单后迟迟没标记（contactStatus 还是空 = 还没点「添加成功 / 添加失败」），
 *      按 1 小时 / 6 小时 / 24 小时 / 48 小时 / 72 小时 五个节点给他本人弹提醒；
 *      积压很久的老单只弹一次（直接跳到当前该到的节点），不会连弹 5 遍。
 *   2) 满 3 天还没处理，汇总成一条通知本店客服 / 店长 / 老板一次，
 *      让他们去核实「这客户是不是一直没通过」，确认不通过就由管理端把客户删掉。
 *   3) 陪玩一旦点了「添加成功」或「添加失败」，或这单已经产生服务会话，提醒自动停止。
 *
 * 提醒进度记在 order.customFields.contactReminder = { stage, lastAt, escalatedAt }，
 * 不新增数据库列（部署脚本只做 prisma generate，不跑迁移）。
 */
@Injectable()
export class ContactReminderService implements OnModuleInit {
  /** 提醒节点（分钟）：1 小时、6 小时、24 小时、48 小时、72 小时。 */
  private static readonly LADDER_MINUTES = [60, 6 * 60, 24 * 60, 48 * 60, 72 * 60];
  /** 满这个时长还没处理就提醒管理端（分钟）——就是最后一个节点，3 天。 */
  private static readonly ESCALATE_MINUTES = 72 * 60;
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
        customer: { select: { wechatId: true, customerCode: true } },
        companion: { select: { user: { select: { displayName: true, username: true } } } },
        _count: { select: { sessions: true } },
      },
    });
    if (!orders.length) return;

    const now = Date.now();
    // 管理端按工作室汇总：一轮里同一个店的单只发一条，别一次弹一屏。
    const groups = new Map<string, { studioId: string | null; entries: any[] }>();
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
    groups: Map<string, { studioId: string | null; entries: any[] }>,
  ) {
    // 已经有服务会话的（说明单子早走下去了）就别再催他标记，免得变成噪音。
    if (order?._count?.sessions) return;

    const cf = (order.customFields as any) || {};
    const state = (cf.contactReminder as any) || {};
    const stage = Number(state.stage) || 0;
    if (stage >= ContactReminderService.LADDER_MINUTES.length) {
      // 五个节点都提醒过了：陪玩这边不再重复打扰，只在还没升级过时补一次管理端提醒。
      await this.escalateIfNeeded(order, cf, state, now, groups);
      return;
    }

    const base = (order.grabbedAt ? new Date(order.grabbedAt) : new Date(order.createdAt)).getTime();
    const elapsedMin = (now - base) / 60000;

    // 直接跳到「当前时间已经跨过」的最高节点：积压的老单只提醒一次，
    // 不会因为一轮只前进一格、被连弹 5 遍。
    let nextStage = stage;
    while (
      nextStage < ContactReminderService.LADDER_MINUTES.length &&
      elapsedMin >= ContactReminderService.LADDER_MINUTES[nextStage]
    ) {
      nextStage += 1;
    }
    if (nextStage === stage) return;

    const total = ContactReminderService.LADDER_MINUTES.length;
    const hours = Math.floor(elapsedMin / 60);
    const code = order.orderCode || order.id;
    const head = nextStage === 1 ? '' : `（第 ${nextStage} 次提醒）`;
    const message =
      `${head}订单 ${code}：你还没标记「添加成功 / 添加失败」。加完客户微信请点「添加成功」，` +
      `客户一直不通过就点「添加失败」；不标记的话这个客户不会进你的客户管理，也没法开始首单。`;

    if (order.companionId) {
      this.wsGateway.pushToCompanion(order.companionId, 'order:contact_reminder', {
        orderId: order.id,
        orderCode: order.orderCode || null,
        customerWechat: order.customer?.wechatId || null,
        stage: nextStage,
        total,
        elapsedHours: hours,
        message,
      });
    }

    const escalateNow = elapsedMin >= ContactReminderService.ESCALATE_MINUTES;
    const nextState: any = {
      ...state,
      stage: nextStage,
      lastAt: new Date(now).toISOString(),
    };
    if (escalateNow) nextState.escalatedAt = new Date(now).toISOString();

    if (escalateNow) this.collectEscalation(order, nextState, groups);

    this.logger.log(
      `客户微信提醒：订单 ${code} 第 ${nextStage}/${total} 次（已过 ${hours} 小时）` +
        (escalateNow ? '，同时已汇总给管理端' : ''),
    );

    await this.prisma.order
      .update({ where: { id: order.id }, data: { customFields: { ...cf, contactReminder: nextState } } })
      .catch(() => {});
  }

  /** 五个节点都提醒完了，若还没升级过、时长达标，就补一次管理端提醒。 */
  private async escalateIfNeeded(
    order: any,
    cf: any,
    state: any,
    now: number,
    groups: Map<string, { studioId: string | null; entries: any[] }>,
  ) {
    if (state.escalatedAt) return;
    const base = (order.grabbedAt ? new Date(order.grabbedAt) : new Date(order.createdAt)).getTime();
    if ((now - base) / 60000 < ContactReminderService.ESCALATE_MINUTES) return;

    const nextState = { ...state, escalatedAt: new Date(now).toISOString() };
    this.collectEscalation(order, nextState, groups);
    await this.prisma.order
      .update({ where: { id: order.id }, data: { customFields: { ...cf, contactReminder: nextState } } })
      .catch(() => {});
  }

  /** 把「这单客户 3 天没处理」记进本店那一组，等本轮扫完汇总发一条。 */
  private collectEscalation(
    order: any,
    state: any,
    groups: Map<string, { studioId: string | null; entries: any[] }>,
  ) {
    const key = order.studioId || '__global__';
    if (!groups.has(key)) groups.set(key, { studioId: order.studioId ?? null, entries: [] });
    groups.get(key)!.entries.push({
      orderId: order.id,
      orderCode: order.orderCode || null,
      companionName: this.companionName(order),
      customerWechat: order.customer?.wechatId || null,
      stage: Number(state.stage) || ContactReminderService.LADDER_MINUTES.length,
    });
  }

  /** 通知本店客服 / 店长 + 老板：这些单客户几天没处理，去核实要不要删掉（一轮一条）。 */
  private async flushEscalation(group: { studioId: string | null; entries: any[] }) {
    const entries = group.entries;
    if (!entries.length) return;
    const shown = entries.slice(0, ContactReminderService.MAX_LISTED);
    const lines = shown.map(
      (e) => `· 订单 ${e.orderCode || e.orderId}（${e.companionName}，微信 ${e.customerWechat || '没留'}）`,
    );
    if (entries.length > shown.length) lines.push(`…还有 ${entries.length - shown.length} 个`);
    const message =
      `有 ${entries.length} 个客户 3 天都没标记「添加成功 / 添加失败」，客户大概率一直没通过。` +
      `去「客户管理」核实一下，确认过不了就把客户删掉，别一直挂着：\n${lines.join('\n')}`;
    const payload = {
      count: entries.length,
      orders: entries,
      escalatedAt: new Date().toISOString(),
      message,
    };

    const reviewers = await this.findReviewers(group.studioId);
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser(reviewer.id, 'order:contact_reminder_admin', payload);
    }
    this.logger.log(`客户微信提醒：已汇总通知管理端 ${entries.length} 单（工作室 ${group.studioId || '全局'}）`);
  }

  private companionName(order: any): string {
    return (
      order?.companion?.user?.displayName || order?.companion?.user?.username || '有陪玩'
    );
  }

  private async findReviewers(studioId: string | null): Promise<Array<{ id: string }>> {
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN', 'CS'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    return Array.isArray(found) ? found : [];
  }
}