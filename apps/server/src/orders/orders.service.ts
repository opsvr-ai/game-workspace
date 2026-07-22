// craftsman-ignore: TS001,TS003
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

    // Resolve customerId: create a placeholder if not provided
    let customerId = dto.customerId;
    if (!customerId && studioId) {
      const placeholder = await this.prisma.customer.create({
        data: {
          studioId,
          wechatId: dto.customerWechat || '',
          customerCode: `T${Date.now().toString(36).toUpperCase()}`,
        },
      });
      customerId = placeholder.id;
    }

    const newOrder = await this.prisma.order.create({
      data: {
        type: dto.type,
        studioId: studioId!,
        csUserId: dto.csUserId,
        customerId: customerId!,
        dispatchType: dto.dispatchType === 'BROADCAST' ? 'POOL' : dto.dispatchType,
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        coCompanionId: dto.dispatchType === 'DIRECT' ? ((dto as any).coCompanionId ?? null) : null,
        status: 'PENDING',
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
          urgency: (dto as any).urgency,
          serviceType: (dto as any).serviceType ?? 'PLAY_WITH',
          gameMode: (dto as any).gameMode,
        },
        isOnline: dto.isOnline ?? true,
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
      this.wsGateway.broadcastToIdleCompanions(studioId, 'order:urgent', {
        ...newOrder,
        _createdBy: csUser?.username || '未知',
        _creatorRole: csUser?.role || 'CS',
      });
    }

    if (studioId && newOrder.dispatchType === 'POOL') {
      this.wsGateway.broadcastToBridgedStudios(studioId, 'order:pool_updated', newOrder);
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
      this.wsGateway.broadcastToBridgedStudios(studioId, 'order:new', {
        ...newOrder,
        _notify: true,
      });
    }

    return newOrder;
  }

  async findPool(companionId?: string, studioId?: string, studioType?: string) {
    const where: any = {
      status: 'PENDING',
      dispatchType: 'POOL',
      OR: companionId ? [{ companionId: null }, { companionId: companionId }] : [{ companionId: null }],
    };
    if (studioId) {
      const bridgedIds = await this.bridgeService.getBridgedStudioIds(studioId);
      where.studioId = { in: [studioId, ...bridgedIds] };
    }

    // Non-DIRECT studios: exclude orders created within the last 1 minute
    if (studioType && studioType !== 'DIRECT') {
      const oneMinuteAgo = new Date(Date.now() - 60_000);
      where.createdAt = { lte: oneMinuteAgo };
    }

    return this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
        studio: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    return this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
        coCompanion: { include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
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
    // H1 fix: create as PENDING+DIRECT, companion accepts via standard flow
    const newOrder = await this.prisma.order.create({
      data: {
        type: 'RENEW',
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        companionId: order.companionId,
        dispatchType: 'DIRECT',
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
    this.wsGateway.broadcastToBridgedStudios(order.studioId, 'order:pool_updated', newOrder);
    return newOrder;
  }

  async republish(orderId: string, userId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const newOrder = await this.prisma.order.create({
      data: {
        type: order.type,
        studioId: order.studioId,
        csUserId: userId,
        customerId: order.customerId,
        dispatchType: 'POOL',
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

  async markReady(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { companionId: true } });
    if (!order || order.companionId !== companionId) throw new ForbiddenException('无权操作此订单');
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { customFields: { partnerReady: true, partnerId: companionId } as any },
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
    },
  ) {
    return this.workflowService.completeWithBilling(orderId, companionId, dto);
  }

  async cancel(orderId: string, userStudioId?: string, companionId?: string, role?: string) {
    return this.workflowService.cancel(orderId, userStudioId, companionId, role);
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
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        coCompanionId: partnerId,
        customFields: { ...((order.customFields as any) || {}), partnerId },
      },
    });
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
}
