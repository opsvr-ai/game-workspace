import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { OrderStatus } from '@chunlv/shared';

const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderStatus.PENDING]: [OrderStatus.GRABBED, OrderStatus.CANCELLED],
  [OrderStatus.GRABBED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.DONE, OrderStatus.CANCELLED],
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  private validateTransition(order: { id: string; status: string }, targetStatus: string) {
    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new ForbiddenException(
        `不允许从 ${order.status} 转换到 ${targetStatus}`,
      );
    }
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
        dispatchType: 'POOL',
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        status: 'PENDING',
        amount: dto.amount,
        gameName: dto.gameName,
        duration: dto.duration,
        customFields: {
          customerSource: (dto as any).customerSource,
          customerPlatformAccount: (dto as any).customerPlatformAccount,
          customerWechat: dto.customerWechat,
          customerRoomCode: dto.customerRoomCode,
          deltaMode: (dto as any).deltaMode,
          deltaMission: (dto as any).deltaMission,
          deltaCount: (dto as any).deltaCount,
          deltaNote: (dto as any).deltaNote,
          billingMode: (dto as any).billingMode,
          urgency: (dto as any).urgency,
        },
        isOnline: dto.isOnline ?? true,
      },
      include: { customer: true },
    });

    if (studioId && newOrder.dispatchType === 'POOL') {
      this.wsGateway.broadcastToStudio(studioId, 'order:pool_updated', newOrder);
    }

    return newOrder;
  }

  async findPool(companionId?: string) {
    return this.prisma.order.findMany({
      where: {
        status: 'PENDING', dispatchType: 'POOL',
        OR: companionId ? [
          { companionId: null },
          { companionId: companionId },
        ] : [
          { companionId: null },
        ],
      },
      include: {
        customer: { select: { wechatId: true, customerCode: true, platform: true } },
        csUser: { select: { username: true, avatar: true, displayName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(user: any, status?: string, showAll?: boolean) {
    const where: any = {};
    if (status) where.status = status;
    if (!showAll) {
      if (user.role === 'COMPANION') {
      where.companionId = user.companionId;
      if (!status) where.NOT = { status: 'PENDING' };
    }
      else if (user.role === 'CS') where.csUserId = user.id;
      else if (user.role === 'ADMIN') where.studioId = user.studioId;
    }
    // OWNER: 不添加过滤条件，可以看到所有订单
    return this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async grab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.GRABBED);
    if (
      order.dispatchType !== 'POOL' ||
      order.companionId !== null
    ) {
      throw new ForbiddenException('该订单不可抢');
    }

    // Revenue threshold check — skip for peer orders (created by companions)
    const creator = await this.prisma.user.findUnique({ where: { id: order.csUserId }, select: { role: true } });
    const isPeerOrder = creator?.role === 'COMPANION';

    if (!isPeerOrder) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayOrders = await this.prisma.order.findMany({
        where: { companionId, status: 'DONE', createdAt: { gte: today, lt: tomorrow } },
      });
      const todayRevenue = todayOrders.reduce((s, o) => s + o.amount, 0);

      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'revenue.unlock_threshold' },
      });
      const threshold = (config?.value as number) ?? 100;

      if (todayRevenue < threshold) {
        throw new ForbiddenException(
          `今日流水 ¥${todayRevenue}，未达到解锁门槛 ¥${threshold}，还差 ¥${threshold - todayRevenue}`,
        );
      }
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
      include: { csUser: { select: { username: true, avatar: true, displayName: true } }, companion: { include: { user: { select: { username: true, avatar: true, displayName: true } } } } },
    });
    this.wsGateway.broadcastToStudio(updatedOrder.studioId, 'order:pool_updated', updatedOrder);

    // Notify the CS who created this order about the grab
    if (updatedOrder.csUserId) {
      const companionName = updatedOrder.companion?.user?.username ?? '未知';
      this.wsGateway.notifyUser(updatedOrder.csUserId, 'order:grabbed', {
        orderId: updatedOrder.id,
        companionName,
        message: `${companionName} 抢了你的订单`,
      });
    }
    return updatedOrder;
  }

  async updateContact(orderId: string, body: any) {
    const data: any = {};
    if (body.contactStatus !== undefined) data.contactStatus = body.contactStatus;
    if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt);
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.screenshotUrl !== undefined) data.screenshotUrl = body.screenshotUrl;
    const updated = await this.prisma.order.update({ where: { id: orderId }, data, include: { customer: true } });

    // When contact status is set to 'added', create/update customer record
    if (body.contactStatus === 'added' && updated.customer) {
      await this.prisma.customer.upsert({
        where: { id: updated.customerId },
        update: { companionId: updated.companionId },
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
    return updated;
  }

  async updateAmount(orderId: string, amount: number) {
    return this.prisma.order.update({ where: { id: orderId }, data: { amount } });
  }

  async renew(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new (require('@nestjs/common').NotFoundException)('订单不存在');
    return this.prisma.order.create({
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
        customFields: { ...(order.customFields as any || {}), renewedFrom: orderId },
        status: 'CONFIRMED',
      },
    });
  }

  async republish(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new (require('@nestjs/common').NotFoundException)('订单不存在');
    return this.prisma.order.create({
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
  }

  async assign(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== OrderStatus.PENDING) {
      throw new ForbiddenException('只能指派待处理状态的订单');
    }
    if (order.companionId !== null) {
      throw new ForbiddenException('该订单已被指派');
    }
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { dispatchType: 'DIRECT', companionId },
    });
    this.wsGateway.pushOrder(companionId, updatedOrder);
    return updatedOrder;
  }

  async confirm(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CONFIRMED);
    if (order.companionId !== companionId) throw new ForbiddenException('无权确认此订单');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });
  }

  async complete(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.DONE);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DONE },
    });
  }

  async completeWithBilling(orderId: string, companionId: string, dto: {
    customerCode?: string;
    firstOrder: { duration: number; price: number };
    hasRenew?: boolean;
    renewOrder?: { duration: number; price: number };
    gameName: string;
    type: string; // 'COMPANION' | 'ESCORT'
    screenshotUrl?: string;
    wechatId?: string;
  }) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.DONE);

    // Detect customer type
    const customer = dto.customerCode
      ? await this.prisma.customer.findUnique({ where: { customerCode: dto.customerCode } })
      : await this.prisma.customer.findUnique({ where: { id: order.customerId } });

    if (!customer) throw new NotFoundException('客户不存在');

    const orderCount = await this.prisma.order.count({
      where: { customerId: customer.id, status: 'DONE' },
    });

    const customerType = orderCount === 0 ? 'NEW' : 'REPURCHASE';

    // Calculate totals
    const firstAmount = dto.firstOrder.duration * dto.firstOrder.price;
    const renewAmount = dto.hasRenew && dto.renewOrder
      ? dto.renewOrder.duration * dto.renewOrder.price
      : 0;
    const totalAmount = firstAmount + renewAmount;
    const totalDuration = dto.firstOrder.duration + (dto.renewOrder?.duration || 0);

    // Update the main order as DONE
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DONE,
        type: customerType,
        amount: totalAmount,
        duration: totalDuration,
        gameName: dto.gameName,
        customFields: {
          ...((order.customFields as any) || {}),
          firstOrder: dto.firstOrder,
          renewOrder: dto.renewOrder || null,
          hasRenew: dto.hasRenew || false,
          customerType,
          settlementType: dto.type,
          screenshotUrl: dto.screenshotUrl,
          wechatId: dto.wechatId,
        },
      },
    });

    // If hasRenew, create a separate RENEW order
    if (dto.hasRenew && dto.renewOrder) {
      await this.prisma.order.create({
        data: {
          type: 'RENEW',
          studioId: order.studioId,
          csUserId: order.csUserId,
          companionId,
          customerId: order.customerId,
          dispatchType: 'DIRECT',
          status: OrderStatus.DONE,
          amount: renewAmount,
          gameName: dto.gameName,
          duration: dto.renewOrder.duration,
          customFields: { parentOrderId: orderId },
        },
      });
    }

    // Update customer total spent
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { totalSpent: { increment: totalAmount } },
    });

    // Update companion revenue
    await this.prisma.companion.update({
      where: { id: companionId },
      data: { monthlyRevenue: { increment: totalAmount } },
    });

    // Update customer status
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { status: 'ACTIVE' },
    });

    return updatedOrder;
  }

  async cancel(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CANCELLED);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
  }

  async callPartner(orderId: string, callerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order) throw new NotFoundException('订单不存在');
    this.wsGateway.broadcastToStudio(order.studioId, 'order:partner_call', {
      orderId, callerId, customerName: order.customer?.customerCode, gameName: order.gameName, amount: order.amount
    });
    return { ok: true };
  }

  async acceptPartner(orderId: string, partnerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    return this.prisma.order.update({ where: { id: orderId }, data: { customFields: { ...((order.customFields as any)||{}), partnerId } } });
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
