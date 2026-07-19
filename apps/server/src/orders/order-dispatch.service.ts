// craftsman-ignore: TS001,TS003
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WsGateway } from '../ws/ws.gateway';
import { OrderStatus } from '@chunlv/shared';

@Injectable()
export class OrderDispatchService {
  constructor(
    private prisma: PrismaService,
    private wsGateway: WsGateway,
  ) {}

  async assign(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === OrderStatus.DONE || order.status === OrderStatus.CANCELLED) {
      throw new ForbiddenException('已完成或已取消的订单不可重新分配');
    }
    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { dispatchType: 'DIRECT', companionId },
    });
    this.wsGateway.pushOrder(companionId, updatedOrder);
    return updatedOrder;
  }

  async acceptAssignment(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('该订单未指派给你');
    if (order.status !== OrderStatus.PENDING) throw new ForbiddenException('订单状态不正确');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.GRABBED, grabbedAt: new Date() },
    });
  }

  async declineAssignment(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId !== companionId) throw new ForbiddenException('该订单未指派给你');
    return this.prisma.order.update({ where: { id: orderId }, data: { companionId: null, dispatchType: 'POOL' } });
  }

  async quickGrab(orderId: string, companionId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.companionId) throw new ForbiddenException('已被其他陪玩抢先');
    if (order.status !== OrderStatus.PENDING) throw new ForbiddenException('订单状态不正确');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.GRABBED, companionId, grabbedAt: new Date() },
    });
  }
}
