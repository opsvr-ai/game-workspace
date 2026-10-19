// craftsman-ignore: TS001,TS003
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../studios/bridge.service';
import { ExcellenceService } from '../companions/excellence.service';
import { logger } from '../common/logger';
import { stripCustomerSourceDeep } from '../common/order-privacy';
import { resolveConfigsRaw } from '../common/studio-config';
import type { ConnectedUser } from './ws-connection.service';

/** 点对点聊天消息 payload（网关公开方法签名引用，结构不变）。 */
export interface NewMessagePayload {
  conversationId: string;
  orderInfo?: string;
  message: { id: string; senderId: string; text: string; createdAt: string };
}

/** 工作室聊天广播 payload（chat:send / notifyChatMessage 共用同一结构）。 */
export interface StudioChatPayload {
  text: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  orderId?: string | null;
  companionId?: string | null;
  timestamp: string;
}

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
   *  - **娱乐中也一律弹**，不受开关影响（2026-10-19 老板：「娱乐中也照弹不误」）；
   *  - **只有接单中**看 `notifyWhileBusy`（默认不打扰）。
   *
   * 沿革：老板 2026-09-22 定的是「空闲 + 娱乐中一律弹，只有接单中默认不打扰」；
   * 2026-10-01 又把「挂机（休息）」加进来，并曾把娱乐中改成可自己关；
   * 2026-10-19 通知设置只保留「接单中弹窗」一个开关，娱乐中恢复为无条件弹。
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
        // 娱乐中：老板 2026-10-19 明确「娱乐中也照弹不误」，不再看 notifyWhileEntertainment
        { status: 'ENTERTAINMENT' },
        { status: 'BUSY', notifyWhileBusy: true },
      ],
    };
  }

  /**
   * 广播新单（右下角弹窗抢单）。
   *
   * 收件人规则见 urgentRecipientWhere（空闲 + 娱乐中必推；接单中看本人开关）。
   * **2026-10-18 老板报「刚发单陪玩端就能收到弹窗，之前定的上等马/中等马/下等马延迟呢？」**：
   * 以前 `broadcastNewOrder` 对所有人立即 emit `order:urgent`，段位延迟只挡了订单池可见性，
   * 弹窗根本没等 —— 现在按店里的 `pool.*_delay_seconds` 分档延迟：
   *   上等马 priority（默认 0 秒）、中等马 middle（默认 60 秒）、下等马 low（默认 120 秒）；
   * 延迟到的弹窗会先查订单是否还在 PENDING / 没被抢，避免弹一个已经被接掉的单。
   * 管理端 / 客服不走这里；桥接 / 线上仍按 `broadcastUrgentToBridgedStudios` 的桥接延迟。
   * 返回命中人数（含已排期的），日志里写明立即 / 延迟各多少。
   */
  async broadcastNewOrder(studioId: string, data: unknown): Promise<number> {
    try {
      const companions = await this.prisma.companion.findMany({
        where: this.urgentRecipientWhere(studioId),
        select: { id: true, status: true, user: { select: { username: true } } },
      });
      const orderId = String((data as any)?.id || '');
      // 「线上→线下流转」到点放给本店线下（_releasedToOffline）是排队后的补发：
      // 段位等待已经在之前跑完了，这次对全部本店线下立即弹，不要再叠一层段位延迟。
      const immediateRelease = (data as any)?._releasedToOffline === true;
      const delays = await this.tierDelaysMs(studioId);
      let sent = 0;
      let immediate = 0;
      let scheduled = 0;
      const notConnected: string[] = [];
      // 陪玩端一律看不到客户来源那一组字段（老板 2026-09-29 / 2026-10-02）
      const safe = stripCustomerSourceDeep(data);
      // 谁被命中、各是什么状态：以后问「娱乐中的到底弹没弹」，直接看日志。
      const byStatus: Record<string, number> = {};
      const byTier: Record<string, number> = {};
      for (const c of companions) {
        byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
        // 命中 ≠ 收到：客户端没连着的人，这条弹窗只会发进空气里。
        if (!this.r.isCompanionConnected(c.id)) {
          notConnected.push(c.user?.username || c.id);
        }
        const tier = await this.tierOf(c.id);
        byTier[tier] = (byTier[tier] ?? 0) + 1;
        const delayMs = immediateRelease
          ? 0
          : tier === 'TOP' ? delays.priority : tier === 'MIDDLE' ? delays.middle : delays.low;
        if (delayMs > 0 && orderId) {
          this.scheduleUrgentPopup(`companion:${c.id}`, orderId, safe, delayMs, tier);
          scheduled += 1;
        } else {
          this.server.to(`companion:${c.id}`).emit('order:urgent', safe);
          immediate += 1;
        }
        sent += 1;
      }
      // 老板 2026-09-22 报「邵泽慧发广播单，所有人都没弹窗」：这条路径以前一句日志都没有，
      // 出问题只能靠猜。现在把「命中几人 / 真正在线几人 / 谁不在线 / 分档延迟」都记下来。
      logger.info('SEND order:urgent (broadcast)', {
        studioId,
        orderCode: (data as any)?.orderCode,
        matched: sent,
        immediate,
        scheduled,
        delaysMs: delays,
        byTier,
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

  /** 本店「段位等待」配置（毫秒）。读不到配置时退回 0，保持单测 / 异常场景的行为。 */
  private async tierDelaysMs(studioId: string): Promise<{ priority: number; middle: number; low: number }> {
    try {
      const cfg = await resolveConfigsRaw(this.prisma, studioId, [
        'pool.priority_delay_seconds',
        'pool.middle_delay_seconds',
        'pool.low_delay_seconds',
      ]);
      const toMs = (key: string, fallbackSec: number) => {
        const n = Number((cfg as any)[key]);
        return (Number.isFinite(n) && n >= 0 ? n : fallbackSec) * 1000;
      };
      return {
        priority: toMs('pool.priority_delay_seconds', 0),
        middle: toMs('pool.middle_delay_seconds', 60),
        low: toMs('pool.low_delay_seconds', 120),
      };
    } catch {
      return { priority: 0, middle: 0, low: 0 };
    }
  }

  /** 当前陪玩段位；算不出来按中等马（宁可多等 60 秒，也不越过上等马先弹）。 */
  private async tierOf(companionId: string): Promise<'TOP' | 'MIDDLE' | 'LOW'> {
    try {
      const ex = await this.excellence.computeOne(companionId);
      const tier = String((ex as any)?.tier || '').toUpperCase();
      return tier === 'TOP' || tier === 'LOW' ? tier : 'MIDDLE';
    } catch {
      return 'MIDDLE';
    }
  }

  /** 延迟弹窗：到点先确认订单还在、没被抢，再发；订单没了就静默丢弃。 */
  private scheduleUrgentPopup(
    room: string,
    orderId: string,
    payload: unknown,
    delayMs: number,
    tier: string,
  ): void {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const fresh = await this.prisma.order.findUnique({
            where: { id: orderId },
            select: { status: true, companionId: true, claimedCsUserId: true },
          });
          if (!fresh || fresh.status !== 'PENDING' || fresh.companionId || fresh.claimedCsUserId) {
            logger.info('SEND order:urgent (delayed) skipped: order no longer available', { room, orderId, tier });
            return;
          }
          this.server.to(room).emit('order:urgent', payload);
          logger.info('SEND order:urgent (delayed)', { room, orderId, tier, delayMs });
        } catch (err) {
          logger.warn('SEND order:urgent (delayed) failed', {
            room,
            orderId,
            tier,
            error: (err as Error).message,
          });
        }
      })();
    }, delayMs);
    // 别让 Node 进程因为一个待发弹窗一直不退出（服务端常驻，主要是测试环境友好）
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
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

  /**
   * 客户端 `chat:send` 的校验 + 广播 —— 原 ws.gateway.ts handleChatSend 整段。
   * 没登工作室 / 空消息直接丢弃；其余按原 payload 结构广播全工作室。
   */
  handleChatSend(user: ConnectedUser | undefined, data: { orderId?: string; text: string }): void {
    if (!user?.studioId || !data.text?.trim()) return;

    logger.info('WS chat:send', { senderId: user.id, studioId: user.studioId, orderId: data.orderId });

    // Broadcast to entire studio (CS/admin/companion all in studio room)
    this.notifyChatMessage(user.studioId, {
      text: data.text,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.username,
      orderId: data.orderId || null,
      companionId: user.companionId || null,
      timestamp: new Date().toISOString(),
    });
  }

  /** Notify a specific user about a new chat message (via user room) */
  notifyNewMessage(userId: string, payload: NewMessagePayload): void {
    this.server.to(`user:${userId}`).emit('chat:message', payload);
  }

  notifyChatMessage(studioId: string, payload: StudioChatPayload): void {
    this.server.to(`studio:${studioId}`).emit('chat:new', payload);
  }
}
