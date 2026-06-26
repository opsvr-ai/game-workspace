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
        dispatchType: dto.dispatchType,
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        status: 'PENDING',
        amount: dto.amount,
        gameName: dto.gameName,
        duration: dto.duration,
        customFields: {
          customerWechat: dto.customerWechat,
          customerRoomCode: dto.customerRoomCode,
          deltaMode: (dto as any).deltaMode,
          deltaMission: (dto as any).deltaMission,
          deltaCount: (dto as any).deltaCount,
          deltaNote: (dto as any).deltaNote,
          billingMode: (dto as any).billingMode,
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

  async findPool() {
    return this.prisma.order.findMany({
      where: { status: 'PENDING', dispatchType: 'POOL', companionId: null },
      include: { customer: { select: { wechatId: true, customerCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(user: any, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (user.role === 'COMPANION') where.companionId = user.companionId;
    else if (user.role === 'CS') where.csUserId = user.id;
    else if (user.role === 'ADMIN') where.studioId = user.studioId;
    // OWNER: 不添加过滤条件，可以看到所有订单
    return this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        companion: { include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async grab(orderId: string, companionId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.GRABBED);
    if (
      order.dispatchType !== 'POOL' ||
      order.companionId !== null
    ) {
      throw new ForbiddenException('该订单不可抢');
    }
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.GRABBED, companionId: companionId || null },
    });
    this.wsGateway.broadcastToStudio(updatedOrder.studioId, 'order:pool_updated', updatedOrder);
    return updatedOrder;
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

  async cancel(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    this.validateTransition(order, OrderStatus.CANCELLED);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
  }
}
