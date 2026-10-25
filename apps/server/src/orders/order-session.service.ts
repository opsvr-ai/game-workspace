// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { logger } from '../common/logger';
import { scheduleReleaseCompanionIfIdle } from '../common/companion-presence';
import { getServiceTiming } from '../common/service-timing';
import { switchCompanionStatus } from '../common/companion-status-switch';
import { computeEntertainmentFee, loadEntertainmentRule, manualTodayBoost } from '../common/entertainment-fee';
import { companionOrderRevenue } from '../common/order-revenue';
import { currentBusinessDayRange } from '../common/business-day';
import { isBelowPriceFloor, isRenewalSegment, partnerUnitPriceYuan, priceStatsFloor, resolvePriceMode } from '../common/price-rules';
import { PARTNER_INVITE_TTL_SEC } from './order.constants';

/**
 * 订单会话 / 服务计时 / 搭档邀请 / 陪玩忙碌状态。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderSessionService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
  ) {}

  async cleanupExpiredPartnerInvites(): Promise<void> {
    const cutoff = new Date(Date.now() - PARTNER_INVITE_TTL_SEC * 1000);
    const sessions = await this.prisma.orderSession.findMany({
      where: { status: 'ACTIVE', startedAt: null, createdAt: { lt: cutoff } },
      select: {
        id: true,
        companionId: true,
        parentOrderId: true,
        parentOrder: { select: { studioId: true, dispatchType: true, status: true } },
      },
    });
    for (const s of sessions) {
      await this.prisma.orderSession.update({
        where: { id: s.id },
        data: { status: 'DONE', endedAt: new Date() },
      }).catch(() => {});
      await this.prisma.order.updateMany({
        where: {
          id: s.parentOrderId,
          status: 'CONFIRMED',
          dispatchType: 'DIRECT',
          sessions: { none: { status: 'ACTIVE' } },
        },
        data: { status: 'DONE' },
      }).catch(() => {});
      const studioId = s.parentOrder?.studioId || '';
      if (studioId) {
        this.wsGateway.broadcastToStudio(studioId, 'order:dual_invite_expired', {
          sessionId: s.id,
          orderId: s.parentOrderId,
        });
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', { id: s.id, expired: true });
      }
      if (s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'order:partner_timeout', {
          sessionId: s.id,
          orderId: s.parentOrderId,
        });
      }
    }
  }

  /**
   * 单价低于底线 → 推一条 `review:alert`（老板 2026-10-04）：
   * 主陪价、副陪单价（副陪总价 / 时长）任意一边低于底线就提醒，副陪填 0 也算 ——
   * 老板要拿这个去重点盯「主陪 + 搭档」这 2 个人。
   * 底线分两档（老板 2026-10-04）：「机密续单/复购 40-60 是正常的，绝密续单/复购 60-80 是正常的」——
   * **首单** 机密 35 / 绝密 45，**续单 / 复购** 机密 40 / 绝密 60。
   * 店长 / 客服走工作室广播；**老板没有工作室、不在工作室房间里，必须单独通知**，否则收不到。
   */
  async alertBelowFloorPrice(order: any, session: any, info: any): Promise<void> {
    if (!order?.studioId) return;
    const mode = resolvePriceMode(info?.claimedMode ?? session?.claimedMode, order?.customFields);
    const isRenewal = isRenewalSegment(order?.type, session?.seq);
    const floor = priceStatsFloor(mode, isRenewal);
    const partnerUnit = partnerUnitPriceYuan(info?.coAmount, info?.duration);
    const mainBelow = isBelowPriceFloor(mode, info?.claimedPrice, isRenewal);
    const partnerBelow = !!session?.coCompanionId && isBelowPriceFloor(mode, partnerUnit, isRenewal);
    if (!mainBelow && !partnerBelow) return;
    const ids = [session.companionId, session.coCompanionId].filter(Boolean) as string[];
    const companions = ids.length
      ? await this.prisma.companion
          .findMany({
            where: { id: { in: ids } },
            select: { id: true, user: { select: { username: true, displayName: true } } },
          })
          .catch(() => [] as any[])
      : [];
    const nameOf = (id: string) => {
      const c = companions.find((x: any) => x.id === id);
      return c?.user?.displayName || c?.user?.username || '未知';
    };
    const who = session.coCompanionId
      ? `${nameOf(session.companionId)} + ${nameOf(session.coCompanionId)}`
      : nameOf(session.companionId);
    const customerLabel =
      (order.customFields as any)?.customerWechat || order.orderCode || order.customerId || '';
    const parts: string[] = [];
    if (mainBelow) parts.push(`主陪价 ${info.claimedPrice} 元/小时`);
    if (partnerBelow) parts.push(`副陪单价 ${Math.round((partnerUnit as number) * 100) / 100} 元/小时`);
    const payload = {
      sessionId: session.id,
      orderId: order.id,
      companionId: session.companionId,
      companionName: who,
      level: 'yellow',
      reason: `单价低于底线：${mode}${isRenewal ? '续单 / 复购' : '首单'}（底线 ${floor}），${parts.join('、')}，客户 ${customerLabel}`,
      timestamp: new Date().toISOString(),
    };
    this.wsGateway.broadcastToStudio(order.studioId, 'review:alert', payload);
    const owners = await this.prisma.user
      .findMany({ where: { role: 'OWNER' }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    for (const u of owners) this.wsGateway.notifyUser(u.id, 'review:alert', payload);
  }

  async getSessions(orderId: string) {
    return this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId },
      orderBy: { seq: 'asc' },
      include: {
        companion: { include: { user: { select: { username: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true, displayName: true } } } },
      },
    });
  }

  /**
   * 谁能给这张单加一段服务（首单 / 续单 / 换主陪）——防止陪玩拿别人的订单编号直接续单、抢客户：
   *   · 这张单现在的主陪 / 副陪本人；
   *   · 这张单历史上任何一段会话里当过主陪 / 副陪的人（接手继续打）；
   *   · 这个客户在自己名下的（客户归属人）；
   *   · 以前服务过这个客户（DONE 单当过主陪 / 副陪）。
   * 其余一律拒。
   */
  async canActOnOrder(
    order: { id: string; companionId: string | null; coCompanionId: string | null; customerId: string | null },
    companionId: string,
  ): Promise<boolean> {
    if (order.companionId === companionId || order.coCompanionId === companionId) return true;
    const sessionHit = await this.prisma.orderSession
      .count({
        where: { parentOrderId: order.id, OR: [{ companionId }, { coCompanionId: companionId }] },
      })
      .catch(() => 0);
    if (sessionHit > 0) return true;
    if (!order.customerId) return false;
    const customer = await this.prisma.customer
      .findUnique({ where: { id: order.customerId }, select: { companionId: true } })
      .catch(() => null);
    if (customer?.companionId === companionId) return true;
    const served = await this.prisma.order
      .count({
        where: {
          customerId: order.customerId,
          status: 'DONE',
          OR: [{ companionId }, { coCompanionId: companionId }],
        },
      })
      .catch(() => 0);
    return served > 0;
  }

  async addSession(
    orderId: string,
    dto: {
      companionId: string;
      coCompanionId?: string;
      amount: number;
      coAmount?: number;
      duration?: number;
      claimedMode?: string;
      claimedPrice?: number;
      transferScreenshotUrl?: string;
      useDeposit?: boolean;
      /** 发起这次加段的陪玩（控制器从登录态取，别信前端 body.companionId） */
      actorCompanionId?: string;
      /** 单陪开段时服务端直接开始计时；双陪 / 广播找搭档必须等搭档接受，传 false */
      autoStart?: boolean;
      /** 代打：主陪不参与，只让副陪服务；主陪仍持有客户/KPI。 */
      proxyMode?: boolean;
    },
  ) {
    const sessions = await this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    const last = sessions[0];
    const seq = (last?.seq || 0) + 1;
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (order) {
      // 代打：把标记写回订单，后续业绩计算/管理端能识别「主陪不参与」。
      if (dto.proxyMode) {
        const fields = (order.customFields as any) || {};
        if (fields.proxyMode !== true) {
          await this.prisma.order
            .update({ where: { id: orderId }, data: { customFields: { ...fields, proxyMode: true } } })
            .catch(() => {});
        }
      }
      // 业务状态：首单之后只能在同一个营业日续单一次；续单打完就进入复购，复购可一直重复。
      // 不再用「30 秒冷却」这种拍脑袋的时间：续单只有一次，靠状态判断，不靠等多久。
      const priorRenew = await this.prisma.order.count({
        where: {
          customerId: order.customerId,
          id: { not: orderId },
          type: 'RENEW',
          status: { not: 'CANCELLED' },
        },
      }).catch(() => 0);
      const renewalUsed =
        order.type === 'RENEW' ||
        order.type === 'REPURCHASE' ||
        priorRenew > 0 ||
        (order.type === 'NEW' && (last?.seq || 0) >= 2);
      if (renewalUsed) {
        throw new BadRequestException('续单只有一次，后续请走「复购」');
      }
    }
    // 老板 2026-10-04：「陪玩去客户 B 的位置点续单」——加一段服务之前先确认**这张单 / 这个客户是你的**。
    // 以前只检查了「要换的主陪属不属于同店」，没检查发起人，拿到别人的订单编号就能直接续单抢客户。
    const actorId = dto.actorCompanionId;
    if (order && actorId && !(await this.canActOnOrder(order, actorId))) {
      throw new ForbiddenException('这不是你的订单 / 客户，不能续单；请让客服或店长处理');
    }
    // 换主陪：主陪必须属于同一工作室或已桥接工作室
    if (dto.companionId) {
      const target = await this.prisma.companion.findUnique({
        where: { id: dto.companionId },
        select: { studioId: true },
      }).catch(() => null);
      if (!target || !order) {
        throw new ForbiddenException('订单或主陪不存在');
      }
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(order.studioId || '');
      if (target.studioId !== order.studioId && !bridgedIds.includes(target.studioId)) {
        throw new ForbiddenException('主陪必须属于同一工作室');
      }
    }
    // 记录续单前仍在计时的会话，用于通知被换掉的旧陪玩并释放其状态
    const previousActive = await this.prisma.orderSession.findMany({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      select: { id: true, companionId: true, coCompanionId: true, amount: true, coAmount: true, startedAt: true, totalPausedSec: true },
    });
    // 刚刚才点过开始又点一次（常见于连点/来回切页面）：30 秒内拒绝再开段，
    // 避免同一张单被点出第二段。真正的续单至少是打了一会儿以后。
    const justStarted = previousActive.find(
      (s) => s.startedAt && Date.now() - new Date(s.startedAt).getTime() < 30_000
        && (!dto.companionId || s.companionId === dto.companionId),
    );
    if (justStarted) {
      throw new BadRequestException('这张单刚刚已经开始了，不要重复点；要续单请稍后再操作');
    }
    // 续单场景：自动结束上一个仍在计时的会话（首单/上一段续单）
    for (const prev of previousActive) {
      const started = prev.startedAt ? new Date(prev.startedAt).getTime() : Date.now();
      const activeSec = Math.max(0, (Date.now() - started) / 1000 - (prev.totalPausedSec || 0));
      const actualHours = Number((activeSec / 3600).toFixed(1));
      await this.prisma.orderSession.update({
        where: { id: prev.id },
        data: { status: 'DONE', endedAt: new Date(), duration: actualHours || 0.1 },
      });
    }
    // 并发连点兜底：上一步结束后如果还有 ACTIVE，说明另一路请求刚建了一段，
    // 此时绝不再建第二段（否则一段结束会把状态放空闲，另一段还在打，游戏被杀）。
    const stillActive = await this.prisma.orderSession.findFirst({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      select: { id: true },
    });
    if (stillActive) {
      throw new BadRequestException('这张单已经有进行中的服务，请刷新页面，不要重复点开始');
    }
    const session = await this.prisma.orderSession.create({
      data: {
        parentOrderId: orderId,
        seq,
        companionId: dto.companionId,
        coCompanionId: dto.coCompanionId || order?.coCompanionId || last?.coCompanionId || null,
        amount: dto.amount,
        coAmount: dto.coAmount ?? last?.coAmount ?? (order?.coAmount ?? null),
        duration: dto.duration || 1,
        claimedMode: dto.claimedMode ?? null,
        claimedPrice: dto.claimedPrice ?? null,
        transferScreenshotUrl: dto.transferScreenshotUrl ?? null,
        paidByDeposit: dto.useDeposit === true,
        status: 'ACTIVE',
      },
    });

    // 单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）：**只提醒、不拦单**，并告诉老板是谁在主陪+搭档一起填低价。
    // 主陪价和副陪单价都看（副陪那段总价 / 时长，填 0 也算），方法内部自己判断要不要推。
    void this
      .alertBelowFloorPrice(order, session, {
        claimedMode: session?.claimedMode,
        claimedPrice: session?.claimedPrice,
        coAmount: session?.coAmount,
        duration: session?.duration,
      })
      .catch(() => null);
    // Notify coCompanion if set
    if (order && session.coCompanionId) {
      const inviter = await this.prisma.companion.findUnique({
        where: { id: session.companionId || '' },
        select: { user: { select: { displayName: true, username: true } } },
      }).catch(() => null);
      const inviterName = inviter?.user?.displayName || inviter?.user?.username || '';
      this.wsGateway.pushOrder(session.coCompanionId, {
        ...session,
        gameName: order.gameName,
        orderId,
        type: 'DUAL_INVITE',
        proxyMode: (order.customFields as any)?.proxyMode === true,
        inviterName,
        expiresInSec: PARTNER_INVITE_TTL_SEC,
      });
      this.schedulePartnerInviteExpiry(session.id, order.studioId || '');
    }

    // 通知被续单换掉的旧陪玩：这一段已结束 + 本段计入业绩，并释放其状态
    const newMemberIds = new Set([dto.companionId, session.coCompanionId].filter(Boolean) as string[]);
    for (const prev of previousActive) {
      const replaced = [
        { id: prev.companionId, amount: prev.amount },
        { id: prev.coCompanionId, amount: prev.coAmount ?? prev.amount },
      ].filter((x) => x.id && !newMemberIds.has(x.id as string));
      for (const r of replaced) {
        const companion = await this.prisma.companion
          .findUnique({
            where: { id: r.id as string },
            select: { user: { select: { displayName: true, username: true } } },
          })
          .catch(() => null);
        const name = companion?.user?.displayName || companion?.user?.username || '陪玩';
        this.wsGateway.pushToCompanion(r.id as string, 'order:segment_finished', {
          sessionId: prev.id,
          orderId,
          gameName: order?.gameName || '',
          amount: r.amount ?? 0,
          message: `${name}，你这一段服务已结束，本段计入业绩 ¥${Number(r.amount || 0).toFixed(1)}`,
        });
        // 被换掉的旧陪玩：无条件放回空闲（走统一入口，顺带把「接单中」那段计时日志封口）
        await switchCompanionStatus(this.prisma, r.id as string, 'AVAILABLE');
        await this.wsGateway.refreshCompanionBlacklist(r.id as string).catch(() => {});
        this.wsGateway.broadcastToBridgedStudios(order?.studioId || '', 'status:broadcast', {
          companionId: r.id,
          status: 'AVAILABLE',
        });
      }
    }

    // 单陪开段直接开始计时，别留「创建了但 startedAt 为空」的半截会话：
    // 1337 首段就是只创建没开始，3 分钟后被清理，1 小时提醒也永远不会触发。
    // 双陪 / 换主陪要等搭档接受或对方启动，不能在这里抢跑。
    const canAutoStart =
      dto.autoStart === true &&
      !session.coCompanionId &&
      !!dto.claimedMode &&
      Number(dto.claimedPrice) > 0 &&
      Number(dto.duration) > 0;
    if (!canAutoStart) {
      logger.warn('addSession created but not auto-started', {
        sessionId: session.id,
        autoStart: dto.autoStart,
        hasCo: !!session.coCompanionId,
        hasMode: !!dto.claimedMode,
        price: dto.claimedPrice,
        duration: dto.duration,
      });
    }
    if (canAutoStart) {
      await this.startSession(session.id, dto.companionId, {
        claimedMode: dto.claimedMode,
        claimedPrice: dto.claimedPrice,
        duration: dto.duration,
        transferScreenshotUrl: dto.transferScreenshotUrl,
        useDeposit: dto.useDeposit,
      });
    }

    this.wsGateway.broadcastToStudio(order?.studioId || '', 'order:pool_updated', session);
    return session;
  }

  /**
   * 服务端自己把陪玩切到「接单中」时，必须同步推一次黑名单（老板 2026-10-03）。
   *
   * 「接单中」只能由服务端自动进入（开始服务 / 接受搭档邀请），陪玩本人点不出来
   * —— ws.gateway 收到手动 BUSY 直接丢弃。所以客户端根本不知道自己的状态变了：
   * 它会一直停在「空闲」，把「空闲才杀」的那条黑名单继续挂着。徐泽宁接受搭档邀请后
   * 人已经算接单中，客户端却还在杀他刚启动的三角洲，看起来就是「接受了邀请，
   * 却一直不让启动游戏」。
   *
   * 顺序不能反：先落库、再推 —— pushCurrentBlacklist 是照库里的状态组黑名单的。
   */
  private async markCompanionsBusy(ids: Array<string | null | undefined>) {
    for (const id of Array.from(new Set(ids.filter(Boolean) as string[]))) {
      // 走统一入口：状态和计时日志一起写。这里以前是裸 update —— 日志里永远没有 mode=BUSY 的段，
      // 「接单时长」恒为 0，看板的接单率就恒显示 0%（老板 2026-10-07 看到的那张卡）。
      await switchCompanionStatus(this.prisma, id, 'BUSY');
      await this.wsGateway.refreshCompanionBlacklist(id).catch(() => {});
    }
  }

  /** 搭档接受双陪邀请：确认后开始计时，并通知主陪 */
  async acceptPartnerInvite(sessionId: string, partnerId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      include: { parentOrder: { select: { id: true, companionId: true, gameName: true, studioId: true } } },
    });
    if (!session) throw new NotFoundException('会话不存在');
    // 允许指定搭档或广播找搭档：未指定搭档时，第一个接受者成为搭档
    if (session.companionId === partnerId) throw new ForbiddenException('不能接受自己的搭档邀请');
    if (session.coCompanionId && session.coCompanionId !== partnerId) throw new ForbiddenException('无权接受此搭档邀请');
    if (session.startedAt) throw new ForbiddenException('该服务已开始');
    // 20 秒未接受则视为过期，防止定时器因服务重启失效后仍能接受过期邀请
    const ageSec = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
    if (ageSec > PARTNER_INVITE_TTL_SEC) {
      // 过期只把「待搭档」撤掉，不结束整段会话：主陪随时能单人开打、也能重新邀请，
      // 别因为搭档没看到就把整张单作废（老板 2026-10-03）。
      await this.prisma.orderSession.update({
        where: { id: sessionId },
        data: { coCompanionId: null },
      }).catch(() => {});
      throw new ForbiddenException('该搭档邀请已过期');
    }

    await this.prisma.order.update({
      where: { id: session.parentOrderId },
      data: {
        coCompanionId: session.coCompanionId || partnerId,
        // 搭档金额也落回订单级：管理端（订单管理 / 看板 / 报表）读的是订单上的 coAmount，
        // 以前「续单 / 客户管理开始首单」这条路只在会话上有，订单级是空的。
        ...(session.coAmount != null ? { coAmount: session.coAmount } : {}),
      },
    }).catch(() => {});

    await this.prisma.order.updateMany({
      where: { id: session.parentOrderId, status: 'GRABBED' },
      data: { status: 'CONFIRMED' },
    }).catch(() => {});

    // 客户归属在「开始服务（打了首单）」时才绑定到主陪。
    if (session.companionId) {
      const parentOrder = await this.prisma.order
        .findUnique({ where: { id: session.parentOrderId }, select: { customerId: true } })
        .catch(() => null);
      if (parentOrder?.customerId) {
        await this.prisma.customer
          .updateMany({ where: { id: parentOrder.customerId }, data: { companionId: session.companionId } })
          .catch(() => {});
      }
    }

    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(), coCompanionId: session.coCompanionId || partnerId },
    });

    await this.markCompanionsBusy([session.companionId]);
    // 搭档若在娱乐中接单：先结束娱乐计费并返回本次消费金额。
    let entertainmentFee: number | null = null;
    const partner = await this.prisma.companion.findUnique({
      where: { id: partnerId },
      // 手工补录的今日业绩（老板 2026-10-11）：补录过的人这里也算上，别「门槛说免费、这里又收钱」。
      select: { status: true, studioId: true, todayRevenueBoost: true, todayRevenueBoostDay: true },
    }).catch(() => null);
    if (partner?.status === 'ENTERTAINMENT') {
      const openLog = await this.prisma.companionTimeLog.findFirst({
        where: { companionId: partnerId, mode: 'ENTERTAINMENT', endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (openLog) {
        const elapsed = Math.max(0, Math.round((Date.now() - new Date(openLog.startedAt).getTime()) / 1000));
        // 娱乐费统一口径（当日业绩达标免单），避免和看板/工作台算法不一致
        const { hourlyRate, freeThreshold } = await loadEntertainmentRule(this.prisma, partner?.studioId);
        const { start: entDayStart, end: entDayEnd } = currentBusinessDayRange();
        // 口径 A（老板 2026-10-07「谁的钱算谁的」）：今日业绩 = 主陪 amount + 他当搭档的 coAmount。
        const entDayOrders = await this.prisma.order
          .findMany({
            where: {
              status: 'DONE',
              createdAt: { gte: entDayStart, lt: entDayEnd },
              OR: [{ companionId: partnerId }, { coCompanionId: partnerId }],
            },
            select: { companionId: true, coCompanionId: true, amount: true, coAmount: true, customFields: true },
          })
          .catch(() => [] as any[]);
        entertainmentFee = computeEntertainmentFee({
          minutes: elapsed / 60,
          todayRevenue:
            entDayOrders.reduce((acc: number, o: any) => acc + companionOrderRevenue(o, partnerId), 0) +
            manualTodayBoost(partner, new Date()),
          hourlyRate,
          freeThreshold,
        });
        await this.prisma.companionTimeLog.update({
          where: { id: openLog.id },
          data: { endedAt: new Date(), durationSeconds: elapsed },
        });
      }
    }
    await this.markCompanionsBusy([partnerId]);

    if (session.companionId) {
      this.wsGateway.pushToCompanion(session.companionId, 'order:partner_accepted', {
        sessionId,
        orderId: session.parentOrderId,
        gameName: session.parentOrder?.gameName || '',
        partnerId,
      });
    }
    this.wsGateway.broadcastToStudio(session.parentOrder?.studioId || '', 'order:pool_updated', { id: sessionId });
    return { ok: true, entertainmentFee };
  }

  /** 搭档拒绝双陪邀请：结束该待接受会话，并通知主陪「搭档已拒绝」。 */
  async rejectPartnerInvite(sessionId: string, partnerId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      select: { id: true, companionId: true, coCompanionId: true, status: true, startedAt: true, parentOrderId: true },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.startedAt) throw new ForbiddenException('该服务已开始');
    if (session.coCompanionId && session.coCompanionId !== partnerId) throw new ForbiddenException('无权拒绝此搭档邀请');

    await this.prisma.orderSession.update({
      where: { id: sessionId },
      data: { status: 'DONE', endedAt: new Date() },
    }).catch(() => {});

    if (session.companionId) {
      const partner = await this.prisma.companion.findUnique({
        where: { id: partnerId },
        select: { user: { select: { username: true, displayName: true } } },
      }).catch(() => null);
      const partnerName = partner?.user?.displayName || partner?.user?.username || '搭档';
      this.wsGateway.pushToCompanion(session.companionId, 'order:partner_rejected', {
        sessionId,
        orderId: session.parentOrderId,
        partnerName,
      });
    }
    return { ok: true };
  }

  /** 广播找搭档：把双陪会话邀请广播给工作室，任意陪玩可接受 */
  async broadcastPartnerInvite(sessionId: string) {
    const session = await this.prisma.orderSession.findUnique({
      where: { id: sessionId },
      include: { parentOrder: { select: { studioId: true, gameName: true } } },
    });
    if (!session) throw new NotFoundException('会话不存在');
    const inviter = await this.prisma.companion.findUnique({
      where: { id: session.companionId || '' },
      select: { user: { select: { displayName: true, username: true } } },
    }).catch(() => null);
    const inviterName = inviter?.user?.displayName || inviter?.user?.username || '';
    this.wsGateway.broadcastToStudio(session.parentOrder?.studioId || '', 'order:dual_invite', {
      sessionId,
      orderId: session.parentOrderId,
      companionId: session.companionId,
      gameName: session.parentOrder?.gameName || '',
      amount: session.amount,
      duration: session.duration,
      type: 'DUAL_INVITE',
      coCompanionId: null,
      inviterName,
      expiresInSec: PARTNER_INVITE_TTL_SEC,
    });
    this.schedulePartnerInviteExpiry(sessionId, session.parentOrder?.studioId || '');
    return { ok: true };
  }

  /**
   * 搭档邀请到点还没人接受：**只撤掉「待搭档」，不结束会话、不结束订单**（老板 2026-10-03）。
   *
   * 以前超时会把会话标 `DONE`、把 DIRECT 订单也标 `DONE` —— 「被邀请方打的这个订单找不到」
   * 有一大半就是这么来的：陪玩在游戏里没看到横幅（或就差几秒），邀请超时，整段会话作废，
   * 主陪只好重新开始一单，被邀请方记录里什么都没有，两边对不上账。
   * 现在：清掉会话上的搭档、推一条「搭档未回应」，会话保持 ACTIVE —— 主陪可以
   * 直接单人开打，也可以再邀请一次（`addSession` / `broadcastPartnerInvite` 都能重来）。
   */
  schedulePartnerInviteExpiry(sessionId: string, studioId: string) {
    setTimeout(async () => {
      try {
        const s = await this.prisma.orderSession.findUnique({
          where: { id: sessionId },
          select: { id: true, status: true, startedAt: true, parentOrderId: true, companionId: true },
        });
        if (!s || s.status !== 'ACTIVE' || s.startedAt) return;
        await this.prisma.orderSession.update({
          where: { id: sessionId },
          data: { coCompanionId: null },
        });
        this.wsGateway.broadcastToStudio(studioId, 'order:dual_invite_expired', {
          sessionId,
          orderId: s.parentOrderId,
        });
        // 通知主陪：搭档未回应（超时）——你可以直接开始，或再邀请一次。
        if (s.companionId) {
          this.wsGateway.pushToCompanion(s.companionId, 'order:partner_timeout', {
            sessionId,
            orderId: s.parentOrderId,
          });
        }
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', { id: sessionId, expired: true });
      } catch (e) {
        logger.error('partner invite expiry failed', { error: (e as Error).message, sessionId });
      }
    }, PARTNER_INVITE_TTL_SEC * 1000);
  }

  private async getOwnedSession(id: string, companionId?: string) {
    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: {
        id: true,
        companionId: true,
        coCompanionId: true,
        status: true,
        pausedAt: true,
        totalPausedSec: true,
        startedAt: true,
        parentOrderId: true,
      },
    });
    if (!s) throw new NotFoundException('会话不存在');
    // 代打 / 双陪：实际服务人（副陪）也必须能结束自己正在跑的这一段。
    // 以前只认主陪，导致别梦晨点结束服务提示没有可结束的订单。
    if (companionId && s.companionId !== companionId && s.coCompanionId !== companionId) {
      throw new ForbiddenException('只能操作自己的会话');
    }
    return s;
  }

  async startSession(
    id: string,
    companionId?: string,
    claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string; duration?: number; useDeposit?: boolean },
  ) {
    const own = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { id: true, companionId: true, parentOrderId: true, claimedPrice: true, coAmount: true, duration: true, seq: true },
    });
    if (!own) throw new NotFoundException('会话不存在');
    const isHandoff = !!(companionId && own.companionId && own.companionId !== companionId);
    if (isHandoff) {
      // 换主陪：允许同工作室的陪玩代为启动该会话
      const [caller, main] = await Promise.all([
        this.prisma.companion.findUnique({ where: { id: companionId! }, select: { studioId: true } }).catch(() => null),
        this.prisma.companion.findUnique({ where: { id: own.companionId! }, select: { studioId: true } }).catch(() => null),
      ]);
      if (!caller || !main || caller.studioId !== main.studioId) {
        throw new ForbiddenException('只能操作自己的会话');
      }
    }
    // 老板 2026-10-23：一个陪玩同一时间只能服务一个客户。
    // 以前可以一边挂着 A 的 10 小时，一边给 B/C/D 各开一段「复购」并结束，
    // 复购率就被刷成 100%；现在只要有另一段 ACTIVE 且已开始的会话，直接拦住。
    const actingCompanionId = companionId || own.companionId;
    if (actingCompanionId) {
      const otherActive = await this.prisma.orderSession.findFirst({
        where: {
          id: { not: id },
          status: 'ACTIVE',
          startedAt: { not: null },
          OR: [{ companionId: actingCompanionId }, { coCompanionId: actingCompanionId }],
        },
        select: { id: true, parentOrder: { select: { orderCode: true } } },
      });
      if (otherActive) {
        throw new BadRequestException(
          `你正在服务订单 ${otherActive.parentOrder?.orderCode || ''}，先结束当前服务再开新单`,
        );
      }
    }
    const data: any = { startedAt: new Date() };
    // 复购单陪这条路只在 startSession 填价（addSession 那条路已经提醒过），
    // 用「这段会话还没记过单价」当幂等条件，避免同一次填价弹两遍。
    let belowFloorNew = false;
    if (claims) {
      if (!claims.claimedMode) throw new BadRequestException('请填写游戏模式');
      if (claims.claimedPrice == null || !Number.isFinite(claims.claimedPrice) || claims.claimedPrice <= 0) throw new BadRequestException('请填写有效单价');
      if (claims.duration == null || !Number.isFinite(claims.duration) || claims.duration <= 0) throw new BadRequestException('请填写有效时长');
      data.claimedMode = claims.claimedMode;
      data.claimedPrice = claims.claimedPrice;
      data.transferScreenshotUrl = claims.transferScreenshotUrl;
      data.duration = claims.duration;
      data.paidByDeposit = claims.useDeposit === true;
      if (own.claimedPrice == null) {
        // 判底线前先看这张单是首单还是续单 / 复购（单子类型 + 这一段是第几段）
        const parentMeta = await this.prisma.order
          .findUnique({ where: { id: own.parentOrderId }, select: { type: true } })
          .catch(() => null);
        const isRenewal = isRenewalSegment(parentMeta?.type, own.seq);
        belowFloorNew =
          isBelowPriceFloor(claims.claimedMode, claims.claimedPrice, isRenewal) ||
          isBelowPriceFloor(claims.claimedMode, partnerUnitPriceYuan(own.coAmount, claims.duration), isRenewal);
      }
    }
    const updated = await this.prisma.orderSession.update({ where: { id }, data });

    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { parentOrderId: true, companionId: true, coCompanionId: true, seq: true },
    });
    if (s) {
      await this.prisma.order.updateMany({
        where: { id: s.parentOrderId, status: 'GRABBED' },
        data: { status: 'CONFIRMED' },
      }).catch(() => {});
      // 客户归属在「开始服务（打了首单）」时才绑定，抢单/指定阶段不绑。
      if (s.companionId) {
        const parentOrder = await this.prisma.order
          .findUnique({ where: { id: s.parentOrderId }, select: { customerId: true } })
          .catch(() => null);
        if (parentOrder?.customerId) {
          await this.prisma.customer
            .updateMany({ where: { id: parentOrder.customerId }, data: { companionId: s.companionId } })
            .catch(() => {});
        }
      }
      await this.markCompanionsBusy([s.companionId, s.coCompanionId]);
      // 单价低于底线（首单 机密 35 / 绝密 45，续单 / 复购 机密 40 / 绝密 60）：提醒老板 / 店长，不拦单。
      if (belowFloorNew && claims) {
        const parent = await this.prisma.order
          .findUnique({
            where: { id: s.parentOrderId },
            select: { id: true, studioId: true, customFields: true, orderCode: true, customerId: true, type: true },
          })
          .catch(() => null);
        if (parent) {
          void this
            .alertBelowFloorPrice(
              parent,
              { id, companionId: s.companionId, coCompanionId: s.coCompanionId, seq: s.seq },
              {
                claimedMode: claims.claimedMode,
                claimedPrice: claims.claimedPrice,
                coAmount: own.coAmount,
                duration: claims.duration,
              },
            )
            .catch(() => null);
        }
      }
      if (isHandoff && s.companionId) {
        this.wsGateway.pushToCompanion(s.companionId, 'order:service_handoff', {
          sessionId: id,
          orderId: s.parentOrderId,
        });
      }
    }
    return updated;
  }

  async pauseSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    if (s.status !== 'ACTIVE' || !s.startedAt) throw new ForbiddenException('只有进行中的服务才能暂停');
    if (s.pausedAt) throw new ForbiddenException('服务已处于暂停状态');
    // 暂停保护：累计 20 分钟用完就不能再暂停（单次 10 分钟由定时任务自动恢复）。
    if ((s.totalPausedSec || 0) >= 20 * 60) {
      throw new BadRequestException('本次服务暂停额度已用完（累计最多 20 分钟）');
    }
    return this.prisma.orderSession.update({ where: { id }, data: { pausedAt: new Date() } });
  }

  async resumeSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    if (s.status !== 'ACTIVE') throw new ForbiddenException('只有进行中的服务才能继续');
    if (s.pausedAt) {
      const sec = Math.floor((Date.now() - new Date(s.pausedAt).getTime()) / 1000);
      return this.prisma.orderSession.update({
        where: { id },
        data: { pausedAt: null, totalPausedSec: (s.totalPausedSec || 0) + sec },
      });
    }
    return s;
  }

  async endSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
    const data: any = { endedAt: new Date(), status: 'DONE' };
    if (s.pausedAt) {
      const sec = Math.floor((Date.now() - new Date(s.pausedAt).getTime()) / 1000);
      data.pausedAt = null;
      data.totalPausedSec = (s.totalPausedSec || 0) + sec;
    }
    if (s.startedAt) {
      const activeSec = Math.max(0, (Date.now() - new Date(s.startedAt).getTime()) / 1000 - (data.totalPausedSec ?? s.totalPausedSec ?? 0));
      data.duration = Number((activeSec / 3600).toFixed(1)) || 0.1;
    }
    const updated = await this.prisma.orderSession.update({ where: { id }, data });
    await this.releaseCompanionsAfterSession(s);
    return updated;
  }

  /**
   * 正在服务中「加时 / 继续续单」：不结束游戏、不释放任何人。
   * 旧会话按当前时刻封口（业绩/时长入账），同订单立刻开下一段 ACTIVE。
   */
  async continueSession(
    orderId: string,
    actorCompanionId: string | undefined,
    dto: { duration?: number; price?: number; coPrice?: number; claimedMode?: string; useDeposit?: boolean; mode?: 'RENEW' | 'REPURCHASE' },
  ) {
    if (!actorCompanionId) throw new ForbiddenException('当前用户不是陪玩');
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderCode: true,
        type: true,
        gameName: true,
        studioId: true,
        customerId: true,
        csUserId: true,
        companionId: true,
        coCompanionId: true,
        customFields: true,
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const active = await this.prisma.orderSession.findFirst({
      where: { parentOrderId: orderId, status: 'ACTIVE', startedAt: { not: null } },
      orderBy: { seq: 'desc' },
    });
    if (!active) throw new BadRequestException('当前没有正在进行的服务');
    if (active.companionId !== actorCompanionId && active.coCompanionId !== actorCompanionId) {
      throw new ForbiddenException('只能操作自己正在进行的服务');
    }

    const now = new Date();
    const started = active.startedAt ? new Date(active.startedAt).getTime() : now.getTime();
    const pausedSec = active.pausedAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(active.pausedAt).getTime()) / 1000))
      : 0;
    const totalPaused = (active.totalPausedSec || 0) + pausedSec;
    const activeSec = Math.max(0, (now.getTime() - started) / 1000 - totalPaused);
    const oldDuration = Math.max(0.1, Math.round((activeSec / 3600) * 10) / 10);

    await this.prisma.orderSession.update({
      where: { id: active.id },
      data: {
        status: 'DONE',
        endedAt: now,
        duration: oldDuration,
        pausedAt: null,
        totalPausedSec: totalPaused,
      },
    });

    const duration = Math.max(0.5, Number(dto.duration) || 1);
    const mainPrice = Number(dto.price) > 0
      ? Number(dto.price)
      : (Number(active.claimedPrice) > 0 ? Number(active.claimedPrice) : (active.duration > 0 ? active.amount / active.duration : active.amount));
    const oldCoUnit = active.coCompanionId && active.duration > 0 ? (Number(active.coAmount) || 0) / active.duration : 0;
    const coPrice = Number(dto.coPrice) > 0 ? Number(dto.coPrice) : oldCoUnit;
    const seqRow = await this.prisma.orderSession.findFirst({
      where: { parentOrderId: orderId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const mainId = active.companionId || order.companionId;
    const coId = active.coCompanionId || order.coCompanionId;
    let sessionOrderId = orderId;
    let seq = (seqRow?.seq || 0) + 1;

    // 中午 12 点后「续单」切换为「复购」：开一张新的 REPURCHASE 单，
    // 这样复购 KPI 统计到新单，旧单留作首单/续单历史；游戏和会话不中断。
    if (dto.mode === 'REPURCHASE') {
      const orderCode = 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      const repurchase = await this.prisma.order.create({
        data: {
          orderCode,
          type: 'REPURCHASE',
          studioId: order.studioId,
          csUserId: order.csUserId,
          customerId: order.customerId,
          dispatchType: 'DIRECT',
          source: 'OFFLINE',
          companionId: mainId,
          coCompanionId: coId,
          coAmount: coId ? coPrice * duration : null,
          status: 'CONFIRMED',
          amount: mainPrice * duration,
          gameName: order.gameName,
          serviceType: 'PLAY_WITH',
          duration,
          customFields: {
            ...(order.customFields as any || {}),
            proxyMode: (order.customFields as any)?.proxyMode === true ? true : undefined,
            continuedFromOrderId: orderId,
          },
        },
      });
      sessionOrderId = repurchase.id;
      seq = 1;
      await this.prisma.order.update({ where: { id: orderId }, data: { status: 'DONE' } }).catch(() => {});
    }

    const next = await this.prisma.orderSession.create({
      data: {
        parentOrderId: sessionOrderId,
        seq,
        companionId: mainId,
        coCompanionId: coId,
        amount: mainPrice * duration,
        coAmount: coId ? coPrice * duration : null,
        duration,
        status: 'ACTIVE',
        startedAt: now,
        claimedMode: dto.claimedMode || active.claimedMode || null,
        claimedPrice: mainPrice,
        paidByDeposit: dto.useDeposit === true || active.paidByDeposit,
      },
    });

    // 不释放人、不结束游戏：只把两人的 BUSY 计时继续接上。
    for (const id of [mainId, coId].filter(Boolean) as string[]) {
      const row = await this.prisma.companion.findUnique({ where: { id }, select: { status: true } }).catch(() => null);
      if (row?.status !== 'BUSY') await switchCompanionStatus(this.prisma, id, 'BUSY');
    }
    for (const id of [mainId, coId].filter(Boolean) as string[]) {
      this.wsGateway.pushToCompanion(id as string, 'order:session_continued', {
        orderId: sessionOrderId,
        oldSessionId: active.id,
        sessionId: next.id,
        gameName: order.gameName,
        duration,
        seq,
      });
    }
    this.wsGateway.broadcastToStudio(order.studioId || '', 'order:pool_updated', { id: sessionOrderId, sessionId: next.id });
    return { sessionId: next.id, seq, oldSessionId: active.id, duration, orderId: sessionOrderId };
  }

  /**
   * 会话结束后把主陪 / 副陪放回空闲，并广播给同工作室（客服端列表不用等轮询）。
   */
  private async releaseCompanionsAfterSession(s: {
    id: string;
    companionId?: string | null;
    coCompanionId?: string | null;
    parentOrderId?: string | null;
  }): Promise<void> {
    // 结束服务后先保持 BUSY，具体缓冲分钟数由店长后台配置。
    const studioId = s.parentOrderId
      ? (await this.prisma.order.findUnique({ where: { id: s.parentOrderId }, select: { studioId: true } }).catch(() => null))?.studioId
      : null;
    const timing = await getServiceTiming(this.prisma, studioId);
    for (const companionId of [s.companionId, s.coCompanionId].filter(Boolean) as string[]) {
      scheduleReleaseCompanionIfIdle(this.prisma, companionId, s.id, timing.bufferMs);
    }
  }
}
