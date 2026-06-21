import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: {
    type: string;
    studioId: string;
    csUserId: string;
    customerId: string;
    dispatchType: string;
    amount: number;
    gameName: string;
    duration?: number;
    customFields?: any;
    isOnline: boolean;
    companionId?: string;
  }) {
    return this.prisma.order.create({
      data: {
        type: dto.type,
        studioId: dto.studioId,
        csUserId: dto.csUserId,
        customerId: dto.customerId,
        dispatchType: dto.dispatchType,
        companionId: dto.dispatchType === 'DIRECT' ? dto.companionId : null,
        status: 'PENDING',
        amount: dto.amount,
        gameName: dto.gameName,
        duration: dto.duration,
        customFields: dto.customFields,
        isOnline: dto.isOnline,
      },
      include: { customer: true },
    });
  }

  async findPool() {
    return this.prisma.order.findMany({
      where: { status: 'PENDING', dispatchType: 'POOL', companionId: null },
      include: { customer: { select: { wechatId: true, customerCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(user: any) {
    const where: any = {};
    if (user.role === 'COMPANION') where.companionId = user.companionId;
    else if (user.role === 'CS') where.csUserId = user.id;
    else if (user.role === 'ADMIN') where.studioId = user.studioId;
    return this.prisma.order.findMany({
      where,
      include: {
        customer: true,
        companion: { include: { user: { select: { username: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async grab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status !== 'PENDING' ||
      order.dispatchType !== 'POOL' ||
      order.companionId !== null
    ) {
      throw new ForbiddenException('该订单不可抢');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'GRABBED', companionId },
    });
  }

  async assign(orderId: string, companionId: string) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { dispatchType: 'DIRECT', companionId },
    });
  }

  async confirm(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('无权确认此订单');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
    });
  }

  async complete(orderId: string) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'DONE' },
    });
  }

  async cancel(orderId: string) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }
}
