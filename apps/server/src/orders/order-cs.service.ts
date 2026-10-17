// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { logger } from '../common/logger';
import { maskCustomerWechat } from '../common/order-privacy';
import { switchCompanionStatus } from '../common/companion-status-switch';
import { PoolScope } from '@chunlv/shared';
import { normalizePoolScope } from '../common/order-outcome';
import { SUPPLEMENT_TYPE } from './order.constants';

/**
 * 客服 / 管理端订单操作：跟进台账落库 / 客户房间 / 订单信息与金额修改 / 指定联系 / 重新派单 / 认领与释放 / 收款信息。
 *
 * 从 OrdersService 拆出，方法体原样搬运，行为与拆分前一致。
 */
@Injectable()
export class OrderCsService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
  ) {}

  async updateContact(orderId: string, body: any) {
    // M1: Validate order is in GRABBED or CONFIRMED state before allowing contact updates
    const order0 = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order0 || (order0.status !== 'GRABBED' && order0.status !== 'CONFIRMED')) {
      throw new ForbiddenException('只能对已抢单或已确认的订单更新联系状态');
    }
    const data: any = {};
    if (body.contactStatus !== undefined) data.contactStatus = body.contactStatus;
    if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt);
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.screenshotUrl !== undefined) data.screenshotUrl = body.screenshotUrl;
    if (body.workWechatId !== undefined) {
      const order2 = await this.prisma.order.findUnique({ where: { id: orderId }, select: { customFields: true } });
      const cf2 = (order2?.customFields as any) || {};
      if (body.workWechatName !== undefined) cf2.workWechatName = body.workWechatName;
      data.customFields = { ...cf2, workWechatId: body.workWechatId };
    }
    if (body.workWechatName !== undefined) {
      const cf3 = (data.customFields as any) || {};
      data.customFields = { ...cf3, workWechatName: body.workWechatName };
    }
    const updated = await this.prisma.order.update({ where: { id: orderId }, data, include: { customer: true } });

    // M6: Only link customer when contact is successfully added (not 'not_accepted')
    if (body.contactStatus === 'added' && updated.customer) {
      await this.prisma.customer.upsert({
        where: { id: updated.customerId },
        update: {
          companionId: updated.customer.companionId || updated.companionId,
        },
        create: {
          id: updated.customerId,
          studioId: updated.studioId,
          customerCode: updated.customer.customerCode || `C${Date.now().toString(36)}`,
          wechatId: (updated.customFields as any)?.customerWechat || updated.customer.wechatId || '',
          platform: (updated.customFields as any)?.customerSource || '',
          platformAccount: (updated.customFields as any)?.customerPlatformAccount || '',
          companionId: updated.companionId,
          status: 'FOLLOW_UP',
        },
      });
    }
    // 陪玩点「添加失败」→ 自动生成一条补单申请，等管理端审核（老板 2026-10-04）。
    if (body.contactStatus === 'not_accepted') {
      await this.upsertSupplementRequest(updated, body).catch(() => null);
    }
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /**
   * 「进游戏对接」——房间码单专用（老板 2026-10-11）。
   *
   * 老板原话：「刚刚胡程硕抢了一个订单，是个游戏的房间码，房间码的话不进游戏对接不了，
   * 进了游戏才能对接，这怎么办？」查实：本店「空闲」状态的黑名单里挂着三角洲
   * （CompanionStatusBlacklist：AVAILABLE → DeltaForceClient-Win64-Shipping）—— 他抢完单
   * 还是「空闲」，一开游戏就被看门狗杀掉，根本进不去房间。而「接单中」只有点「开始首单」
   * （开始计时）时才会自动切，可开始计时的前提又是先点「添加成功」…… 房间码单压根没有
   * 微信可加，于是整条流程卡死。
   *
   * 这条路**只办一件事**：把他切成「接单中」—— 空闲黑名单不再生效，游戏不会被杀，
   * 他才能进房间对接客户。
   *
   * **2026-10-17 改口径（老板：「进去之后客户不喜欢怎么办？也添加成功？」）**：
   * 以前这里顺手把 contactStatus 写成 `added`（等于替他点了「添加成功」）—— 那是错的：
   * 客户人还没见着、微信都还没要，就算「添加成功」，客户立刻进他的「客户管理」，
   * 「首单成功率」的分母也跟着虚高。现在**一个字都不碰 contactStatus**：
   *   - 客户同意加微信 → 他自己点「✅ 添加成功」（客户这时候才进他的「客户管理」，
   *     客户归属也在这时候落到他名下，跟 updateContact 的 'added' 分支同一个口径）；
   *   - 客户不喜欢 / 没给微信 → 他点「❌ 添加失败」，走跟别的单一样的补单审核。
   * 这里只记 customFields.roomJoinedAt，给界面区分「还没进去 / 已经进去过」。
   */
  async joinRoom(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        studioId: true,
        companionId: true,
        customerId: true,
        customFields: true,
        customer: { select: { id: true, companionId: true } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new ForbiddenException('只能对已抢单 / 已确认的订单做「进游戏对接」');
    }
    if (user?.role === 'COMPANION' && order.companionId !== user.companionId) {
      throw new ForbiddenException('这不是你的订单');
    }
    const cf = (order.customFields as any) || {};
    if (!cf.customerRoomCode) {
      throw new BadRequestException('这张单没填房间码，直接用「添加成功」就行');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      // 只留个记号，不动 contactStatus（见上面 2026-10-17 那段）。
      data: { customFields: { ...cf, roomJoinedAt: new Date().toISOString() } },
      include: { customer: true },
    });
    // 客户归属**不在这里做**：等他真点到「添加成功」时才归他（updateContact 的 'added' 分支），
    // 不然「客户不喜欢」的单也会挂到他名下。
    // 切成「接单中」：空闲黑名单（本店挂着三角洲）立刻撤掉，他才能开着游戏进房间对接。
    if (order.companionId) {
      await switchCompanionStatus(this.prisma, order.companionId, 'BUSY');
      await this.wsGateway.refreshCompanionBlacklist(order.companionId).catch(() => null);
      this.wsGateway.broadcastToBridgedStudios(order.studioId, 'status:broadcast', {
        companionId: order.companionId,
        status: 'BUSY',
        reason: 'room-join',
      });
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  /** 陪玩点「添加失败」时建档：同一张单只留一条；被驳回后重新提交会回到待审。 */
  private async upsertSupplementRequest(order: any, body: any): Promise<void> {
    if (!order?.companionId) return;
    const reason = String(body?.failReason || body?.reason || '').trim() || null;
    const evidenceUrl = String(body?.screenshotUrl || body?.evidenceUrl || '').trim() || null;
    const existing = await this.prisma.supplementRequest.findFirst({
      where: { orderId: order.id, type: SUPPLEMENT_TYPE },
    });
    if (existing) {
      // 已经补过的单不再重复开，避免同一张单被反复要名额
      if (existing.status === 'APPROVED') return;
      await this.prisma.supplementRequest.update({
        where: { id: existing.id },
        data: {
          companionId: order.companionId,
          studioId: order.studioId ?? existing.studioId,
          reason,
          evidenceUrl,
          status: 'PENDING',
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          reviewDueAt: null,
          reviewStatus: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
      });
      await this.notifySupplementRequest(order, reason).catch(() => null);
      return;
    }
    await this.prisma.supplementRequest.create({
      data: {
        orderId: order.id,
        type: SUPPLEMENT_TYPE,
        companionId: order.companionId,
        studioId: order.studioId ?? null,
        reason,
        evidenceUrl,
        status: 'PENDING',
      },
    });
    await this.notifySupplementRequest(order, reason).catch(() => null);
  }

  /**
   * 陪玩提交补单申请 → 实时告诉本店客服 / 店长 + 全站老板。
   *
   * 老板 2026-10-04 问「这种交互 双方都有提示么？」——以前陪玩这边提交完，
   * 管理端只有「订单管理」页上那个每 60 秒自己轮询一次的红点数字，
   * 管理端不在那一页就完全不知道有人要补单。
   */
  private async notifySupplementRequest(order: any, reason: string | null): Promise<void> {
    const studioId: string | null = order?.studioId ?? null;
    const where: any = { isAuthorized: true, role: { in: ['OWNER', 'ADMIN', 'CS'] } };
    if (studioId) where.OR = [{ studioId }, { role: 'OWNER', studioId: null }];
    else where.role = 'OWNER';
    const found = await this.prisma.user.findMany({ where, select: { id: true } }).catch(() => []);
    const reviewers = Array.isArray(found) ? found : [];
    if (!reviewers.length) return;
    const companion = await this.prisma.companion
      .findUnique({
        where: { id: order.companionId },
        select: { user: { select: { displayName: true, username: true } } },
      })
      .catch(() => null);
    const name =
      (companion as any)?.user?.displayName || (companion as any)?.user?.username || '有陪玩';
    const code = order?.orderCode || order?.id || '';
    const payload = {
      orderId: order?.id ?? null,
      orderCode: order?.orderCode ?? null,
      companionId: order?.companionId ?? null,
      companionName: name,
      reason: reason ?? null,
      message: `${name} 提交了补单申请（订单 ${code}），去「订单管理 → 补单审核」同意或驳回`,
    };
    for (const reviewer of reviewers) {
      this.wsGateway.notifyUser((reviewer as any).id, 'order:supplement_request', payload);
    }
  }

  async updateOrderInfo(orderId: string, user: any, dto: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === 'CANCELLED') throw new ForbiddenException('已取消的订单不能修改');
    if (order.status === 'DONE' && (dto?.amount !== undefined || dto?.duration !== undefined)) {
      throw new ForbiddenException('已完成订单不能修改金额或时长，请走退款/补单');
    }

    if (user?.role === 'CS' || user?.role === 'COMPANION') {
      if (order.csUserId !== user.id) throw new ForbiddenException('只能修改自己发布的订单');
    } else if (user?.role === 'ADMIN') {
      if (order.studioId !== user.studioId) throw new ForbiddenException('无权修改其他工作室的订单');
    } else if (user?.role !== 'OWNER') {
      throw new ForbiddenException('无权修改订单');
    }

    const has = (key: string) => Object.prototype.hasOwnProperty.call(dto || {}, key);
    const orderData: any = {};
    if (has('gameName')) orderData.gameName = dto.gameName;
    if (has('serviceType')) orderData.serviceType = dto.serviceType;
    if (has('duration')) orderData.duration = dto.duration;
    if (has('amount')) orderData.amount = dto.amount;
    if (has('notes')) orderData.notes = dto.notes;
    if (has('type')) orderData.type = dto.type;
    if (has('scheduledAt')) orderData.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const customFieldKeys = [
      'customerSource',
      'customerSourceAccount',
      'customerNickname',
      'customerAccountId',
      'customerPlatformAccount',
      'customerWechat',
      'customerWechatQr',
      'customerRoomCode',
      'customerYy',
      'deltaMission',
      'deltaCount',
      'deltaNote',
      'billingMode',
      'urgency',
      'scheduledTimeText',
      'gameMode',
      'serviceType',
    ];

    const cfPatch: any = {};
    for (const key of customFieldKeys) {
      if (!has(key)) continue;
      const value = dto[key];
      cfPatch[key] = key === 'customerWechatQr' && !value ? undefined : value;
    }

    const currentCf = (order.customFields as any) || {};
    const nextCf = { ...currentCf, ...cfPatch };

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...orderData,
        customFields: nextCf,
      },
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
    });

    const customerData: any = {};
    if (has('customerWechat')) customerData.wechatId = dto.customerWechat ?? '';
    if (has('customerSource')) customerData.platform = dto.customerSource || null;
    if (has('customerPlatformAccount')) customerData.platformAccount = dto.customerPlatformAccount || null;
    if (Object.keys(customerData).length > 0) {
      await this.prisma.customer
        .update({ where: { id: order.customerId }, data: customerData })
        .catch((err) => {
          logger.error('updateOrderInfo: sync customer failed', { orderId, error: (err as Error).message });
        });
    }

    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    if (updated.companionId) this.wsGateway.pushOrder(updated.companionId, updated);
    if (updated.coCompanionId) {
      const coSafe = maskCustomerWechat(updated, {
        id: '',
        role: 'COMPANION',
        companionId: updated.coCompanionId,
      });
      this.wsGateway.pushOrder(updated.coCompanionId, coSafe);
    }
    return updated;
  }

  async updateAmount(orderId: string, companionId: string, amount: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { companionId: true, status: true, studioId: true },
    });
    if (!order || order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    // W2: Only allow amount updates for GRABBED or CONFIRMED orders
    if (order.status !== 'GRABBED' && order.status !== 'CONFIRMED') {
      throw new ForbiddenException('只能对已抢单或已确认的订单修改金额');
    }
    const updated = await this.prisma.order.update({ where: { id: orderId }, data: { amount } });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markCsContact(
    orderId: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string; failReason?: string; note?: string },
    user?: { id: string; role: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
    const cf = (order.customFields as any) || {};
    const result = extra?.addResult;
    // agreed = 客户已同意（跟进台账里点的那一步）、dispatched = 这条跟进已经派出单去了
    const contactStatus =
      status === 'agreed'
        ? 'agreed'
        : status === 'dispatched'
          ? 'dispatched'
          : result === 'passed'
            ? 'added'
            : result === 'failed'
              ? 'not_accepted'
              : 'pending';
    const poolHandled = status === 'added';
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus,
        customFields: {
          ...cf,
          csContactAt: new Date().toISOString(),
          csContactEvidenceUrl: evidenceUrl || '',
          // 客服标「添加失败」时选的原因 + 备注（老板 2026-10-06）：留档，方便跟发单者 / 店长核对
          ...(extra?.failReason ? { csContactFailReason: extra.failReason } : {}),
          ...(extra?.note ? { csContactNote: extra.note } : {}),
          ...(extra?.workWechatId !== undefined ? { csWorkWechatId: extra.workWechatId } : {}),
          ...(extra?.workWechatName !== undefined ? { csWorkWechatName: extra.workWechatName } : {}),
          ...(result === 'passed' ? { csCultivated: true } : {}),
          ...(status === 'added' ? { poolHandled } : {}),
        },
      },
    });
  }

  async redispatch(
    orderId: string,
    studioId?: string,
    user?: { id: string; role: string },
    body?: { poolScope?: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL') {
      throw new ForbiddenException('该订单当前不可重新派单');
    }
    if (studioId && order.studioId !== studioId) {
      throw new ForbiddenException('无权操作其他工作室的订单');
    }
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
      const cf = (order.customFields as any) || {};
      delete cf.poolExpired;
      delete cf.poolExpiredAt;
      delete cf.poolHandled;
      delete cf.poolHandledAt;
      const dispatchHistory = (cf.dispatchHistory || []).concat({
        at: new Date().toISOString(),
        action: 'REDISPATCH',
      });
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          contactStatus: null,
          // 重新派单时客服可以再选一次入池方式（老板 2026-10-01）：
          // 「线下→线上流转」/「线上→线下流转」。不传就沿用原来那张单的方式。
          ...(body && body.poolScope !== undefined
            ? {
                poolScope:
                  normalizePoolScope(body.poolScope) === PoolScope.ONLINE_FIRST
                    ? PoolScope.ONLINE_FIRST
                    : null,
                // 换了方式就把「手动放给线下」的时间清掉，重新按新方式排
                releasedToOfflineAt: null,
              }
            : {}),
          customFields: {
            ...cf,
            dispatchCount: (cf.dispatchCount || 1) + 1,
          firstDispatchedAt: cf.firstDispatchedAt || new Date().toISOString(),
          dispatchHistory,
        },
        createdAt: new Date(), // 重置发单时间，让等待时间重新计算
      },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markPoolHandled(orderId: string, user?: { id: string; role: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (user?.role === 'CS' && order.csUserId !== user.id) {
      throw new ForbiddenException('只能处理自己发布的订单');
    }
    const cf = (order.customFields as any) || {};
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus: null,
        customFields: { ...cf, poolHandled: true, poolHandledAt: new Date().toISOString() },
      },
    });
  }

  async claim(
    orderId: string,
    csUserId: string,
    dto: {
      workWechatId?: string;
      workWechatName?: string;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    userStudioId?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL' || order.companionId) {
      throw new ForbiddenException('该订单当前不可认领');
    }
    if (userStudioId) {
      const visibleIds = await this.bridgeService.getInboundSharedStudioIds(userStudioId, 'ORDERS');
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权认领其他工作室的订单');
    }

    const result = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: 'PENDING',
        dispatchType: 'POOL',
        companionId: null,
        claimedCsUserId: null,
      },
      data: {
        status: 'CLAIMED',
        claimedCsUserId: csUserId,
        claimedAt: new Date(),
        csWorkWechatId: dto.workWechatId || null,
        csWorkWechatName: dto.workWechatName || null,
        customerPaidTo: dto.customerPaidTo || null,
        customerPaymentAccountId: dto.customerPaymentAccountId || null,
        customerPaymentAccountName: dto.customerPaymentAccountName || null,
      },
    });
    if (result.count === 0) throw new ForbiddenException('订单已被他人认领或状态已变更');

    const updated = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true, avatar: true } },
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
      },
    });
    if (!updated) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async releaseClaim(orderId: string, csUserId: string, userStudioId: string | undefined, role: string | undefined, urgency?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'CLAIMED') throw new ForbiddenException('该订单当前不是客服认领状态');
    if (role === 'CS' && order.claimedCsUserId !== csUserId) {
      throw new ForbiddenException('只能放回自己认领的订单');
    }
    if (userStudioId) {
      const visibleIds = await this.bridgeService.getInboundSharedStudioIds(userStudioId, 'ORDERS');
      if (!visibleIds.includes(order.studioId)) throw new ForbiddenException('无权操作其他工作室的订单');
    }

    const existingFields = (order.customFields as Record<string, unknown>) || {};
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'CLAIMED' },
      data: {
        status: 'PENDING',
        dispatchType: 'POOL',
        customFields: { ...existingFields, urgency: urgency || 'now' } as any,
      },
    });
    if (result.count === 0) throw new ForbiddenException('订单状态已变更');

    const updated = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, displayName: true, avatar: true } },
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
      },
    });
    if (!updated) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async updatePayment(
    orderId: string,
    dto: {
      paymentAccountId?: string;
      companionFeeStatus?: string;
      companionFeeMethod?: string;
      companionFeeAccount?: string;
      companionFeeAmount?: number;
      customerPaidTo?: string;
      customerPaymentAccountId?: string;
      customerPaymentAccountName?: string;
    },
    user: any,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('订单不存在');
    if (user.role === 'CS' && order.csUserId !== user.id && order.claimedCsUserId !== user.id) {
      throw new Error('只能更新自己发布或认领的订单');
    }

    const data: any = {};
    if (dto.paymentAccountId !== undefined) data.paymentAccountId = dto.paymentAccountId || null;
    if (dto.companionFeeStatus !== undefined) data.companionFeeStatus = dto.companionFeeStatus;
    if (dto.companionFeeMethod !== undefined) data.companionFeeMethod = dto.companionFeeMethod;
    if (dto.companionFeeAccount !== undefined) data.companionFeeAccount = dto.companionFeeAccount;
    if (dto.companionFeeAmount !== undefined) data.companionFeeAmount = dto.companionFeeAmount;
    if (dto.customerPaidTo !== undefined) data.customerPaidTo = dto.customerPaidTo || null;
    if (dto.customerPaymentAccountId !== undefined) data.customerPaymentAccountId = dto.customerPaymentAccountId || null;
    if (dto.customerPaymentAccountName !== undefined) data.customerPaymentAccountName = dto.customerPaymentAccountName || null;
    return this.prisma.order.update({ where: { id: orderId }, data });
  }
}
