// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';
import { ExcellenceService } from '../companions/excellence.service';
import { logger } from '../common/logger';
import { stripCustomerSourceDeep } from '../common/order-privacy';

/**
 * 「事件语义层」——原 ws.gateway.ts 的 outbound 段整体搬到这里。
 *
 * 这里只负责「这个事件该发给谁、payload 要不要脱敏」，不负责连接 / 握手 / 房间编排；
 * 房间编排见 WsConnectionService，网关只保留 @SubscribeMessage 入口与公开方法委托。
 *
 * server 实例由网关在构造时通过 attach() 注入取址回调：@WebSocketServer 要等
 * Nest 完成注入才有值，构造期拿不到实例，所以不能直接把 Server 传进来。
 */
export interface WsEmitterRuntime {
  getServer: () => Server;
  /** 转发给网关自己的公开方法，保留「调用方可以覆盖 notifyUser」的老行为（见 review-notice 测试）。 */
  notifyUser: (userId: string, event: string, data: unknown) => void;
  notifyCompanion: (companionId: string, event: string, data: unknown) => void;
  isCompanionConnected: (companionId: string) => boolean;
}

@Injectable()
export class WsEmitterService {
  private runtime: WsEmitterRuntime | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridgeService: BridgeService,
    private readonly excellence: ExcellenceService,
  ) {}

  attach(runtime: WsEmitterRuntime): void {
    this.runtime = runtime;
  }

  private get r(): WsEmitterRuntime {
    if (!this.runtime) throw new Error('WsEmitterService runtime not attached');
    return this.runtime;
  }

  private get server(): Server {
    return this.r.getServer();
  }

  sendCommand(companionId: string, command: string, params?: unknown): boolean {
    if (!this.r.isCompanionConnected(companionId)) {
      logger.warn('SEND pc:command FAILED (offline)', { companionId, command });
      return false;
    }
    logger.debug('SEND pc:command', { companionId, command, params });
    // 客户端主进程目前按平铺字段处理，例如 update 需要 { command, downloadUrl, version }，
    // 因此这里不能包在 params 里，否则旧客户端收不到 downloadUrl。
    const payload: any = { command };
    if (params && typeof params === 'object') {
      Object.assign(payload, params);
    }
    this.server.to(`companion:${companionId}`).emit('pc:command', payload);
    return true;
  }

  pushOrder(companionId: string, order: unknown): void {
    logger.info('SEND order:new', { companionId, orderId: (order as any)?.id });
    // 陪玩端一律不收「客户来源 / 来源账号」（老板 2026-09-29「陪玩端 隐藏 客户小红书信息」）：
    // 这条通道只发给陪玩，所以在这里统一摘掉，不用每个调用点各记一次。
    this.server.to(`companion:${companionId}`).emit('order:new', stripCustomerSourceDeep(order));
  }

  pushToCompanion(companionId: string, event: string, data: unknown): void {
    this.server.to(`companion:${companionId}`).emit(event, stripCustomerSourceDeep(data));
  }

  /**
   * 发给**工作室房间**的事件一律先摘掉「客户来源」那一组字段
   * （来源平台 / 引流账号 / 客户昵称 / 客户账号ID —— 老板 2026-10-02：只有发单工作室的管理端能看）。
   *
   * 为什么工作室房间也要摘：房间成员不只是发单工作室自己的人 —— 桥接工作室的用户连上来时
   * 会把 `studio:<对方工作室>` 也 join 上（见 onConnection），所以房间里混着接单方。
   * 这些事件在前端只是「刷新一下」的信号（详情都按各自身份重新拉，见 CustomerSourceMaskInterceptor），
   * 所以摘掉不影响功能，只是别让数据在推送里裸奔。
   */
  private stripSource<T>(data: T): T {
    return stripCustomerSourceDeep(data);
  }

  broadcastToStudio(studioId: string, event: string, data: unknown): void {
    this.server.to(`studio:${studioId}`).emit(event, this.stripSource(data));
  }

  async broadcastToBridgedStudios(studioId: string, event: string, data: unknown): Promise<void> {
    const safe = this.stripSource(data);
    this.server.to(`studio:${studioId}`).emit(event, safe);
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      for (const bridgedId of bridgedIds) {
        this.server.to(`studio:${bridgedId}`).emit(event, safe);
      }
    } catch (err) {
      logger.error('broadcastToBridgedStudios failed for bridged studios', {
        error: (err as Error).message,
        studioId,
        event,
      });
    }
  }

  /**
   * 「新单弹窗」该推给谁 —— **全站唯一一份规则**，本店广播和桥接推送都用它。
   *
   * 老板 2026-10-01 定的口径：
   *  - **空闲 / 挂机（休息）一律弹**，不受开关影响；
   *  - **娱乐中 / 接单中可以自己关**（娱乐中默认弹 `notifyWhileEntertainment`，
   *    接单中默认不打扰 `notifyWhileBusy`）。
   *
   * 沿革：老板 2026-09-22 定的是「空闲 + 娱乐中一律弹，只有接单中默认不打扰」；
   * 2026-10-01 又把「挂机（休息）」加进来，并把「娱乐中」也改成可自己关。
   */
  private urgentRecipientWhere(studioId: string) {
    return {
      studioId,
      // 已离职的人不再收到抢单弹窗（离职后状态会被置为 OFFLINE，这里再兜一道）
      isResigned: false,
      OR: [
        { status: 'AVAILABLE' },
        // 挂机 / 休息：老板 2026-10-01「空闲+挂机状态也照样弹」
        { status: 'RESTING' },
        { status: 'ENTERTAINMENT', notifyWhileEntertainment: true },
        { status: 'BUSY', notifyWhileBusy: true },
      ],
    };
  }

  /**
   * 广播新单（右下角弹窗抢单）。
   *
   * 收件人规则见 urgentRecipientWhere（空闲 + 娱乐中必推；接单中看本人开关）。
   * 返回实际推送人数，方便排查「为什么没人收到」。
   */
  async broadcastNewOrder(studioId: string, data: unknown): Promise<number> {
    try {
      const companions = await this.prisma.companion.findMany({
        where: this.urgentRecipientWhere(studioId),
        select: { id: true, status: true, user: { select: { username: true } } },
      });
      let sent = 0;
      const notConnected: string[] = [];
      // 陪玩端一律看不到客户来源那一组字段（老板 2026-09-29 / 2026-10-02）
      const safe = stripCustomerSourceDeep(data);
      // 谁被命中、各是什么状态：以后问「娱乐中的到底弹没弹」，直接看日志。
      const byStatus: Record<string, number> = {};
      for (const c of companions) {
        byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
        // 命中 ≠ 收到：客户端没连着的人，这条弹窗只会发进空气里。
        if (!this.r.isCompanionConnected(c.id)) {
          notConnected.push(c.user?.username || c.id);
        }
        this.server.to(`companion:${c.id}`).emit('order:urgent', safe);
        sent += 1;
      }
      // 老板 2026-09-22 报「邵泽慧发广播单，所有人都没弹窗」：这条路径以前一句日志都没有，
      // 出问题只能靠猜。现在把「命中几人 / 真正在线几人 / 谁不在线」都记下来。
      logger.info('SEND order:urgent (broadcast)', {
        studioId,
        orderCode: (data as any)?.orderCode,
        matched: sent,
        connected: sent - notConnected.length,
        byStatus,
        notConnected,
      });
      if (sent === 0) {
        logger.warn('Broadcast order reached nobody (no idle companion in studio)', {
          studioId,
          orderCode: (data as any)?.orderCode,
        });
      }
      return sent;
    } catch (err) {
      logger.error('broadcastNewOrder failed', { error: (err as Error).message, studioId });
      return 0;
    }
  }

  /** 只推送给「空闲且上等马」的线下陪玩，返回实际推送人数。 */
  async broadcastToQualifiedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    try {
      const idle = await this.prisma.companion.findMany({
        where: { studioId, status: 'AVAILABLE' },
        select: { id: true },
      });
      const safe = stripCustomerSourceDeep(data);
      let sent = 0;
      for (const c of idle) {
        if (await this.excellence.isExcellent(c.id)) {
          this.server.to(`companion:${c.id}`).emit(event, safe);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToQualifiedIdleCompanions failed', { error: (err as Error).message, studioId, event });
      return 0;
    }
  }

  /**
   * 推送给桥接工作室的陪玩，返回实际推送人数。
   * 收件人规则和本店广播**同一份**（见 urgentRecipientWhere）：桥接那边娱乐中的也能弹，
   * 接单中的同样看他自己的开关 —— 不然「娱乐中一定弹」在两个店会变成两套口径。
   */
  async broadcastToBridgedIdleCompanions(studioId: string, event: string, data: unknown): Promise<number> {
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      const safe = stripCustomerSourceDeep(data);
      let sent = 0;
      for (const bid of bridgedIds) {
        const idle = await this.prisma.companion.findMany({
          where: this.urgentRecipientWhere(bid),
          select: { id: true },
        });
        for (const c of idle) {
          this.server.to(`companion:${c.id}`).emit(event, safe);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToBridgedIdleCompanions failed', { error: (err as Error).message, studioId, event });
      return 0;
    }
  }

  /** 推送给桥接工作室中指定类型（DIRECT=线下 / RENTAL=线上俱乐部）的空闲陪玩，返回实际推送人数。 */
  async broadcastToBridgedIdleCompanionsByType(
    studioId: string,
    studioType: 'DIRECT' | 'RENTAL',
    event: string,
    data: unknown,
  ): Promise<number> {
    try {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      if (bridgedIds.length === 0) return 0;
      const studios = await this.prisma.studio.findMany({
        where: { id: { in: bridgedIds }, type: studioType },
        select: { id: true },
      });
      const safe = stripCustomerSourceDeep(data);
      let sent = 0;
      for (const st of studios) {
        const idle = await this.prisma.companion.findMany({
          where: { studioId: st.id, status: 'AVAILABLE' },
          select: { id: true },
        });
        for (const c of idle) {
          this.server.to(`companion:${c.id}`).emit(event, safe);
          sent += 1;
        }
      }
      return sent;
    } catch (err) {
      logger.error('broadcastToBridgedIdleCompanionsByType failed', {
        error: (err as Error).message,
        studioId,
        studioType,
        event,
      });
      return 0;
    }
  }

  /**
   * 「广播」发单时，桥接工作室那边也弹一次抢单窗。
   * 为了不打乱订单池的里程碑（上等马 → 桥接 → 中等马 ……），
   * 这里和订单池保持一致：等「桥接工作室等待」到了才弹，本店陪玩仍然先有这段先手。
   * 弹之前会重新确认订单还没被人抢走，避免弹一个已经被接掉的单。
   */
  async broadcastUrgentToBridgedStudios(
    studioId: string,
    orderId: string,
    data: unknown,
    delayMs: number,
  ): Promise<number> {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const fresh = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, companionId: true, claimedCsUserId: true },
      });
      if (!fresh || fresh.status !== 'PENDING' || fresh.companionId || fresh.claimedCsUserId) {
        return 0;
      }
      const sent = await this.broadcastToBridgedIdleCompanions(studioId, 'order:urgent', data);
      if (sent > 0) {
        logger.info('SEND order:urgent to bridged studios', { studioId, orderId, sent });
      }
      return sent;
    } catch (err) {
      logger.error('broadcastUrgentToBridgedStudios failed', {
        error: (err as Error).message,
        studioId,
        orderId,
      });
      return 0;
    }
  }

  notifyUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  notifyCompanion(companionId: string, event: string, data: unknown): void {
    this.server.to(`companion:${companionId}`).emit(event, stripCustomerSourceDeep(data));
  }

  /**
   * 把「有人提交了东西等你审核」推给本店客服 / 店长 + 全站老板。
   *
   * 老板 2026-10-04：「其他需要交互的地方也都双方都能提示了么」——
   * 以前只有补单做了双向实时提示，报账 / 战绩图 / 支取 / 客户删除申请这些
   * 管理端只能靠页面每 60 秒轮询的红点，陪玩端连审核结果都不知道。
   */
  async notifyStudioManagers(
    studioId: string | null | undefined,
    event: string,
    data: unknown,
  ): Promise<void> {
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN', 'CS'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    for (const u of Array.isArray(found) ? (found as any[]) : []) {
      this.r.notifyUser(u.id, event, data);
    }
  }

  /** 通用「审核 / 交互」提醒 —— 管理端一侧（本店客服 / 店长 + 全站老板）。 */
  notifyManagers(studioId: string | null | undefined, payload: Record<string, any>): void {
    void this.notifyStudioManagers(studioId, 'review:notice', { ...payload, audience: 'MGMT' });
  }

  /** 通用「审核 / 交互」提醒 —— 陪玩本人一侧（我提交的东西有结果了）。 */
  notifyCompanionNotice(companionId: string, payload: Record<string, any>): void {
    this.r.notifyCompanion(companionId, 'review:notice', { ...payload, audience: 'COMPANION' });
  }

  notifyChat(studioId: string, companionName: string, _chatKey: string, companionId?: string, orderId?: string): void {
    this.server.to(`studio:${studioId}`).emit('chat:notify', {
      companionName,
      companionId,
      orderId,
      timestamp: new Date().toISOString(),
    });
  }

  /** Notify a specific user about a new chat message (via user room) */
  notifyNewMessage(
    userId: string,
    payload: {
      conversationId: string;
      orderInfo?: string;
      message: { id: string; senderId: string; text: string; createdAt: string };
    },
  ): void {
    this.server.to(`user:${userId}`).emit('chat:message', payload);
  }

  notifyChatMessage(
    studioId: string,
    payload: {
      text: string;
      senderId: string;
      senderRole: string;
      senderName: string;
      orderId?: string | null;
      companionId?: string | null;
      timestamp: string;
    },
  ): void {
    this.server.to(`studio:${studioId}`).emit('chat:new', payload);
  }
}
