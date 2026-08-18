// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { BridgeService } from '../studios/bridge.service';
import { OrderWorkflowService } from './order-workflow.service';
import { OrderDispatchService } from './order-dispatch.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
    private bridgeService: BridgeService,
    private readonly workflowService: OrderWorkflowService,
    private readonly dispatchService: OrderDispatchService,
  ) {}

  private async nextGlobalCode(): Promise<string> {
    const cfg = await this.prisma.systemConfig.upsert({
      where: { key: 'counter.global_code' },
      create: { key: 'counter.global_code', value: '0' },
      update: {},
    });
    const current = parseInt(cfg.value as string, 10) || 0;
    const next = current + 1;
    await this.prisma.systemConfig.update({
      where: { key: 'counter.global_code' },
      data: { value: String(next) },
    });
    return String(next);
  }

  async create(dto: {
    type: string;
    studioId?: string;
    csUserId: string;
    customerId?: string;
    customerWechat?: string;
    customerRoomCode?: string;
    dispatchType: string;
    amount: number;
    gameName: string;
    duration?: number;
    customFields?: any;
    isOnline?: boolean;
    companionId?: string;
  }) {
    // Resolve studioId: from dto or from CS user's studio
    let studioId = dto.studioId;
    if (!studioId) {
      const csUser = await this.prisma.user.findUnique({ where: { id: dto.csUserId } });
      studioId = csUser?.studioId ?? undefined;
    }
    if (!studioId) throw new NotFoundException('无法确定订单所属工作室');

    // COMPANION can only create orders for themselves (not for other companions)
    const creator = await this.prisma.user.findUnique({ where: { id: dto.csUserId }, select: { role: true } });
    if (creator?.role === 'COMPANION' && dto.dispatchType === 'DIRECT' && dto.companionId) {
      const companion = await this.prisma.companion.findUnique({
        where: { userId: dto.csUserId },
        select: { id: true },
      });
      if (!companion || dto.companionId !== companion.id) {
        throw new ForbiddenException('陪玩只能给自己创建直接派单');
      }
    }

    // Resolve customerId: create a placeholder if not provided
    let customerId = dto.customerId;
    if (!customerId && studioId) {
      const customerCode = await this.nextGlobalCode();
      const placeholder = await this.prisma.customer.create({
        data: {
          studioId,
          wechatId: dto.customerWechat || '',
          customerCode,
        },
      });
      customerId = placeholder.id;
    }

    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: dto.type,
        studioId: studioId!,
        csUserId: dto.csUserId,
        customerId: customerId!,
        dispatchType: dto.dispatchType === 'BROADCAST' ? 'POOL' : dto.dispatchType,
        source: (dto as any).source ?? 'OFFLINE',
        attributedCsUserId: (dto as any).attributedCsUserId ?? dto.csUserId,
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        coCompanionId: dto.dispatchType === 'DIRECT' ? ((dto as any).coCompanionId ?? null) : null,
        coAmount: (dto as any).coAmount ?? null,
        status: dto.dispatchType === 'DIRECT' && dto.companionId ? 'CONFIRMED' : 'PENDING',
        amount: dto.amount,
        gameName: dto.gameName,
        serviceType: (dto as any).serviceType ?? 'PLAY_WITH',
        duration: dto.duration,
        customFields: {
          customerSource: (dto as any).customerSource,
          customerSourceAccount: (dto as any).customerSourceAccount,
          customerPlatformAccount: (dto as any).customerPlatformAccount,
          customerWechat: dto.customerWechat,
          customerRoomCode: dto.customerRoomCode,
          customerYy: (dto as any).customerYy,
          deltaMission: (dto as any).deltaMission,
          deltaCount: (dto as any).deltaCount,
          deltaNote: (dto as any).deltaNote,
          billingMode: (dto as any).billingMode,
          transferScreenshotUrl: (dto as any).transferScreenshotUrl || undefined,
          urgency: (dto as any).urgency,
          scheduledTimeText: (dto as any).scheduledTimeText || undefined,
          serviceType: (dto as any).serviceType ?? 'PLAY_WITH',
          gameMode: (dto as any).gameMode,
          isCompensation: (dto as any).isCompensation === true ? true : undefined,
        },
        isOnline: dto.isOnline ?? true,
        paymentAccountId: (dto as any).paymentAccountId || null,
      },
      include: { customer: true },
    });

    // BROADCAST: send to ALL idle companions
    if (dto.dispatchType === 'BROADCAST' && studioId) {
      const csUser = await this.prisma.user.findUnique({
        where: { id: dto.csUserId },
        select: { username: true, role: true },
      });
      this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
        _broadcast: true,
      });
    }

    // Urgent orders: broadcast to all IDLE companions (first-come-first-served)
    const isUrgent = (dto as any).urgency === 'now';
    if (studioId && isUrgent) {
      const csUser = await this.prisma.user.findUnique({
        where: { id: dto.csUserId },
        select: { username: true, role: true },
      });
      const bridgeWindowCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'dispatch.bridge_immediate_window_sec' },
      });
      const bridgeWindowSec = Number(bridgeWindowCfg?.value ?? 60);
      const payload = {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
      };
      const sent = await this.wsGateway.broadcastToQualifiedIdleCompanions(studioId, 'order:urgent', payload);
      if (sent === 0) {
        const bridgeSent = await this.wsGateway.broadcastToBridgedIdleCompanions(studioId, 'order:urgent', payload);
        if (bridgeSent === 0) {
          await this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', payload);
        } else {
          // 线上有推送但限时内未接，则回落到线下普通空闲
          setTimeout(async () => {
            const stillPending = await this.prisma.order.findFirst({
              where: { id: newOrder.id, status: 'PENDING' },
              select: { id: true },
            });
            if (stillPending) {
              await this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', payload);
            }
          }, bridgeWindowSec * 1000);
        }
      }
    }

    // Auto-create first session when order is created
    if (newOrder.companionId) {
      if (newOrder.dispatchType === 'DIRECT') {
        await this.prisma.companion
          .update({ where: { id: newOrder.companionId }, data: { status: 'BUSY' } })
          .catch(() => {});
      }
      await this.prisma.orderSession
        .create({
          data: {
            parentOrderId: newOrder.id,
            seq: 1,
            companionId: newOrder.companionId,
            coCompanionId: newOrder.coCompanionId,
            amount: newOrder.amount,
            coAmount: (newOrder as any).coAmount ?? null,
            duration: newOrder.duration || 1,
            status: 'ACTIVE',
          },
        })
        .catch(() => {});
    }

    if (studioId && newOrder.dispatchType === 'POOL') {
      if (isUrgent) {
        this.wsGateway.broadcastToBridgedStudios(studioId, 'order:pool_updated', newOrder);
      } else {
        this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', newOrder);
      }
    }

    // Desktop notification: DIRECT → only target companion; POOL/BROADCAST → all
    if (dto.dispatchType === 'DIRECT' && dto.companionId) {
      const csUser = await this.prisma.user.findUnique({ where: { id: dto.csUserId }, select: { username: true } });
      const isBuDan =
        (dto as any).deltaNote?.includes('补单') || (newOrder.customFields as any)?.deltaNote?.includes('补单');
      this.wsGateway.pushOrder(dto.companionId, {
        ...newOrder,
        _inviterName: csUser?.username || '系统',
        _isAssignment: true,
        _label: isBuDan ? '补单' : '新订单',
      });
    } else if (studioId) {
      if (isUrgent) {
        this.wsGateway.broadcastToBridgedStudios(studioId, 'order:new', {
          ...newOrder,
          _notify: true,
        });
      } else {
        this.wsGateway.broadcastToStudio(studioId, 'order:new', {
          ...newOrder,
          _notify: true,
        });
      }
    }

    return newOrder;
  }

  async findPool(companionId?: string, studioId?: string, studioType?: string) {
    const where: any = {
      status: 'PENDING',
      dispatchType: 'POOL',
      OR: companionId ? [{ companionId: null }, { companionId: companionId }] : [{ companionId: null }],
    };
    if (!studioId) return [];
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
    where.studioId = { in: [studioId, ...bridgedIds] };

    const [priorityCfg, offlineCfg, bridgeCfg, onlineCfg] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.priority_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.offline_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.bridge_delay_seconds' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'pool.online_delay_seconds' } }),
    ]);
    const priorityDelay = Number(priorityCfg?.value ?? 0) * 1000;
    const offlineDelay = Number(offlineCfg?.value ?? 60) * 1000;
    const bridgeDelay = Number(bridgeCfg?.value ?? 120) * 1000;
    const onlineDelay = Number(onlineCfg?.value ?? 180) * 1000;
    if (studioType === 'RENTAL') {
      where.createdAt = { lte: new Date(Date.now() - onlineDelay) };
    } else if (studioType && studioType !== 'DIRECT') {
      where.createdAt = { lte: new Date(Date.now() - bridgeDelay) };
    } else if (companionId) {
      const excellent = await this.isExcellentCompanion(companionId);
      where.createdAt = { lte: new Date(Date.now() - (excellent ? priorityDelay : offlineDelay)) };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    // 已过消失时间、标记为待客服处理的订单不再出现在抢单池
    return orders.filter((o) => !(o.customFields as any)?.poolExpired);
  }

  private async isExcellentCompanion(companionId: string): Promise<boolean> {
    const done = await this.prisma.order.findMany({
      where: { companionId, status: 'DONE' },
      select: { type: true },
    });
    if (done.length === 0) return false;
    const renew = done.filter((o) => o.type === 'RENEW' || o.type === 'REPURCHASE').length;
    return renew / done.length >= 0.3;
  }

  async findAll(user: any, status?: string, showAll?: boolean) {
    const where: any = {};
    if (status) where.status = status;
    // Role-based filtering (showAll only bypasses for OWNER — security fix C4)
    if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
      if (!status) where.NOT = { status: 'PENDING', dispatchType: 'POOL' };
    } else if (user.role === 'CS') {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
      where.studioId = { in: [user.studioId, ...bridgedIds] };
    } else if (user.role === 'ADMIN') {
      if (!showAll) {
        const bridgedIds = await this.bridgeService.getBridgedStudioIds(user.studioId);
        where.studioId = { in: [user.studioId, ...bridgedIds] };
      }
    }
    // OWNER: 不添加过滤条件，可以看到所有订单
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        csUser: { select: { id: true, username: true, avatar: true, displayName: true, role: true } },
        claimedCsUser: { select: { id: true, username: true, avatar: true, displayName: true } },
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Mask source account from non-creators (privacy)
    return orders.map((o) => {
      if (o.csUserId !== user.id && o.customFields) {
        const cf = o.customFields as any;
        if (cf.customerSourceAccount) {
          return { ...o, customFields: { ...cf, customerSourceAccount: '***' } };
        }
      }
      return o;
    });
  }

  async grab(orderId: string, companionId: string) {
    return this.workflowService.grab(orderId, companionId);
  }

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
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
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

  async compensateCustomer(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const customer = await this.prisma.customer.create({
      data: {
        studioId: order.studioId,
        wechatId: 'BC-' + order.id.slice(0, 8),
        companionId: order.companionId,
        customerCode: 'BC' + Date.now().toString(36).toUpperCase(),
        notes: '补单客户（原订单 ' + order.id + '）',
      },
    });
    return customer;
  }

  async renew(orderId: string, userId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: 'RENEW',
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        companionId: order.companionId,
        coCompanionId: order.coCompanionId,
        coAmount: order.coAmount,
        dispatchType: 'DIRECT',
        source: order.source,
        attributedCsUserId: order.attributedCsUserId ?? order.claimedCsUserId ?? order.csUserId,
        amount: order.amount,
        gameName: order.gameName,
        duration: order.duration,
        customFields: { ...((order.customFields as any) || {}), renewedFrom: orderId },
        status: 'PENDING',
      },
    });
    if (order.companionId) {
      this.wsGateway.pushOrder(order.companionId, newOrder);
    }
    if (order.coCompanionId) {
      this.wsGateway.pushOrder(order.coCompanionId, newOrder);
      this.wsGateway.broadcastToStudio(order.studioId, 'order:dual-request', {
        orderId: newOrder.id,
        companionId: order.companionId,
        coCompanionId: order.coCompanionId,
      });
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', newOrder);
    return newOrder;
  }

  async republish(orderId: string, userId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const orderCode = await this.nextGlobalCode();
    const newOrder = await this.prisma.order.create({
      data: {
        orderCode,
        type: order.type,
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        dispatchType: 'POOL',
        source: order.source,
        attributedCsUserId: order.attributedCsUserId ?? order.claimedCsUserId ?? order.csUserId,
        amount: order.amount,
        gameName: order.gameName,
        duration: order.duration,
        customFields: order.customFields as any,
        status: 'PENDING',
      },
      include: { csUser: { select: { username: true, avatar: true, displayName: true, role: true } } },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', newOrder);
    return newOrder;
  }

  async assign(orderId: string, companionId: string, userStudioId?: string) {
    return this.dispatchService.assign(orderId, companionId, userStudioId);
  }

  async acceptAssignment(orderId: string, companionId: string) {
    return this.dispatchService.acceptAssignment(orderId, companionId);
  }

  async declineAssignment(orderId: string, companionId: string) {
    return this.dispatchService.declineAssignment(orderId, companionId);
  }

  async quickGrab(orderId: string, companionId: string) {
    return this.dispatchService.quickGrab(orderId, companionId);
  }

  async findUrgent(studioId: string) {
    const now = Date.now();
    const disappearCfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'pool.immediate_disappear_minutes' },
    });
    const disappearSeconds = Number(disappearCfg?.value ?? 10) * 60;
    const orders = await this.prisma.order.findMany({
      where: { studioId, status: 'PENDING', dispatchType: 'POOL' },
      include: {
        customer: { select: { wechatId: true, customerCode: true } },
        csUser: { select: { username: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const list = await Promise.all(
      orders
        .filter((o) => {
          const cf = (o.customFields as any) || {};
          if (cf.poolHandled) return false;
          // 立即打：全部显示（加急+待处理）；预约：只显示已过期的待处理
          return cf.urgency === 'now' || (cf.urgency === 'later' && cf.poolExpired);
        })
        .map(async (o) => {
          const cf = (o.customFields as any) || {};
          const isScheduled = cf.urgency === 'later';
          const waitingSeconds = Math.max(0, Math.floor((now - o.createdAt.getTime()) / 1000));
          const poolExpired = !!cf.poolExpired;
          const availableCompanions =
            !isScheduled && waitingSeconds >= 300
              ? await this.getSoonEndingCompanions(studioId)
              : [];
          return {
            id: o.id,
            orderCode: o.orderCode,
            customerWechat: o.customer?.wechatId || cf.customerWechat || '',
            gameName: o.gameName,
            gameMode: cf.gameMode || '',
            amount: o.amount,
            duration: o.duration,
            waitingSeconds,
            urgent: !isScheduled,
            poolExpired,
            poolExpiredAt: cf.poolExpiredAt || '',
            isScheduled,
            requireCsContact: poolExpired || (!isScheduled && waitingSeconds >= disappearSeconds),
            csContactStatus: o.contactStatus || '',
            csContactEvidenceUrl: cf.csContactEvidenceUrl || '',
            customFields: cf,
            availableCompanions,
          };
        }),
    );

    // 已消失（待客服处理）的订单排最前
    return list.sort((a, b) => Number(b.poolExpired) - Number(a.poolExpired));
  }

  async markCsContact(
    orderId: string,
    status: string,
    evidenceUrl?: string,
    extra?: { workWechatId?: string; workWechatName?: string; addResult?: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const cf = (order.customFields as any) || {};
    const handled = status === 'added' && !!evidenceUrl && extra?.addResult === 'passed';
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        contactStatus: status,
        customFields: {
          ...cf,
          csContactAt: new Date().toISOString(),
          csContactEvidenceUrl: evidenceUrl || '',
          ...(extra?.workWechatId !== undefined ? { csWorkWechatId: extra.workWechatId } : {}),
          ...(extra?.workWechatName !== undefined ? { csWorkWechatName: extra.workWechatName } : {}),
          ...(extra?.addResult !== undefined ? { csAddResult: extra.addResult } : {}),
          ...(handled ? { poolHandled: true } : {}),
        },
      },
    });
  }

  async redispatch(orderId: string, studioId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'PENDING' || order.dispatchType !== 'POOL') {
      throw new ForbiddenException('该订单当前不可重新派单');
    }
    if (studioId && order.studioId !== studioId) {
      throw new ForbiddenException('无权操作其他工作室的订单');
    }
    const cf = (order.customFields as any) || {};
    delete cf.poolExpired;
    delete cf.poolExpiredAt;
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        customFields: cf,
        createdAt: new Date(), // 重置发单时间，让等待时间重新计算
      },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markPoolHandled(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    const cf = (order.customFields as any) || {};
    return this.prisma.order.update({
      where: { id: orderId },
      data: { customFields: { ...cf, poolHandled: true, poolHandledAt: new Date().toISOString() } },
    });
  }

  async listCsFollowup(studioId: string) {
    const orders = await this.prisma.order.findMany({
      where: { studioId, status: 'PENDING' },
      include: {
        customer: { select: { wechatId: true, customerCode: true } },
        csUser: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.filter((o) => (o.customFields as any)?.csAddResult === 'passed');
  }

  async listMoneyFlows(orderId: string) {
    return this.prisma.orderMoneyFlow.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  async addMoneyFlow(
    orderId: string,
    data: { direction: string; amount: number; counterpart: string; counterpartId?: string; note?: string },
  ) {
    return this.prisma.orderMoneyFlow.create({
      data: {
        orderId,
        direction: data.direction,
        amount: data.amount,
        counterpart: data.counterpart,
        counterpartId: data.counterpartId,
        note: data.note,
      },
    });
  }

  private async getSoonEndingCompanions(studioId: string) {
    const companions = await this.prisma.companion.findMany({
      where: { studioId, status: 'BUSY' },
      include: {
        user: { select: { username: true } },
        sessions: {
          where: { endedAt: null },
          include: { parentOrder: { select: { duration: true, amount: true } } },
        },
      },
    });
    const list = await Promise.all(
      companions.map(async (c) => {
        const excellent = await this.isExcellentCompanion(c.id);
        const remainingMinutes = c.sessions
          .map((s) => {
            if (!s.startedAt) return 999;
            const durationMs = (s.parentOrder?.duration || 1) * 3600_000;
            return Math.max(0, Math.round((durationMs - (Date.now() - s.startedAt.getTime())) / 60000));
          })
          .sort((a, b) => a - b)[0] ?? 999;
        return { id: c.id, name: c.user?.username || c.id, excellent, remainingMinutes };
      }),
    );
    return list.sort((a, b) => Number(b.excellent) - Number(a.excellent) || a.remainingMinutes - b.remainingMinutes);
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
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
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
      const visibleIds = await this.bridgeService.getVisibleStudioIds(userStudioId);
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

  async markReady(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { companionId: true, coCompanionId: true, customFields: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    // 允许主陪或搭档标记就绪（双陪中通常由搭档点“我已准备好”）
    if (order.companionId !== companionId && order.coCompanionId !== companionId) {
      throw new ForbiddenException('无权操作此订单');
    }
    const existingFields = (order.customFields as Record<string, unknown>) || {};
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { customFields: { ...existingFields, partnerReady: true, partnerId: companionId } as any },
    });
    this.wsGateway.broadcastToBridgedStudios(updated.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async confirm(orderId: string, companionId: string) {
    return this.workflowService.confirm(orderId, companionId);
  }

  async complete(orderId: string, userStudioId?: string, companionId?: string, role?: string) {
    return this.workflowService.complete(orderId, undefined, userStudioId, companionId, role);
  }

  async completeWithBilling(
    orderId: string,
    companionId: string,
    dto: {
      customerCode?: string;
      firstOrder: { duration: number; price: number };
      hasRenew?: boolean;
      renewOrder?: { duration: number; price: number };
      gameName: string;
      type: string;
      screenshotUrl?: string;
      wechatId?: string;
      transferTotalYuan?: number;
    },
  ) {
    return this.workflowService.completeWithBilling(orderId, companionId, dto);
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string, reason?: string) {
    return this.workflowService.cancel(orderId, userStudioId, companionId, role, reason);
  }

  async callPartner(orderId: string, callerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order) throw new NotFoundException('订单不存在');
    // Only the assigned companion can call for a partner
    if (order.companionId !== callerId) throw new ForbiddenException('无权操作此订单');
    const caller = await this.prisma.companion.findUnique({
      where: { id: callerId },
      include: { studio: { select: { name: true } } },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:partner_call', {
      orderId,
      callerId,
      callerStudioName: caller?.studio?.name,
      customerName: order.customer?.customerCode,
      gameName: order.gameName,
      amount: order.amount,
    });
    return { ok: true };
  }

  async acceptPartner(orderId: string, partnerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    // Prevent the assigned companion from accepting their own partner call
    if (order.companionId === partnerId) throw new ForbiddenException('不能接受自己的协作请求');
    // Bridge validation: partner must be in same or bridged studio
    const partner = await this.prisma.companion.findUnique({
      where: { id: partnerId },
      select: { studioId: true },
    });
    if (!partner) throw new NotFoundException('陪玩不存在');
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(order.studioId);
    const allowedStudios = [order.studioId, ...bridgedIds];
    if (!allowedStudios.includes(partner.studioId)) {
      throw new ForbiddenException('无权接受其他工作室的协作请求');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        coCompanionId: partnerId,
        customFields: { ...((order.customFields as any) || {}), partnerId },
      },
    });
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markRefund(orderId: string, companionId?: string, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        notes: order.notes ? `${order.notes}\n[退款] ${reason || ''}` : `[退款] ${reason || ''}`,
      },
    });
    if (order.companionId) {
      await this.prisma.companion
        .update({ where: { id: order.companionId }, data: { status: 'AVAILABLE' } })
        .catch(() => {});
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async markDeposit(orderId: string, companionId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ForbiddenException('订单不存在');
    if (companionId && order.companionId !== companionId) throw new ForbiddenException('只能操作自己的订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'DEPOSITED', notes: order.notes ? `${order.notes}\n[存单]` : '[存单]' },
    });
    if (order.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId }, select: { notes: true } });
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: {
          notes: customer?.notes
            ? `${customer.notes}\n[存单 ¥${order.amount || 0}]`
            : `[存单 ¥${order.amount || 0}]`,
        },
      });
    }
    if (order.companionId) {
      await this.prisma.companion
        .update({ where: { id: order.companionId }, data: { status: 'AVAILABLE' } })
        .catch(() => {});
    }
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', updated);
    return updated;
  }

  async getPoolStatus(companionId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = await this.prisma.order.findMany({
      where: {
        companionId,
        status: 'DONE',
        createdAt: { gte: today, lt: tomorrow },
      },
    });
    const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'revenue.unlock_threshold' },
    });
    const threshold = (config?.value as number) ?? 100;

    return {
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      threshold,
      isUnlocked: todayRevenue >= threshold,
    };
  }

  async countPendingContact(studioId: string) {
    const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
    const studioIds = [studioId, ...bridgedIds];
    return this.prisma.order.count({
      where: {
        studioId: { in: studioIds },
        contactStatus: 'not_accepted',
        status: { not: 'CANCELLED' },
      },
    });
  }

  // ── Session management ──

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

  async addSession(
    orderId: string,
    dto: {
      companionId: string;
      coCompanionId?: string;
      amount: number;
      coAmount?: number;
      duration?: number;
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
    const session = await this.prisma.orderSession.create({
      data: {
        parentOrderId: orderId,
        seq,
        companionId: dto.companionId,
        coCompanionId: dto.coCompanionId || order?.coCompanionId || last?.coCompanionId || null,
        amount: dto.amount,
        coAmount: dto.coAmount ?? last?.coAmount ?? (order?.coAmount ?? null),
        duration: dto.duration || 1,
        status: 'ACTIVE',
      },
    });
    // Notify coCompanion if set
    if (order && session.coCompanionId) {
      this.wsGateway.pushOrder(session.coCompanionId, {
        ...session,
        gameName: order.gameName,
        customerId: order.customerId,
        orderId,
        type: 'DUAL_INVITE',
      });
    }
    this.wsGateway.broadcastToStudio(order?.studioId || '', 'order:pool_updated', session);
    return session;
  }

  private async getOwnedSession(id: string, companionId?: string) {
    const s = await this.prisma.orderSession.findUnique({
      where: { id },
      select: { id: true, companionId: true, pausedAt: true, totalPausedSec: true },
    });
    if (!s) throw new NotFoundException('会话不存在');
    if (companionId && s.companionId !== companionId) throw new ForbiddenException('只能操作自己的会话');
    return s;
  }

  async startSession(
    id: string,
    companionId?: string,
    claims?: { claimedMode?: string; claimedPrice?: number; transferScreenshotUrl?: string; duration?: number },
  ) {
    await this.getOwnedSession(id, companionId);
    const data: any = { startedAt: new Date() };
    if (claims) {
      if (!claims.claimedMode) throw new BadRequestException('请填写游戏模式');
      if (claims.claimedPrice == null || !Number.isFinite(claims.claimedPrice) || claims.claimedPrice <= 0) throw new BadRequestException('请填写有效单价');
      if (claims.duration == null || !Number.isFinite(claims.duration) || claims.duration <= 0) throw new BadRequestException('请填写有效时长');
      if (!claims.transferScreenshotUrl) throw new BadRequestException('请上传客户转账截图');
      data.claimedMode = claims.claimedMode;
      data.claimedPrice = claims.claimedPrice;
      data.transferScreenshotUrl = claims.transferScreenshotUrl;
      data.duration = claims.duration;
    }
    return this.prisma.orderSession.update({ where: { id }, data });
  }
  async pauseSession(id: string, companionId?: string) {
    await this.getOwnedSession(id, companionId);
    return this.prisma.orderSession.update({ where: { id }, data: { pausedAt: new Date() } });
  }
  async resumeSession(id: string, companionId?: string) {
    const s = await this.getOwnedSession(id, companionId);
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
    return this.prisma.orderSession.update({ where: { id }, data });
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
